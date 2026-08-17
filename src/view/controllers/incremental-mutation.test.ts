import { TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

const obsidianTypes = vi.hoisted(() => {
  class MockTFile {
    path = "";
    name = "";
    basename = "";
    extension = "md";
    stat = { ctime: 1, mtime: 2 };
  }
  return { MockTFile };
});

vi.mock("obsidian", () => ({ TFile: obsidianTypes.MockTFile }));

import type { NoteCardRecord, VaultMutationEvent } from "../types";
import { applyIncrementalMutation } from "./incremental-mutation";

function file(path: string): TFile {
  const value = new TFile() as any;
  value.path = path;
  value.name = path.slice(path.lastIndexOf("/") + 1);
  value.basename = value.name.replace(/\.md$/, "");
  value.stat = { ctime: 1, mtime: 2 };
  return value as TFile;
}

function record(path: string): NoteCardRecord {
  const value = file(path);
  return {
    file: value,
    fileKind: "markdown",
    path,
    title: value.basename,
    ctime: 1,
    mtime: 2,
    excerpt: "",
    previewHtml: "",
    previewMode: "empty",
    hydrated: false,
  };
}

describe("applyIncrementalMutation", () => {
  const cases: Array<{
    eventType: VaultMutationEvent["eventType"];
    event: VaultMutationEvent;
    cardPaths: string[];
    action: string;
  }> = [
    { eventType: "create", event: { eventType: "create", path: "scope/new.md", oldPath: null, isFolder: false, fileKind: "markdown" }, cardPaths: [], action: "inserted" },
    { eventType: "modify", event: { eventType: "modify", path: "scope/old.md", oldPath: null, isFolder: false, fileKind: "markdown" }, cardPaths: ["scope/old.md"], action: "hydration_reset" },
    { eventType: "delete", event: { eventType: "delete", path: "scope/old.md", oldPath: null, isFolder: false, fileKind: "markdown" }, cardPaths: ["scope/old.md"], action: "removed" },
    { eventType: "rename", event: { eventType: "rename", path: "scope/new.md", oldPath: "scope/old.md", isFolder: false, fileKind: "markdown" }, cardPaths: ["scope/old.md"], action: "updated" },
  ];

  for (const scopeKind of ["folder", "box"] as const) {
    for (const testCase of cases) {
      it(`${testCase.eventType} reports ${testCase.action} in ${scopeKind} scope`, () => {
        const liveFiles = new Map<string, TFile>([[testCase.event.path, file(testCase.event.path)]]);
        const pending = new Set<string>();
        const outcome = applyIncrementalMutation(testCase.event, testCase.cardPaths.map(record), {
          app: { vault: { getAbstractFileByPath: (path: string) => liveFiles.get(path) ?? null } } as any,
          sort: { field: "name", direction: "asc" },
          pendingHydration: pending,
          getBulkSelection: () => ({ selectedPaths: new Set<string>(), anchorPath: null }),
          setBulkSelection: vi.fn(),
          isPathInActiveScope: () => true,
        });
        expect(outcome.result.action).toBe(testCase.action);
      });
    }
  }

  it("distinguishes an unchanged collection from a collection emptied by delete", () => {
    const deps = {
      app: { vault: { getAbstractFileByPath: () => null } } as any,
      sort: { field: "name" as const, direction: "asc" as const },
      pendingHydration: new Set<string>(),
      getBulkSelection: () => ({ selectedPaths: new Set<string>(), anchorPath: null }),
      setBulkSelection: vi.fn(),
      isPathInActiveScope: () => true,
    };
    const event: VaultMutationEvent = { eventType: "delete", path: "scope/old.md", oldPath: null, isFolder: false, fileKind: "markdown" };
    expect(applyIncrementalMutation(event, [], deps).nextCards).toBeNull();
    expect(applyIncrementalMutation(event, [record(event.path)], deps).nextCards).toEqual([]);
  });

  it("returns create and modify hydration paths while clearing a modified pending path", () => {
    const pending = new Set(["scope/old.md"]);
    const deps = {
      app: {
        vault: {
          getAbstractFileByPath: (path: string) => file(path),
        },
      } as any,
      sort: { field: "name" as const, direction: "asc" as const },
      pendingHydration: pending,
      getBulkSelection: () => ({ selectedPaths: new Set<string>(), anchorPath: null }),
      setBulkSelection: vi.fn(),
      isPathInActiveScope: () => true,
    };

    const created = applyIncrementalMutation(
      { eventType: "create", path: "scope/new.md", oldPath: null, isFolder: false, fileKind: "markdown" },
      [record("scope/old.md")],
      deps,
    );
    expect(created.hydrationPaths).toEqual(["scope/new.md"]);

    const modified = applyIncrementalMutation(
      { eventType: "modify", path: "scope/old.md", oldPath: null, isFolder: false, fileKind: "markdown" },
      [record("scope/old.md")],
      deps,
    );
    expect(modified.hydrationPaths).toEqual(["scope/old.md"]);
    expect(pending.has("scope/old.md")).toBe(false);
  });

  it("migrates pending rename hydration through the outcome without pre-marking the new path", () => {
    const pending = new Set(["scope/old.md"]);
    const renamed = applyIncrementalMutation(
      { eventType: "rename", path: "scope/new.md", oldPath: "scope/old.md", isFolder: false, fileKind: "markdown" },
      [record("scope/old.md")],
      {
        app: { vault: { getAbstractFileByPath: () => file("scope/new.md") } } as any,
        sort: { field: "name", direction: "asc" },
        pendingHydration: pending,
        getBulkSelection: () => ({ selectedPaths: new Set<string>(), anchorPath: null }),
        setBulkSelection: vi.fn(),
        isPathInActiveScope: () => true,
      },
    );

    expect(renamed.hydrationPaths).toEqual(["scope/new.md"]);
    expect(pending.has("scope/old.md")).toBe(false);
    expect(pending.has("scope/new.md")).toBe(false);
  });
});
