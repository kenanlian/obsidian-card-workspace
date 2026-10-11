import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { BulkMetadataSession } from "./bulk-metadata-session";
function file(path: string): TFile { const result = new TFile(); result.path = path; result.extension = "md"; return result; }
it("freezes targets, follows rename, rejects replacements, continues failures and retries only failed files", async () => {
  const first = file("first.md"); const second = file("second.md"); const deleted = file("deleted.md"); const replaced = file("replaced.md");
  const targets = [first, second, deleted, replaced];
  const session = new BulkMetadataSession(targets);
  targets.push(file("later.md"));
  first.path = "renamed.md";
  const live = new Map([[first.path, first], [second.path, second], [replaced.path, file(replaced.path)]]);
  const app = { vault: { getAbstractFileByPath: (path: string) => live.get(path) ?? null } };
  const mutate = vi.fn(async (target: TFile) => target === second ? { ok: false as const, error: "partial", path: target.path } : { ok: true as const, changed: true as const, file: target });
  const result = await session.apply(app as never, mutate);
  expect(result).toMatchObject({ changed: 1, noop: 0, failed: [second, deleted, replaced] });
  expect(mutate.mock.calls.map(([target]) => target)).toEqual([first, second]);
  live.set(deleted.path, deleted); live.set(replaced.path, replaced);
  mutate.mockImplementation(async (target) => ({ ok: true, changed: true, file: target }));
  expect(await session.apply(app as never, mutate)).toMatchObject({ changed: 3, failed: [] });
  expect(mutate.mock.calls.slice(2).map(([target]) => target)).toEqual([second, deleted, replaced]);
});
describe("bulk session outcomes", () => {
  it("continues after an unexpected throw and counts noops separately", async () => {
    const first = file("first.md"); const second = file("second.md");
    const app = { vault: { getAbstractFileByPath: (path: string) => path === first.path ? first : second } };
    const result = await new BulkMetadataSession([first, second]).apply(app as never, async (target) => {
      if (target === first) throw new Error("unexpected");
      return { ok: true, changed: false, file: target };
    });
    expect(result).toMatchObject({ changed: 0, noop: 1, failed: [first] });
  });
});
