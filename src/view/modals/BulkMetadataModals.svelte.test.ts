import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async (importOriginal) => ({ ...await importOriginal<object>(), ...await import("../../__mocks__/obsidian-form-dom") }));
import { installFormDomHelpers } from "../../__mocks__/obsidian-form-dom";
import { BulkTagsModal } from "./BulkTagsModal";
import { BulkPropertiesModal } from "./BulkPropertiesModal";
import { bulkMetadataStrings } from "../../i18n/bulkMetadata";
import type { BulkMetadataSnapshot } from "../bulk-metadata";
const snapshot: BulkMetadataSnapshot = {
  tags: [{ name: "Alpha" }, { name: "Beta" }, { name: "Alphabet" }], removeTags: [{ name: "Alpha", count: 2 }, { name: "Beta", count: 1 }],
  properties: [{ name: "Status" }, { name: "Score" }, { name: "List" }, { name: "Enabled" }, { name: "Day" }, { name: "Time" }], removeProperties: [{ name: "Status", count: 2 }],
  values: new Map<string, unknown[]>([["status", ["open"]], ["score", [0]], ["list", [["one", 1]]], ["enabled", [false]], ["day", ["2024-02-29"]], ["time", ["2024-02-29T12:30:00"]]]), incomplete: true,
};
function input(el: HTMLInputElement, value: string): void { el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); }
function enter(el: HTMLInputElement): void { el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); }
function button(label: string): HTMLButtonElement { const el = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent === label); if (!el) throw new Error(`Missing button ${label}`); return el; }
function field(label: string): HTMLInputElement { return document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!; }
function chooseType(type: string): void { const select = document.querySelector<HTMLSelectElement>('select[aria-label="Type"]')!; select.value = type; select.dispatchEvent(new Event("change", { bubbles: true })); }
function openProperties() {
  const submit = vi.fn(async () => true);
  const modal = new BulkPropertiesModal({} as never, { strings: bulkMetadataStrings.en, snapshot, targetCount: 2 }, submit);
  modal.open(); button("Add property").click();
  return { submit, modal };
}
beforeEach(() => { installFormDomHelpers(); document.body.replaceChildren(); });
afterEach(() => { document.body.replaceChildren(); });

describe("combined tag modal", () => {
  it("selects multiple native suggestions, shows counts, resolves conflicts and submits only via Apply", async () => {
    const submit = vi.fn(async () => true);
    const modal = new BulkTagsModal({} as never, { strings: bulkMetadataStrings.en, snapshot, targetCount: 2 }, submit);
    modal.open();
    expect(button("Apply").disabled).toBe(true);
    const add = field("Add tags"); const remove = field("Remove tags");
    add.focus(); input(add, "alp"); enter(add);
    expect(document.querySelector(".fce-metadata-chips")?.textContent).toContain("Alpha");
    input(add, "brand-new"); enter(add);
    expect(submit).not.toHaveBeenCalled();
    remove.focus(); input(remove, "alpha");
    expect(document.querySelector(".suggestion-container")?.textContent).toBe("Alpha (2)");
    enter(remove);
    expect(button("Apply").disabled).toBe(true);
    expect(document.body.textContent).toContain("conflicting");
    document.querySelector<HTMLButtonElement>('button[aria-label="Remove: Alpha"]')!.click();
    expect(button("Apply").disabled).toBe(false);
    input(remove, "unavailable"); enter(remove);
    button("Apply").click();
    await vi.waitFor(() => expect(submit).toHaveBeenCalledWith({ addTags: ["brand-new"], removeTags: ["Alpha"] }));
    expect(modal.contentEl.isConnected).toBe(false);
    expect(document.querySelector(".suggestion-container")).toBeNull();
  });
  it("preserves IME input, Escape dismissal, mouse selection and close cleanup", () => {
    const submit = vi.fn(async () => true);
    const modal = new BulkTagsModal({} as never, { strings: bulkMetadataStrings.zh, snapshot, targetCount: 2 }, submit);
    modal.open();
    const add = field("添加标签"); add.focus();
    add.dispatchEvent(new CompositionEvent("compositionstart"));
    input(add, "新");
    add.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }));
    expect(document.querySelector(".fce-metadata-chips")?.textContent).toBe("");
    add.dispatchEvent(new CompositionEvent("compositionend")); input(add, "");
    add.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    add.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(document.querySelector(".suggestion-container")).toBeNull();
    input(add, "beta"); document.querySelector<HTMLElement>(".suggestion-item")!.click();
    expect(document.querySelector(".fce-metadata-chips")?.textContent).toContain("Beta");
    input(add, "alpha"); modal.close();
    expect(document.querySelector(".suggestion-container")).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });
  it("locks drafts while submitting and retains the draft after failure for retry", async () => {
    let resolve!: (value: boolean) => void;
    const submit = vi.fn(() => new Promise<boolean>((done) => { resolve = done; }));
    const modal = new BulkTagsModal({} as never, { strings: bulkMetadataStrings.en, snapshot, targetCount: 2 }, submit);
    modal.open(); const add = field("Add tags"); input(add, "new"); enter(add);
    button("Apply").click();
    expect(add.disabled).toBe(true); expect(button("Applying…").disabled).toBe(true);
    button("Applying…").click(); expect(submit).toHaveBeenCalledTimes(1);
    resolve(false);
    await vi.waitFor(() => expect(add.disabled).toBe(false));
    expect(document.querySelector(".fce-metadata-chips")?.textContent).toContain("new");
    button("Apply").click(); expect(submit).toHaveBeenCalledTimes(2); resolve(true);
    await vi.waitFor(() => expect(modal.contentEl.isConnected).toBe(false));
  });
});

