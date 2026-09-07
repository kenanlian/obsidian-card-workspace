import { describe, expect, it } from "vitest";

import type { PanelScopeState } from "./panel-model";
import { createBoxScope, createFolderScope, scopeIdentity } from "./scope";
import {
  buildRowPositions,
  createViewportRequest,
  getSpacerStyle,
  readFiniteNumber,
  resolvePanelScopeIdentity,
} from "./virtual-layout";

function folderScopeState(
  overrides: Partial<PanelScopeState> = {},
): PanelScopeState {
  return {
    displayPath: "notes",
    includeSubfolders: true,
    activeBoxId: null,
    activeBoxName: null,
    boxExcludedCount: 0,
    emptyStateMessage: "",
    sourceIdentity: scopeIdentity(createFolderScope("notes", true)),
    browseTagFilterEnabled: true,
    browsePropertyFilterEnabled: true,
    supportsIncludeSubfolders: true,
    supportsBoxRuleSeeding: true,
    ...overrides,
  };
}

function boxScopeState(overrides: Partial<PanelScopeState> = {}): PanelScopeState {
  return folderScopeState({
    displayPath: "/",
    activeBoxId: "box-1",
    activeBoxName: "Ideas",
    sourceIdentity: scopeIdentity(createBoxScope("box-1")),
    browseTagFilterEnabled: false,
    browsePropertyFilterEnabled: false,
    supportsIncludeSubfolders: false,
    supportsBoxRuleSeeding: false,
    ...overrides,
  });
}

describe("resolvePanelScopeIdentity (C6 viewport identity input)", () => {
  it("returns the host-precomputed source identity for a folder scope", () => {
    const scope = folderScopeState();
    expect(resolvePanelScopeIdentity(scope)).toBe("folder:notes:true");
    expect(resolvePanelScopeIdentity(scope)).toBe(scopeIdentity(createFolderScope("notes", true)));
  });

  it("returns the host-precomputed source identity for a box scope", () => {
    const scope = boxScopeState();
    expect(resolvePanelScopeIdentity(scope)).toBe("box:box-1");
    expect(resolvePanelScopeIdentity(scope)).toBe(scopeIdentity(createBoxScope("box-1")));
  });

  it("distinguishes folder scopes that differ only in include-subfolders", () => {
    const withSubfolders = folderScopeState({ sourceIdentity: scopeIdentity(createFolderScope("notes", true)) });
    const withoutSubfolders = folderScopeState({ sourceIdentity: scopeIdentity(createFolderScope("notes", false)) });
    expect(resolvePanelScopeIdentity(withoutSubfolders))
      .not.toBe(resolvePanelScopeIdentity(withSubfolders));
  });

  it("does not derive identity from activeBoxId or display labels", () => {
    // A scope state whose stale Box label/id fields disagree with the
    // precomputed identity must still report the precomputed identity: the
    // viewport never re-derives Folder/Box classification from `activeBoxId`.
    const scope = folderScopeState({ activeBoxId: "box-9", activeBoxName: "Stale" });
    expect(resolvePanelScopeIdentity(scope)).toBe("folder:notes:true");
  });

  it("distinguishes a folder scope from a box scope with the same display path", () => {
    const folder = folderScopeState({ displayPath: "/" });
    const box = boxScopeState({ displayPath: "/" });
    expect(resolvePanelScopeIdentity(box)).not.toBe(resolvePanelScopeIdentity(folder));
  });
});

describe("buildRowPositions", () => {
  const rows = [{ key: "a" }, { key: "b" }, { key: "c" }];

  it("lays out rows from measured heights", () => {
    const measured = new Map([["a", 10], ["b", 20]]);
    const { positions, totalHeight } = buildRowPositions(rows, measured, 30, [], 0);

    expect(positions).toEqual([0, 10, 30]);
    expect(totalHeight).toBe(60);
  });

  it("reuses prior positions before the rebuild index", () => {
    const prior = [100, 110, 120];
    const { positions, totalHeight } = buildRowPositions(rows, new Map(), 5, prior, 2);

    expect(positions).toEqual([100, 110, 120]);
    expect(totalHeight).toBe(125);
  });

  it("clamps an out-of-range start index", () => {
    const { positions, totalHeight } = buildRowPositions(rows, new Map(), 7, [], -4);
    expect(positions).toEqual([0, 7, 14]);
    expect(totalHeight).toBe(21);
  });
});

describe("createViewportRequest", () => {
  it("carries generation, hydration revision, and ordered paths", () => {
    const { identity, request } = createViewportRequest(3, 5, 2, 9, ["a.md", "b.md"]);

    expect(request).toEqual({
      generation: 3,
      hydrationRevision: 5,
      start: 2,
      end: 9,
      paths: ["a.md", "b.md"],
    });
    expect(identity).toBe(`3\u001e5\u001ea.md\u001fb.md`);
  });

  it("differentiates identities by path order alone", () => {
    const first = createViewportRequest(1, 1, 0, 1, ["a.md", "b.md"]).identity;
    const second = createViewportRequest(1, 1, 0, 1, ["b.md", "a.md"]).identity;
    expect(second).not.toBe(first);
  });
});

describe("pure helpers", () => {
  it("reads finite numbers with a fallback", () => {
    expect(readFiniteNumber("42.5", 1)).toBe(42.5);
    expect(readFiniteNumber("nope", 7)).toBe(7);
    expect(readFiniteNumber("", 7)).toBe(7);
  });

  it("renders the spacer height style", () => {
    expect(getSpacerStyle(120)).toBe("height: 120px;");
  });
});
