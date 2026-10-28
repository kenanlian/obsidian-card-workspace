import { afterEach, describe, expect, it, vi } from "vitest";
import { FuzzySuggestModal, type App } from "obsidian";
import { installObsidianDomHelpers } from "../__mocks__/obsidian-dom";
import { openQuickInputSuggest, type QuickInputSuggestOptions } from "./quick-input-suggest";

const scope = globalThis as { activeDocument?: Document };
let cleanup: (() => void) | undefined;
let modals: Array<FuzzySuggestModal<unknown>> = [];
afterEach(() => { cleanup?.(); modals = []; vi.restoreAllMocks(); delete scope.activeDocument; document.body.replaceChildren(); });
const open = FuzzySuggestModal.prototype.open;
function fixture(multiple = false, count = 3, initial: string[] = [], extra: Partial<QuickInputSuggestOptions> = {}) {
  vi.spyOn(FuzzySuggestModal.prototype, "open").mockImplementation(function (this: FuzzySuggestModal<unknown>) { modals.push(this); open.call(this); });
  const frame = document.createElement("iframe"); document.body.append(frame);
  const doc = frame.contentDocument!;
  installObsidianDomHelpers(doc);
  scope.activeDocument = doc;
  const selected = new Set<string>(initial);
  let closed = 0;
  const suggest = openQuickInputSuggest({} as App, {
    candidates: Array.from({ length: count }, (_, i) => ({ id: String(i), name: `Folder/${i}` })),
    placeholder: "Choose", emptyText: "No boxes", noMatchText: "No matches",
    selected: (id) => selected.has(id), multiple,
    select: (id) => { if (selected.has(id)) selected.delete(id); else selected.add(id); },
    onClose: () => { closed++; }, ...extra });
  cleanup = () => suggest.dispose();
  const prompt = () => doc.querySelector<HTMLElement>(".modal-container");
  const rows = () => Array.from(doc.querySelectorAll<HTMLElement>(".suggestion-item"));
  const query = (text: string) => { const input = doc.querySelector<HTMLInputElement>(".prompt-input")!; input.value = text; input.dispatchEvent(new Event("input")); };
  return { doc, suggest, prompt, rows, query, selected, closed: () => closed };
}

describe("quick input choice prompt", () => {
  it("opens the host prompt in the active draft document with left-aligned name rows", () => {
    const f = fixture(false, 3, ["1"]);
    expect(f.prompt()).not.toBeNull();
    expect(document.querySelector(".modal-container")).toBeNull();
    expect(f.doc.querySelector<HTMLInputElement>(".prompt-input")!.placeholder).toBe("Choose");
    const row = f.rows()[1];
    expect(row.classList.contains("fce-quick-input-choice-row")).toBe(true);
    expect(row.querySelector(".fce-quick-input-choice-name")!.textContent).toBe("Folder/1");
    expect(row.getAttribute("aria-selected")).toBe("true");
    expect(f.rows()[0].getAttribute("aria-selected")).toBe("false");
  });

  it("closes before choosing a single item and never restores focus to the opener", () => {
    const f = fixture();
    f.query("Folder/2"); expect(f.rows()).toHaveLength(1);
    f.rows()[0].click();
    expect(f.selected.has("2")).toBe(true);
    expect(f.prompt()).toBeNull(); expect(f.closed()).toBe(1);
    expect(modals[0].shouldRestoreSelection).toBe(false);
    f.suggest.dispose(); expect(f.closed()).toBe(1);
  });

  it("keeps multiselect open and repaints selection marks in place", () => {
    const f = fixture(true);
    f.rows()[0].click();
    expect(f.prompt()).not.toBeNull(); expect(f.selected.has("0")).toBe(true);
    expect(f.rows()[0].getAttribute("aria-selected")).toBe("true");
    f.rows()[1].click(); f.rows()[0].click();
    expect([...f.selected]).toEqual(["1"]);
    expect(f.rows()[0].getAttribute("aria-selected")).toBe("false");
    f.suggest.dispose(); expect(f.prompt()).toBeNull(); expect(f.closed()).toBe(1);
  });

  it("explains empty candidates separately from empty matches and passes keyboard hints", () => {
    const instructions = [{ command: "esc", purpose: "Done" }];
    const empty = fixture(true, 0, [], { instructions });
    expect(empty.doc.querySelector(".suggestion-empty")!.textContent).toBe("No boxes");
    expect((modals[0] as unknown as { instructions: unknown }).instructions).toEqual(instructions);
    empty.suggest.dispose();
    const f = fixture();
    f.query("nothing");
    expect(f.rows()).toHaveLength(0);
    expect(f.doc.querySelector(".suggestion-empty")!.textContent).toBe("No matches");
  });
});
