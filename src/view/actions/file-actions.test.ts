import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  FuzzySuggestModal: class FuzzySuggestModal {},
  Modal: class Modal {},
  Setting: class Setting {},
  TFile: class TFile {},
  TFolder: class TFolder {},
}));

import { FileActions } from "./file-actions";

describe("FileActions", () => {
  it("ignores a path that no longer resolves to a live markdown file", () => {
    const actions = new FileActions({
      context: {
        getApp: () => ({ vault: { getAbstractFileByPath: () => null } }),
      } as never,
      buildSiblingPath: (parent, name) => parent ? `${parent}/${name}` : name,
    });

    expect(actions.resolveLiveMarkdownFile("missing.md")).toBeNull();
  });
});
