import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async (importOriginal) => ({ ...await importOriginal<object>(), ...await import("../../__mocks__/obsidian-form-dom") }));
import { TFolder } from "obsidian";
import { installFormDomHelpers } from "../../__mocks__/obsidian-form-dom";
import { getUiStrings } from "../../i18n";
import { NewTemplateModal, type NewTemplateModalOptions } from "./NewTemplateModal";
function input(field: HTMLInputElement, value: string) { field.value = value; field.dispatchEvent(new Event("input", { bubbles: true })); }
function enter(field: HTMLInputElement, options: KeyboardEventInit = {}) { field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...options })); }
function open(language: "en" | "zh" = "en", submit = vi.fn(async () => true), options: NewTemplateModalOptions = {}) {
  const folders = ["Notes", "Notes/Daily"].map((path) => Object.assign(new TFolder(), { path }));
  const app = { vault: { getAllLoadedFiles: () => folders } };
  const modal = new NewTemplateModal(app as never, getUiStrings(language).noteInput, submit, undefined, options);
  modal.open();
  const [name, folder] = Array.from(modal.contentEl.querySelectorAll<HTMLInputElement>("input"));
  return { modal, name: name!, folder: folder!, submit };
}
beforeEach(() => { installFormDomHelpers(); document.body.replaceChildren(); });
afterEach(() => document.body.replaceChildren());
describe("NewTemplateModal", () => {
  it.each(["en", "zh"] as const)("configures an existing file using the same name and destination form in %s", async (language) => {
    const strings = getUiStrings(language).noteInput;
    const { modal, name, folder, submit } = open(language, vi.fn(async () => true), {
      name: "Synced daily", title: strings.setAsTemplate, submitLabel: strings.apply,
    });
    expect(modal.modalEl.getAttribute("aria-label")).toBe(strings.setAsTemplate);
    expect(modal.modalEl.querySelector("button.mod-cta")?.textContent).toBe(strings.apply);
    expect(name.value).toBe("Synced daily"); expect(folder.value).toBe("");
    input(name, "My daily input"); enter(name);
    await vi.waitFor(() => expect(submit).toHaveBeenCalledExactlyOnceWith("My daily input", ""));
    expect(modal.modalEl.isConnected).toBe(false);
  });
  it.each(["en", "zh"] as const)("replaces the old storage fields with a name and destination in %s", (language) => {
    const { modal, folder } = open(language);
    const strings = getUiStrings(language).noteInput;
    const rows = modal.contentEl.querySelectorAll(".setting-item");
    expect(Array.from(rows).map((row) => row.getAttribute("aria-label"))).toEqual([strings.templateName, strings.targetFolder]);
    expect(modal.contentEl.textContent).toContain(strings.templateNameDesc);
    expect(modal.contentEl.textContent).toContain(strings.targetFolderDesc);
    expect(folder.placeholder).toBe(strings.rootFolder); modal.close();
  });
  it("Enter chooses a folder suggestion before submitting, then sends the separate display name and path", async () => {
    const { name, folder, submit } = open(); input(name, "Daily display name"); folder.focus(); input(folder, "notes/d");
    expect(document.querySelector(".suggestion-container")?.textContent).toBe("Notes/Daily");
    enter(folder); expect(folder.value).toBe("Notes/Daily"); expect(submit).not.toHaveBeenCalled();
    enter(folder); await vi.waitFor(() => expect(submit).toHaveBeenCalledExactlyOnceWith("Daily display name", "Notes/Daily"));
  });
  it("offers the vault root and releases the suggestion popup on close", () => {
    const { modal, folder } = open(); folder.focus(); input(folder, "/");
    expect(document.querySelector(".suggestion-container")?.textContent).toContain("/");
    const root = Array.from(document.querySelectorAll<HTMLElement>(".suggestion-item")).find((row) => row.textContent === "/")!;
    root.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(folder.value).toBe(""); modal.close(); expect(document.querySelector(".suggestion-container")).toBeNull();
  });
  it("retains fields after a failed save and ignores Enter during composition", async () => {
    const { modal, name, folder, submit } = open("en", vi.fn(async () => false));
    input(name, "每日记录"); folder.dispatchEvent(new CompositionEvent("compositionstart")); input(folder, "笔");
    enter(folder, { isComposing: true }); expect(submit).not.toHaveBeenCalled();
    input(folder, "Missing"); folder.dispatchEvent(new CompositionEvent("compositionend")); enter(folder);
    await vi.waitFor(() => expect(submit).toHaveBeenCalled());
    expect(modal.modalEl.isConnected).toBe(true); expect(name.value).toBe("每日记录"); expect(folder.value).toBe("Missing"); modal.close();
  });
});
