import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async (importOriginal) => ({ ...await importOriginal<object>(), ...await import("../../__mocks__/obsidian-form-dom") }));
import { installFormDomHelpers } from "../../__mocks__/obsidian-form-dom";
import { getUiStrings } from "../../i18n";
import { RenameTagModal } from "./RenameTagModal";

const candidates = [{ name: "a/b", count: 2 }, { name: "a/b/child", count: 1 }, { name: "x/y", count: 3 }, { name: "Xylo", count: 1 }];
function input(el: HTMLInputElement, value: string): void { el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); }
function enter(el: HTMLInputElement, init: KeyboardEventInit = {}): void { el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init })); }
function renameButton(): HTMLButtonElement { return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((el) => el.textContent === "Rename")!; }
function open(submit = vi.fn(async () => true)) {
  const modal = new RenameTagModal({} as never, { strings: getUiStrings("en").view.tagRename, from: "a/b", candidates }, submit);
  modal.open();
  return { modal, submit, field: modal.contentEl.querySelector("input")! };
}
beforeEach(() => { installFormDomHelpers(); document.body.replaceChildren(); });
afterEach(() => { document.body.replaceChildren(); });

describe("RenameTagModal", () => {
  it("prefills the current tag and keeps Rename disabled until the name changes", () => {
    const { modal, field } = open();
    expect(field.value).toBe("a/b");
    expect(modal.contentEl.querySelector(".fce-modal-intro__summary")?.textContent).toBe("Rename #a/b and its child tags across the vault");
    expect(renameButton().disabled).toBe(true);
    input(field, "#A/B "); expect(renameButton().disabled).toBe(true);
    input(field, ""); expect(renameButton().disabled).toBe(true);
    input(field, "c"); expect(renameButton().disabled).toBe(false);
    modal.close();
  });
  it("suggests other tags, and Enter picks a suggestion before it submits", async () => {
    const { submit, field } = open();
    field.focus(); input(field, "x");
    expect(document.querySelector(".suggestion-container")?.textContent).toBe("x/y (3)Xylo (1)");
    enter(field);
    expect(field.value).toBe("x/y");
    expect(submit).not.toHaveBeenCalled();
    enter(field);
    await vi.waitFor(() => expect(submit).toHaveBeenCalledExactlyOnceWith("x/y"));
  });
  it("never offers the renamed subtree and ignores Enter during IME composition", () => {
    const { modal, submit, field } = open();
    field.focus(); input(field, "a/");
    expect(document.querySelector(".suggestion-container")).toBeNull();
    field.dispatchEvent(new CompositionEvent("compositionstart"));
    input(field, "新");
    enter(field, { isComposing: true });
    expect(submit).not.toHaveBeenCalled();
    modal.close();
    expect(document.querySelector(".suggestion-container")).toBeNull();
  });
});
