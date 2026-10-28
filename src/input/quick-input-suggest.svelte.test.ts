import { afterEach, describe, expect, it } from "vitest";
import { installObsidianDomHelpers } from "../__mocks__/obsidian-dom";
import { openQuickInputSuggest } from "./quick-input-suggest";

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); document.body.replaceChildren(); });
function fixture(multiple = false, count = 100, initial: string[] = []) {
  const frame = document.createElement("iframe"); document.body.append(frame);
  const doc = frame.contentDocument!, win = frame.contentWindow! as Window & typeof globalThis;
  installObsidianDomHelpers(doc);
  const anchor = doc.body.createEl("button"); doc.body.append(anchor);
  anchor.getBoundingClientRect = () => ({ left: 40, top: 120, right: 120, bottom: 150, width: 80, height: 30, x: 40, y: 120, toJSON: () => ({}) });
  const selected = new Set<string>(initial);
  let restored = 0;
  const suggest = openQuickInputSuggest({ anchor,
    candidates: Array.from({ length: count }, (_, i) => ({ id: String(i), name: `Folder/${i}` })),
    emptyText: "No boxes", noMatchText: "No matches",
    selected: (id) => selected.has(id), multiple,
    select: (id) => { if (selected.has(id)) selected.delete(id); else selected.add(id); }, restoreFocus: () => { restored++; } });
  cleanup = () => suggest.dispose();
  const input = () => doc.querySelector<HTMLInputElement>(".fce-quick-input-choice-search")!;
  const popover = () => doc.querySelector<HTMLElement>(".fce-quick-input-choice-popover");
  const rows = () => Array.from(doc.querySelectorAll<HTMLElement>(".suggestion-item"));
  const active = () => rows().findIndex((row) => row.classList.contains("is-selected"));
  const key = (name: string, isComposing = false) => input().dispatchEvent(new win.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, isComposing }));
  const query = (text: string) => { input().value = text; input().dispatchEvent(new win.Event("input")); };
  return { doc, win, input, popover, rows, active, key, query, selected, restored: () => restored };
}
describe("draft destination suggestions", () => {
  it("anchors search and results in one popover above the button, inside the draft document", () => {
    const f = fixture();
    const popover = f.popover()!;
    expect(popover.contains(f.input())).toBe(true);
    expect(popover.querySelector(".suggestion")!.children).toHaveLength(20);
    expect(popover.style.bottom).toBe(`${f.win.innerHeight - 120 + 6}px`);
    expect(popover.style.top).toBe("");
    expect(popover.style.maxHeight).toBe(`${120 - 6 - 8}px`);
    expect(f.doc.activeElement).toBe(f.input());
    expect(document.querySelector(".fce-quick-input-choice-popover")).toBeNull();
  });
  it("caps visible rows at twenty, searches every candidate and chooses with the keyboard", () => {
    const f = fixture(); expect(f.rows()).toHaveLength(20);
    f.query("Folder/99"); expect(f.rows()).toHaveLength(1);
    f.key("Enter"); expect(f.selected.has("99")).toBe(true);
    expect(f.popover()).toBeNull(); expect(f.restored()).toBe(1);
  });
  it("starts on the current choice and moves with arrow keys, wrapping at the ends", () => {
    const f = fixture(false, 5, ["3"]);
    expect(f.active()).toBe(3);
    f.key("ArrowDown"); expect(f.active()).toBe(4);
    f.key("ArrowDown"); expect(f.active()).toBe(0);
    f.key("ArrowUp"); expect(f.active()).toBe(4);
    f.key("Enter"); expect(f.selected.has("4")).toBe(true);
  });
  it("keeps multiselect open with selection marks and Escape restores focus", () => {
    const f = fixture(true); f.rows()[0].click();
    expect(f.selected.has("0")).toBe(true); expect(f.rows()).toHaveLength(20);
    expect(f.rows()[0].getAttribute("aria-selected")).toBe("true");
    f.rows()[1].click(); expect(f.selected.has("1")).toBe(true);
    f.rows()[0].click(); expect(f.selected.has("0")).toBe(false);
    f.key("Escape"); expect(f.popover()).toBeNull(); expect(f.restored()).toBe(1); expect(f.selected.has("1")).toBe(true);
  });
  it("does not filter or choose during IME composition and dismisses on outside pointerdown", () => {
    const f = fixture(true);
    f.input().dispatchEvent(new f.win.CompositionEvent("compositionstart"));
    f.query("Folder/9"); expect(f.rows()).toHaveLength(20);
    f.key("Enter"); expect(f.selected.size).toBe(0);
    f.input().dispatchEvent(new f.win.CompositionEvent("compositionend"));
    expect(f.rows().every((row) => row.textContent!.includes("Folder/9"))).toBe(true);
    f.doc.body.dispatchEvent(new f.win.Event("pointerdown", { bubbles: true }));
    expect(f.popover()).toBeNull(); expect(f.restored()).toBe(0);
  });
  it("explains empty candidates and empty matches, and Escape still dismisses", () => {
    const empty = fixture(true, 0);
    expect(empty.doc.querySelector(".suggestion-empty")!.textContent).toBe("No boxes");
    empty.key("Escape"); expect(empty.popover()).toBeNull();
    const f = fixture();
    f.query("no matching folder");
    expect(f.rows()).toHaveLength(0);
    expect(f.doc.querySelector(".suggestion-empty")!.textContent).toBe("No matches");
    f.key("Enter"); expect(f.selected.size).toBe(0);
    f.key("Escape"); expect(f.popover()).toBeNull(); expect(f.restored()).toBe(1);
  });
});
