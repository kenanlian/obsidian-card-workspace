import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { RuntimeWorkGate } from "./work-gate";
import { createRuntimeResourceBudget } from "./resource-budget";
import { SearchDocumentSource } from "../services/SearchDocumentSource";
import { SearchIndexManager } from "../search/SearchIndexManager";
import { prepareSearchableDocument } from "../search/document-preparation";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
function harness() {
  const workGate = new RuntimeWorkGate(), budget = createRuntimeResourceBudget({ search: { readers: 1, batchSize: 1, ingestTerms: 1 } });
  const files = ["a.md", "b.md", "c.md"].map(path => Object.assign(new TFile(), { path, basename: path, stat: { mtime: 1, ctime: 1, size: 1 } }));
  const content = new Map(files.map(file => [file.path, "oldword"]));
  const read = vi.fn(async (file: TFile) => prepareSearchableDocument({ path: file.path, title: file.basename, markdown: content.get(file.path), mtime: file.stat.mtime, ctime: 1 }));
  const source = new SearchDocumentSource({ vault: { getFiles: () => files, getAbstractFileByPath: (path: string) => files.find(file => file.path === path) } } as never,
    read, budget.search, workGate);
  const store = { restore: vi.fn(async () => ({ outcome: "rebuild-required", reason: "missing", cleared: false, detail: null } as const)),
    write: vi.fn(async () => ({ outcome: "written" } as const)), clear: vi.fn(async () => ({ outcome: "cleared" } as const)), isAvailable: () => true };
  const manager = new SearchIndexManager({ store, documentSource: source, workGate, resourceBudget: budget.search });
  const initialize = () => manager.restore({ vaultNamespace: "synthetic", schemaVersion: "phase3-v2", tokenizerVersion: "test", pluginVersion: "test", documentCount: 0, lastIndexedAt: 0 });
  return { workGate, files, content, read, manager, store, initialize };
}

describe("source work lifecycle", () => {
  it("pauses one build and resumes without duplicate reads or cutovers", async () => {
    const h = harness(); await h.initialize();
    const started = deferred<void>(), finish = deferred<ReturnType<typeof prepareSearchableDocument>>();
    h.read.mockImplementationOnce(async () => { started.resolve(); return finish.promise; });
    const build = h.manager.rebuildFromSource(); await started.promise;
    h.workGate.setActive(false); finish.resolve(prepareSearchableDocument({ path: "a.md", title: "a", markdown: "oldword", mtime: 1, ctime: 1 }));
    await vi.waitFor(() => expect(h.workGate.getDiagnostics().waiters).toBeGreaterThan(0));
    expect(h.read).toHaveBeenCalledOnce(); expect(h.store.write).not.toHaveBeenCalled();
    h.workGate.setActive(true); expect(await build).toEqual({ outcome: "success" });
    expect(h.read.mock.calls.map(([file]) => file.path)).toEqual(["a.md", "b.md", "c.md"]);
    expect(h.store.write).toHaveBeenCalledOnce(); h.manager.dispose(); h.workGate.close();
  });

  it.each(["modify", "delete", "rename"] as const)("cancels a paused replacement on %s, handles live events, then builds current source", async (type) => {
    const h = harness(); await h.initialize();
    const started = deferred<void>(), finish = deferred<ReturnType<typeof prepareSearchableDocument>>();
    const old = prepareSearchableDocument({ path: "a.md", title: "a", markdown: "oldword", mtime: 1, ctime: 1 });
    h.read.mockImplementationOnce(async () => { started.resolve(); return finish.promise; });
    const build = h.manager.rebuildFromSource(); await started.promise; h.workGate.setActive(false);
    h.content.set("a.md", "newword");
    if (type === "delete") h.files.splice(0, 1);
    if (type === "rename") { h.files[0].path = "renamed.md"; h.content.set("renamed.md", "newword"); }
    await h.manager.applyMutation({ type, path: type === "rename" ? "renamed.md" : "a.md", oldPath: type === "rename" ? "a.md" : null, isMarkdown: true, isFolder: false });
    // The event completes even though the older background read is pending.
    finish.resolve(old); expect(await build).toEqual({ outcome: "cancelled" });
    expect(h.store.write).not.toHaveBeenCalled(); expect(h.workGate.getDiagnostics().waiters).toBe(0);
    h.workGate.setActive(true); expect(await h.manager.rebuildFromSource()).toEqual({ outcome: "success" });
    expect(h.store.write).toHaveBeenCalledOnce();
    const paths = h.files.map(file => file.path);
    const results = await h.manager.search("newword", paths);
    expect(results.orderedPaths).toEqual(type === "delete" ? [] : [type === "rename" ? "renamed.md" : "a.md"]);
    h.manager.dispose(); h.workGate.close();
  });

  it("returns controlled cancellation on disposal, and failure on source errors", async () => {
    const h = harness(); await h.initialize(); h.workGate.setActive(false);
    const build = h.manager.rebuildFromSource(); await Promise.resolve();
    h.manager.dispose(); expect(await build).toEqual({ outcome: "cancelled" });
    expect(h.store.write).not.toHaveBeenCalled(); expect(h.workGate.getDiagnostics().waiters).toBe(0); h.workGate.close();
    const failed = harness(); await failed.initialize();
    failed.read.mockRejectedValue(new Error("unreadable"));
    // Individual file read failures remain the established skipped-file behavior.
    expect(await failed.manager.rebuildFromSource()).toEqual({ outcome: "success" });
    failed.store.write.mockImplementationOnce(async () => { throw new Error("storage failure"); });
    expect(await failed.manager.rebuildFromSource()).toEqual({ outcome: "failed" });
    expect(failed.manager.getSnapshot().status).toBe("error"); failed.manager.dispose(); failed.workGate.close();
  });
});
