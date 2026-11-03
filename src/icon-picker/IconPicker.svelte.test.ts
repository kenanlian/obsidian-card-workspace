import { afterEach, describe, expect, it, vi } from "vitest";
import { IconPicker, closeAllIconPickers, closeIconPickerForAnchor, validateIconPickers, type IconPickerOptions } from "./IconPicker";
import { getEmojiCatalog, isEmojiCatalogInitialized } from "./emoji-catalog";
import { iconStrings } from "../i18n/icons";
import type { EmojiSkinTone, IconSpec } from "../icon-config";
import { renderContentIcon } from "../icon-render";
import { installObsidianDomHelpers } from "../__mocks__/obsidian-dom";

function fixture(doc = document, extra: Partial<IconPickerOptions> = {}) {
  installObsidianDomHelpers(doc);
  const anchor = doc.createElement("button"); doc.body.append(anchor);
  let current: IconSpec = { kind: "lucide", value: "file" };
  let custom = false;
  const apply = vi.fn(async (spec: IconSpec | null) => { current = spec ?? { kind: "lucide", value: "file" }; custom = spec !== null; });
  const retry = vi.fn(async () => {});
  const valid = vi.fn(() => true);
  const setSkinTone = vi.fn<(tone: EmojiSkinTone) => void>();
  const picker = new IconPicker({ anchor, strings: iconStrings.en, read: () => current, canReset: () => custom, apply, retry, isValid: valid, setSkinTone, ...extra });
  return { picker, anchor, apply, retry, valid, setSkinTone, read: () => current };
}
function button(root: HTMLElement, label: string): HTMLButtonElement {
  return Array.from(root.querySelectorAll("button")).find(node => node.textContent === label || node.getAttribute("aria-label") === label)!;
}
function type(root: HTMLElement, value: string): HTMLInputElement {
  const search = root.querySelector<HTMLInputElement>("input[type=search]")!;
  search.value = value; search.dispatchEvent(new Event("input", { bubbles: true }));
  return search;
}
const labels = (root: HTMLElement): string[] => Array.from(root.querySelectorAll(".fce-icon-picker-candidate")).map(node => node.getAttribute("aria-label")!);
const flush = async (): Promise<void> => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
afterEach(() => { closeAllIconPickers(); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("document-local nonmodal icon picker", () => {
  it("opens Lucide with context, sections and a disabled reset, without parsing emoji", () => {
    expect(isEmojiCatalogInitialized()).toBe(false);
    const { picker } = fixture(document, { title: "Projects", subtitle: "Folders", category: "folder" });
    const root = picker.element;
    expect(root.querySelector(".fce-icon-picker-title")!.textContent).toBe("Projects");
    expect(root.querySelector(".fce-icon-picker-subtitle")!.textContent).toBe("Folders");
    expect(Array.from(root.querySelectorAll(".fce-icon-picker-section")).map(node => node.textContent)).toEqual(["Suggested", "All icons"]);
    expect(labels(root)[0]).toBe("folder");
    expect(button(root, "Remove custom icon").disabled).toBe(true);
    expect(document.activeElement).toBe(root.querySelector("input[type=search]"));
    expect(isEmojiCatalogInitialized()).toBe(false);
  });
  it("searches Lucide by ID tokens and Chinese keywords, and closes after a successful choice", async () => {
    const { picker, apply, anchor } = fixture();
    const root = picker.element;
    type(root, "plus file"); expect(labels(root)).toEqual(["file-plus-2"]);
    type(root, "文件夹"); expect(labels(root)).toEqual(["folder"]);
    type(root, "zzz"); expect(root.querySelector<HTMLElement>(".fce-icon-picker-empty")!.hidden).toBe(false);
    expect(root.querySelector(".fce-icon-picker-empty")!.textContent).toBe("No matching icons");
    type(root, "sun");
    root.querySelector<HTMLButtonElement>(".fce-icon-picker-candidate")!.click(); await flush();
    expect(apply).toHaveBeenCalledWith({ kind: "lucide", value: "sun" });
    expect(root.isConnected).toBe(false); expect(document.activeElement).toBe(anchor);
  });
  it("shows recent icons per tab and previews the hovered candidate", () => {
    const { picker } = fixture(document, { recent: () => [{ kind: "emoji", value: "🌙" }, { kind: "lucide", value: "lucide-heart" }] });
    const root = picker.element;
    expect(root.querySelector(".fce-icon-picker-section")!.textContent).toBe("Recently used");
    expect(labels(root)[0]).toBe("heart");
    root.querySelector(".fce-icon-picker-candidate")!.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(root.querySelector(".fce-icon-picker-preview-name")!.textContent).toBe("heart");
    button(root, "Emoji").click();
    expect(labels(root)[0]).toContain("crescent moon");
  });
  it("supports emoji categories, bilingual search, persisted skin tone and whole-sequence paste in search", async () => {
    const { picker, apply, setSkinTone } = fixture();
    const root = picker.element;
    button(root, "Emoji").click();
    expect(isEmojiCatalogInitialized()).toBe(true); expect(getEmojiCatalog().entries.length).toBeGreaterThan(1900);
    expect(root.querySelectorAll(".fce-icon-picker-candidate").length).toBeLessThanOrEqual(120);
    expect(root.querySelectorAll(".fce-icon-picker-group")).toHaveLength(9);
    button(root, "Flags").click();
    expect(button(root, "Flags").getAttribute("aria-pressed")).toBe("true");
    expect(labels(root).some(label => label.includes("flag"))).toBe(true);
    type(root, "拇指向上"); expect(labels(root).length).toBeGreaterThan(0);
    button(root, "Skin tone").click();
    expect(root.querySelector<HTMLElement>(".fce-icon-picker-tones")!.hidden).toBe(false);
    button(root, "Medium").click();
    expect(setSkinTone).toHaveBeenCalledWith("🏽");
    type(root, "thumbs up"); expect(root.textContent).toContain("👍🏽");
    for (const value of ["🇨🇳", "👩🏽‍💻", "🫱🏻‍🫲🏿"]) {
      const { picker: next, apply: nextApply } = fixture();
      const search = type(next.element, value);
      expect(next.element.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe("Emoji");
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await flush();
      expect(nextApply).toHaveBeenLastCalledWith({ kind: "emoji", value });
    }
    const { picker: invalid } = fixture();
    type(invalid.element, "😀😀");
    expect(invalid.element.querySelector(".fce-icon-picker-empty")!.textContent).toBe(iconStrings.en.invalid);
    expect(apply).not.toHaveBeenCalled();
  });
  it("keeps the picker open on a failed save, ignores stale results, and closes after a successful retry", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { picker, apply, retry } = fixture();
    let resolveOld!: () => void;
    apply.mockImplementationOnce(() => new Promise<void>(resolve => { resolveOld = resolve; }));
    const old = picker.select({ kind: "lucide", value: "sun" });
    apply.mockRejectedValueOnce(new Error("new write"));
    await picker.select({ kind: "emoji", value: "🌞" });
    resolveOld(); await old;
    expect(picker.element.isConnected).toBe(true);
    expect(picker.element.querySelector<HTMLElement>(".fce-icon-picker-error")!.hidden).toBe(false);
    button(picker.element, "Retry saving").click(); await flush();
    expect(retry).toHaveBeenCalledTimes(1); expect(apply).toHaveBeenCalledTimes(2);
    expect(picker.element.isConnected).toBe(false);
  });
  it("closes on outside pointer and Escape, invalid identity, removed anchor, or a second click on the anchor", async () => {
    let f = fixture(); document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); expect(f.picker.element.isConnected).toBe(false);
    f = fixture(); f.picker.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); expect(f.picker.element.isConnected).toBe(false);
    f = fixture(); f.valid.mockReturnValue(false); validateIconPickers(); expect(f.picker.element.isConnected).toBe(false);
    f = fixture(); f.anchor.remove(); await Promise.resolve(); expect(f.picker.element.isConnected).toBe(false);
    f = fixture(); expect(closeIconPickerForAnchor(f.anchor)).toBe(true); expect(f.picker.element.isConnected).toBe(false);
  });
  it("closes the tone panel before the picker on Escape", () => {
    const { picker } = fixture();
    button(picker.element, "Emoji").click(); button(picker.element, "Skin tone").click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(picker.element.isConnected).toBe(true);
    expect(picker.element.querySelector<HTMLElement>(".fce-icon-picker-tones")!.hidden).toBe(true);
  });
  it("allows one session per document and mounts into a pop-out ownerDocument", () => {
    const first = fixture(); const second = fixture(); expect(first.picker.element.isConnected).toBe(false);
    const frame = document.createElement("iframe"); document.body.append(frame);
    const popout = fixture(frame.contentDocument!);
    expect(popout.picker.element.ownerDocument).toBe(frame.contentDocument); expect(second.picker.element.isConnected).toBe(true);
    popout.anchor.ownerDocument.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(popout.picker.element.isConnected).toBe(false); expect(second.picker.element.isConnected).toBe(true);
  });
  it("uses roving candidate keys across sections and keyboard tabs", () => {
    const { picker } = fixture();
    const root = picker.element;
    const candidate = root.querySelector<HTMLButtonElement>(".fce-icon-picker-candidate")!;
    candidate.focus(); candidate.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect((document.activeElement as HTMLElement).dataset.index).toBe("1");
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    const suggested = root.querySelectorAll(".fce-icon-picker-grid-row")[0].querySelectorAll("button").length;
    expect(Number((document.activeElement as HTMLElement).dataset.index)).toBe(suggested + 1);
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(Number((document.activeElement as HTMLElement).dataset.index)).toBeGreaterThan(suggested);
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(document.activeElement).toBe(root.querySelector("input[type=search]"));
    button(root, "Icons").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(button(root, "Emoji").getAttribute("aria-selected")).toBe("true");
  });
  it("uses a bottom sheet without focusing search on phones", () => {
    const { picker } = fixture(document, { layout: "sheet", autoFocusSearch: false });
    expect(picker.element.classList.contains("is-sheet")).toBe(true);
    expect(document.activeElement).toBe(picker.element);
  });
  it("offers a plain-text choice that is pressed while active and records no icon", async () => {
    const { picker, apply, read } = fixture();
    const none = button(picker.element, "No icon");
    expect(none.getAttribute("aria-pressed")).toBe("false");
    none.click(); await flush();
    expect(apply).toHaveBeenCalledWith({ kind: "none", value: "" });
    expect(picker.element.isConnected).toBe(false);
    const next = fixture(document, { read });
    expect(button(next.picker.element, "No icon").getAttribute("aria-pressed")).toBe("true");
    expect(next.picker.element.querySelector(".fce-icon-picker-current")!.classList.contains("fce-icon-none")).toBe(true);
  });
  it("renders native text safely and falls back for an unavailable Lucide ID", () => {
    const node = document.createElement("span");
    renderContentIcon(node, { spec: { kind: "emoji", value: "<b>😀</b>" }, fallback: "file" });
    expect(node.children.length).toBe(0); expect(node.textContent).toBe("<b>😀</b>");
    renderContentIcon(node, { spec: { kind: "lucide", value: "missing-icon" }, fallback: "file-text" });
    expect(node.getAttribute("data-icon")).toBe("file-text"); expect(node.classList.contains("fce-emoji-icon")).toBe(false);
    renderContentIcon(node, { spec: { kind: "none", value: "" }, fallback: "file-text" });
    expect(node.childNodes.length).toBe(0); expect(node.classList.contains("fce-icon-none")).toBe(true);
  });
});
