import { describe, it, expect } from "vitest";
import { TFile, TFolder } from "obsidian";
import { readHistoryScope, shouldRecordScopeHistory } from "./scope-history";

describe("scope history admission", () => {
  const folder = Object.assign(new TFolder(), { path: "" }), file = Object.assign(new TFile(), { path: "a.md", extension: "md" });
  const app = { vault: { getRoot: () => folder, getAbstractFileByPath: (path: string) => path === "a.md" ? file : null } } as never;
  it("accepts folder, box and links scopes and rejects malformed or removed targets", () => {
    expect(readHistoryScope({ kind: "folder", path: "", includeSubfolders: true }, app, [])).toEqual({ kind: "folder", path: "", includeSubfolders: true });
    expect(readHistoryScope({ kind: "box", boxId: "b" }, app, [{ id: "b" } as never])).toEqual({ kind: "box", boxId: "b" });
    expect(readHistoryScope({ kind: "links", notePath: "a.md", direction: "backlinks" }, app, [])).not.toBeNull();
    for (const scope of [null, {}, { kind: "folder", path: "missing", includeSubfolders: true }, { kind: "folder", path: "" }, { kind: "box", boxId: "gone" }, { kind: "links", notePath: "a.md", direction: "bad" }]) expect(readHistoryScope(scope, app, [])).toBeNull();
  });
  it("records only a committed distinct winning user scope", () => {
    expect(shouldRecordScopeHistory("panel-picker", true, true, false)).toBe(true);
    expect(shouldRecordScopeHistory("programmatic", true, true, false)).toBe(true);
    for (const source of ["links-follow", "history", "restore"]) expect(shouldRecordScopeHistory(source, true, true, false)).toBe(false);
    expect(shouldRecordScopeHistory("panel-picker", false, true, false)).toBe(false);
    expect(shouldRecordScopeHistory("panel-picker", true, false, false)).toBe(false);
    expect(shouldRecordScopeHistory("panel-picker", true, true, true)).toBe(false);
  });
});
