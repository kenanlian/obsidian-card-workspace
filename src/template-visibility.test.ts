import { describe, expect, it, vi } from "vitest";
import { TFile, TFolder, type App } from "obsidian";
import { collectSupportedFiles } from "./view/scope-files";
import { collectLinksFiles, isLinksMember } from "./view/links-sources";
import { isBoxMember } from "./view/card-box-membership";
import { buildNavigationFolderTree } from "./view/controllers/nav-folder-tree";
import { collectVaultTagIndex } from "./view/metadata-utils";
import { reconcileSymmetricPathMembership } from "./view/controllers/scope-membership";
import { applyIncrementalMutation } from "./view/controllers/incremental-mutation";
import { DEFAULT_GROUP_SPEC } from "./card-grouping-settings";
function harness() {
  const root = new TFolder(); root.path = ""; root.name = "";
  const files = ["template.md", "note.md"].map((path) => {
    const f = new TFile(); f.path = path; f.name = path; f.basename = path.slice(0,-3); f.extension = "md"; f.parent = root;
    f.stat = { ctime: 1, mtime: 1, size: 1 }; return f;
  }); root.children = files;
  const app = { vault: { getRoot: () => root, getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
    getMarkdownFiles: () => files }, metadataCache: { resolvedLinks: { "template.md": { "source.md": 1 }, "note.md": { "source.md": 1 } },
    getFileCache: () => ({ tags: [{ tag: "#tag/nested" }] }) } } as unknown as App;
  const box = { id: "b", name: "B", rules: [], manualPaths: ["template.md", "note.md"], excludedPaths: [], pinnedPaths: [],
    sort: { field: "mtime" as const, direction: "desc" as const }, group: DEFAULT_GROUP_SPEC };
  return { app, root, files, box };
}
describe("template file visibility", () => {
  it("includes template files in folders, boxes, links and card count badges", () => {
    const h = harness();
    expect(collectSupportedFiles(h.app, "", true).map((f) => f.path)).toEqual(["template.md", "note.md"]);
    expect(isBoxMember(h.app, "template.md", h.box)).toBe(true);
    expect(collectLinksFiles(h.app, { kind: "links", notePath: "source.md", direction: "backlinks" }).map((f) => f.path)).toEqual(["template.md", "note.md"]);
    expect(isLinksMember(h.app, { kind: "links", notePath: "source.md", direction: "backlinks" }, "template.md")).toBe(true);
    expect(buildNavigationFolderTree(h.app)[0].recursiveCount).toBe(2);
    expect(collectVaultTagIndex(h.app)?.counts).toEqual({ tag: 2, "tag/nested": 2 });
  });
  it("inserts template cards through metadata and vault-create paths", () => {
    const h = harness(); const replaceBaseCards = vi.fn();
    expect(reconcileSymmetricPathMembership("template.md", true, {
      getApp: () => h.app, getBaseCards: () => [], replaceBaseCards, prepareRecordsFromCache: vi.fn(),
      deletePendingHydration: () => false, resolveSort: () => h.box.sort,
    })).toBe("entered");
    expect(replaceBaseCards).toHaveBeenCalledWith([expect.objectContaining({ path: "template.md" })]);
    const result = applyIncrementalMutation({ eventType: "create", path: "template.md", oldPath: null, isFolder: false, fileKind: "markdown" }, [], {
      app: h.app, sort: h.box.sort, pendingHydration: { has: () => false, delete: () => false }, prepareRecordsFromCache: vi.fn(),
      getBulkSelection: () => ({ selectedPaths: new Set(), anchorPath: null }), setBulkSelection: vi.fn(), isPathInActiveScope: () => true,
    }); expect(result.nextCards).toEqual([expect.objectContaining({ path: "template.md" })]);
  });
});
