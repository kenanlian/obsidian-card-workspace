import { describe, expect, it, vi } from "vitest";
import { TFile, TFolder, type App } from "obsidian";
import { installTemplateExclusion, isTemplatePath } from "./template-exclusion";
import { collectSupportedFiles } from "./view/scope-files";
import { collectLinksFiles, isLinksMember } from "./view/links-sources";
import { isBoxMember } from "./view/card-box-membership";
import { buildNavigationFolderTree } from "./view/controllers/nav-folder-tree";
import { collectVaultTagIndex } from "./view/metadata-utils";
import { reconcileSymmetricPathMembership } from "./view/controllers/scope-membership";
import { applyIncrementalMutation } from "./view/controllers/incremental-mutation";
import { DEFAULT_GROUP_SPEC } from "./card-grouping-settings";
const template = { id: "t", filePath: "template.md", targetFolderPath: "", dateFormat: "YYYY", timeFormat: "HH" };
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
  let templates = [template]; const reserved = new Set<string>();
  const release = installTemplateExclusion(app, (path) => isTemplatePath(path, templates, reserved));
  return { app, root, files, box, reserved, release, unregister: () => { templates = []; } };
}
describe("unified template exclusion", () => {
  it("excludes registered templates from folder, box, links and all card count badges", () => {
    const h = harness();
    expect(collectSupportedFiles(h.app, "", true).map((f) => f.path)).toEqual(["note.md"]);
    expect(isBoxMember(h.app, "template.md", h.box)).toBe(false);
    expect(collectLinksFiles(h.app, { kind: "links", notePath: "source.md", direction: "backlinks" }).map((f) => f.path)).toEqual(["note.md"]);
    expect(isLinksMember(h.app, { kind: "links", notePath: "source.md", direction: "backlinks" }, "template.md")).toBe(false);
    expect(buildNavigationFolderTree(h.app)[0].recursiveCount).toBe(1);
    expect(collectVaultTagIndex(h.app)?.counts).toEqual({ tag: 1, "tag/nested": 1 });
    h.release();
  });
  it("restores ordinary note identity immediately after unregistration and covers create reservations", () => {
    const h = harness(); h.unregister(); h.reserved.add("note.md");
    expect(collectSupportedFiles(h.app, "", false).map((f) => f.path)).toEqual(["template.md"]);
    h.reserved.clear(); expect(collectSupportedFiles(h.app, "", false)).toHaveLength(2); h.release();
  });
  it("blocks metadata/incremental insertion even when a stale membership predicate accepts", () => {
    const h = harness(); const replaceBaseCards = vi.fn();
    expect(reconcileSymmetricPathMembership("template.md", true, {
      getApp: () => h.app, getBaseCards: () => [], replaceBaseCards, prepareRecordsFromCache: vi.fn(),
      deletePendingHydration: () => false, resolveSort: () => h.box.sort,
    })).toBe("unchanged"); expect(replaceBaseCards).not.toHaveBeenCalled();
    const result = applyIncrementalMutation({ eventType: "create", path: "template.md", oldPath: null, isFolder: false, fileKind: "markdown" }, [], {
      app: h.app, sort: h.box.sort, pendingHydration: { has: () => false, delete: () => false }, prepareRecordsFromCache: vi.fn(),
      getBulkSelection: () => ({ selectedPaths: new Set(), anchorPath: null }), setBulkSelection: vi.fn(), isPathInActiveScope: () => true,
    }); expect(result.nextCards).toBeNull(); h.release();
  });
});
