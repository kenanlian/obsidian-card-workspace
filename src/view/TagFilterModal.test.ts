import { describe, expect, it, vi } from "vitest";
import { getUiStrings } from "../i18n";

vi.mock("obsidian", () => {
  return {
    FuzzySuggestModal: class<T> {
      app: unknown;
      title = "";

      constructor(app: unknown) {
        this.app = app;
      }

      setTitle(title: string): this {
        this.title = title;
        return this;
      }

      getItems(): T[] {
        return [];
      }

      getItemText(_item: T): string {
        return "";
      }

      onChooseItem(_item: T): void {
        return;
      }
    },
  };
});

import { TagFilterModal } from "./TagFilterModal";

describe("TagFilterModal", () => {
  it("lists hierarchical tag options including synthesized parents", () => {
    const modal = new TagFilterModal({} as never, {
      availableTags: ["领域/AI/harness"],
      activeTags: [],
      strings: getUiStrings("en").toolbar,
    }, vi.fn());

    const items = modal.getItems();
    expect(items.map((item) => modal.getItemText(item))).toEqual([
      "#领域",
      "#领域/AI",
      "#领域/AI/harness",
    ]);
  });

  it("marks active tags using stable display casing", () => {
    const modal = new TagFilterModal({} as never, {
      availableTags: ["work/ML", "Work/AI"],
      activeTags: ["#Work"],
      strings: getUiStrings("en").toolbar,
    }, vi.fn());

    const items = modal.getItems();
    expect(items.map((item) => modal.getItemText(item))).toEqual([
      "✓ #Work",
      "#Work/AI",
      "#work/ML",
    ]);
  });

  it("adds a normalized tag when choosing an inactive option", () => {
    const onChoose = vi.fn();
    const modal = new TagFilterModal({} as never, {
      availableTags: ["Work/AI"],
      activeTags: ["work"],
      strings: getUiStrings("en").toolbar,
    }, onChoose);

    const selected = modal.getItems().find((item) => modal.getItemText(item) === "#Work/AI");
    expect(selected).toBeDefined();
    if (!selected) {
      throw new Error("Expected tag option");
    }

    modal.onChooseItem(selected);
    expect(onChoose).toHaveBeenCalledWith(["work", "work/ai"]);
  });

  it("removes an active tag when choosing it again", () => {
    const onChoose = vi.fn();
    const modal = new TagFilterModal({} as never, {
      availableTags: ["Work"],
      activeTags: ["#Work"],
      strings: getUiStrings("en").toolbar,
    }, onChoose);

    const selected = modal.getItems()[0];
    expect(selected).toBeDefined();
    if (!selected) {
      throw new Error("Expected tag option");
    }

    modal.onChooseItem(selected);
    expect(onChoose).toHaveBeenCalledWith([]);
  });
});
