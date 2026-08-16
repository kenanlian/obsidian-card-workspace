import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  FuzzySuggestModal: class FuzzySuggestModal {},
  Modal: class Modal {},
  Setting: class Setting {},
  TFolder: class TFolder {},
}));

import { FolderActions } from "./folder-actions";

describe("FolderActions", () => {
  it("builds root and nested sibling paths without changing path semantics", () => {
    const actions = new FolderActions({ context: {} } as never);

    expect(actions.buildSiblingPath("/", "Untitled.md")).toBe("Untitled.md");
    expect(actions.buildSiblingPath("", "Untitled.md")).toBe("Untitled.md");
    expect(actions.buildSiblingPath("notes", "Untitled.md")).toBe("notes/Untitled.md");
  });
});
