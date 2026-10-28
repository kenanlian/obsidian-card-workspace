import { afterEach, describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { installObsidianDomHelpers } from "../__mocks__/obsidian-dom";
import { openQuickInputSuggest } from "./quick-input-suggest";

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); document.body.replaceChildren(); });
function fixture(multiple = false) {
  const frame = document.createElement("iframe"); document.body.append(frame);
  const doc = frame.contentDocument!, win = frame.contentWindow! as Window & typeof globalThis;
  installObsidianDomHelpers(doc);
  const anchor = doc.body.createEl("button"); doc.body.append(anchor);
  const selected = new Set<string>();
  let restored = 0;
  const suggest = openQuickInputSuggest({ app: {} as App, anchor,
    candidates: Array.from({ length: 100 }, (_, i) => ({ id: String(i), name: `Folder/${i}` })),
    selected: (id) => selected.has(id), multiple,
    select: (id) => { if (selected.has(id)) selected.delete(id); else selected.add(id); }, restoreFocus: () => { restored++; } });
  cleanup = () => suggest.dispose();
  const input = () => doc.querySelector<HTMLInputElement>("input")!;
  const rows = () => Array.from(doc.querySelectorAll<HTMLElement>(".suggestion-item"));
  const key = (name: string, isComposing = false) => input().dispatchEvent(new win.KeyboardEvent("keydown", { key: name, bubbles: true, isComposing }));
  const query = (text: string) => { input().value = text; input().dispatchEvent(new win.Event("input")); };
  return { doc, win, input, rows, key, query, selected, restored: () => restored };
}
describe("draft native destination suggestions", () => {
  it("uses the draft document, caps visible rows at twenty and searches every candidate", () => {
    const f = fixture(); expect(f.rows()).toHaveLength(20);
    expect(document.querySelector(".suggestion-container")).toBeNull();
    f.query("Folder/99"); expect(f.rows()).toHaveLength(1);
    f.key("Enter"); expect(f.selected.has("99")).toBe(true);
    expect(f.doc.querySelector(".suggestion-container")).toBeNull(); expect(f.restored()).toBe(1);
  });
  it("keeps multiselect open with selection marks and Escape restores focus", () => {
    const f = fixture(true); f.rows()[0].click();
    expect(f.selected.has("0")).toBe(true); expect(f.rows()).toHaveLength(20);
    expect(f.rows()[0].getAttribute("aria-selected")).toBe("true");
    f.rows()[1].click(); expect(f.selected.has("1")).toBe(true);
    f.rows()[0].click(); expect(f.selected.has("0")).toBe(false);
    f.key("Escape"); expect(f.doc.querySelector("input")).toBeNull(); expect(f.selected.has("1")).toBe(true);
  });
  it("does not choose during IME composition and keeps search usable for no matches", () => {
    const f = fixture(true); f.key("Enter", true); expect(f.selected.size).toBe(0);
    f.query("missing"); expect(f.rows()).toHaveLength(0); expect(f.input()).not.toBeNull();
    f.query("Folder/9"); expect(f.rows().length).toBeGreaterThan(0);
    f.doc.body.dispatchEvent(new f.win.Event("pointerdown", { bubbles: true }));
    expect(f.doc.querySelector("input")).toBeNull();
  });
});


it("dismisses an empty-result search with Escape even without a native suggestion scope", () => {
  const f = fixture();
  f.query("no matching folder");
  expect(f.rows()).toHaveLength(0);
  f.key("Escape");
  expect(f.doc.querySelector("input")).toBeNull(); expect(f.restored()).toBe(1);
});
