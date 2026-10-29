import { describe, it, expect, vi, afterEach } from "vitest";
import { mobileNavigation } from "./mobile-navigation";
const state = vi.hoisted(() => ({ opened: [] as Array<{ close: () => void; modalEl: HTMLElement }> }));
vi.mock("obsidian", () => ({ Modal: class {
  contentEl = document.createElement("div"); modalEl = document.createElement("div"); onClose = () => {};
  constructor() { this.modalEl.append(this.contentEl); Object.assign(this.modalEl, { addClass: (...names: string[]) => this.modalEl.classList.add(...names) }); }
  open() { document.body.append(this.modalEl); state.opened.push(this); }
  close() { this.onClose(); this.modalEl.remove(); }
} }));
afterEach(() => { state.opened = []; document.body.replaceChildren(); });
describe("mobile navigation host Modal", () => {
  it("moves one mounted navigation node across resize and closes with the host without duplicating state", () => {
    const shell = document.createElement("div"), nav = document.createElement("nav"), input = document.createElement("input");
    nav.append(input); shell.append(nav); document.body.append(shell); input.value = "query";
    const onClose = vi.fn(), options = { app: {} as never, enabled: true, visible: true, onClose };
    const action = mobileNavigation(nav, options);
    expect(state.opened).toHaveLength(1); expect(shell.contains(nav)).toBe(false); expect(state.opened[0].modalEl.contains(nav)).toBe(true);
    action.update(options); expect(state.opened).toHaveLength(1);
    action.update({ ...options, enabled: false }); expect(shell.contains(nav)).toBe(true); expect(onClose).not.toHaveBeenCalled(); expect(input.value).toBe("query");
    action.update(options); state.opened[1].close(); expect(shell.contains(nav)).toBe(true); expect(onClose).toHaveBeenCalledOnce();
    action.destroy(); expect(shell.childNodes).toHaveLength(1);
  });
});