describe("bulk property modal", () => {
  it.each([
    ["text", "text", "  original  ", "  original  "], ["number", "number", "0", 0],
    ["date", "date", "2024-02-29", "2024-02-29"], ["datetime", "datetime-local", "2024-02-29T12:30", "2024-02-29T12:30:00"],
  ])("writes %s values using the native input", async (type, native, raw, value) => {
    const { submit } = openProperties(); input(field("Property name"), "New"); chooseType(type as string);
    const editor = field("Value"); expect(editor.type).toBe(native); input(editor, raw as string); enter(editor);
    expect(submit).not.toHaveBeenCalled(); button("Apply").click();
    await vi.waitFor(() => expect(submit).toHaveBeenCalledWith({ setProperties: [{ name: "New", type, value }], removeKeys: [] }));
  });
  it("infers cached value types, keeps empty text/list valid and rejects incomplete numbers", () => {
    const { modal } = openProperties();
    input(field("Property name"), "Score");
    expect(field("Value").type).toBe("number"); expect(button("Apply").disabled).toBe(true);
    input(field("Value"), "0"); expect(button("Apply").disabled).toBe(false);
    chooseType("text"); input(field("Value"), ""); expect(button("Apply").disabled).toBe(false);
    chooseType("list"); expect(button("Apply").disabled).toBe(false);
    modal.close();
  });
  it("adds typed list items using suggestions and submits a checkbox as false", async () => {
    const { submit } = openProperties(); input(field("Property name"), "List");
    const editor = field("Value"); editor.focus(); input(editor, "o"); enter(editor);
    expect(document.querySelector(".fce-metadata-chips")?.textContent).toContain("one");
    const itemType = document.querySelector<HTMLSelectElement>(".fce-property-value-editor select")!;
    itemType.value = "number"; itemType.dispatchEvent(new Event("change"));
    input(editor, "1"); enter(editor);
    button("Add property").click();
    const names = document.querySelectorAll<HTMLInputElement>('input[aria-label="Property name"]'); input(names[1], "Enabled");
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    button("Apply").click();
    await vi.waitFor(() => expect(submit).toHaveBeenCalledWith({ setProperties: [{ name: "List", type: "list", value: ["one", 1] }, { name: "Enabled", type: "checkbox", value: false }], removeKeys: [] }));
  });
  it("blocks duplicate/conflicting keys, removes draft rows and disposes their suggestions", async () => {
    const { submit } = openProperties(); input(field("Property name"), "Status"); input(field("Value"), "new");
    const remove = field("Remove properties"); remove.focus(); input(remove, "stat"); enter(remove);
    expect(button("Apply").disabled).toBe(true);
    button("Add property").click();
    const names = document.querySelectorAll<HTMLInputElement>('input[aria-label="Property name"]'); input(names[1], "STATUS");
    expect(button("Apply").disabled).toBe(true);
    names[1].focus(); input(names[1], "sta");
    const rows = document.querySelectorAll<HTMLElement>(".fce-property-edit-row");
    rows[1].querySelector<HTMLButtonElement>(".setting-item-control button")!.click();
    expect(document.querySelector(".suggestion-container")).toBeNull();
    rows[0].querySelector<HTMLButtonElement>(".setting-item-control button")!.click();
    expect(button("Apply").disabled).toBe(false);
    button("Apply").click();
    await vi.waitFor(() => expect(submit).toHaveBeenCalledWith({ setProperties: [], removeKeys: ["Status"] }));
  });
});
