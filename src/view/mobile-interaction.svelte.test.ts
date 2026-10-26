import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { touchMenu } from "./touch-menu";
import { installVisualViewport } from "../runtime/visual-viewport";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });
function pointer(target: EventTarget, type: string, x = 0, y = 0, id = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: id, pointerType: "touch", clientX: x, clientY: y }); target.dispatchEvent(event); return event;
}
function setup() {
  const node = document.createElement("div"); document.body.append(node);
  const open = vi.fn(), click = vi.fn(), context = vi.fn();
  const action = touchMenu(node, open); node.addEventListener("click", click); node.addEventListener("contextmenu", context);
  return { node, open, click, context, action };
}
describe("touch context intent", () => {
  it("waits 500ms, tolerates 8px and suppresses the generated click/context menu", async () => {
    const f = setup(); const down = pointer(f.node, "pointerdown", 10, 12);
    expect(down.defaultPrevented).toBe(false);
    pointer(window, "pointermove", 18, 12);
    await vi.advanceTimersByTimeAsync(499); expect(f.open).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(f.open).toHaveBeenCalledOnce();
    expect(f.open.mock.calls[0][0]).toMatchObject({ clientX: 10, clientY: 12 });
    pointer(window, "pointerup"); f.node.click(); f.node.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    expect(f.click).not.toHaveBeenCalled(); expect(f.context).not.toHaveBeenCalled();
    pointer(f.node, "pointerdown"); pointer(window, "pointerup"); f.node.click(); expect(f.click).toHaveBeenCalledOnce(); f.action.destroy();
  });
  it.each(["pointerup", "pointercancel", "scroll", "move", "multitouch", "destroy"])("cancels on %s without eating an ordinary click", async kind => {
    const f = setup(); pointer(f.node, "pointerdown");
    if (kind === "move") pointer(window, "pointermove", 9);
    else if (kind === "multitouch") pointer(window, "pointerdown", 0, 0, 2);
    else if (kind === "destroy") f.action.destroy();
    else if (kind === "scroll") window.dispatchEvent(new Event("scroll"));
    else pointer(window, kind);
    await vi.advanceTimersByTimeAsync(600); expect(f.open).not.toHaveBeenCalled();
    f.node.click(); expect(f.click).toHaveBeenCalledOnce(); f.action.destroy();
  });
  it("preserves interactive child buttons and desktop mouse context menus", async () => {
    const f = setup(), button = document.createElement("button"); f.node.append(button);
    pointer(button, "pointerdown"); await vi.advanceTimersByTimeAsync(600); expect(f.open).not.toHaveBeenCalled();
    f.node.dispatchEvent(new MouseEvent("contextmenu")); expect(f.context).toHaveBeenCalledOnce(); f.action.destroy();
  });
});
describe("owning visual viewport", () => {
  it("coalesces keyboard resize/scroll updates, never moves focus, and cancels on cleanup", async () => {
    const viewport = Object.assign(new EventTarget(), { height: 400, offsetTop: 0 });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    const root = document.createElement("div"), input = document.createElement("input"); document.body.append(root, input); input.focus();
    const stop = installVisualViewport(root); const raf = vi.spyOn(window, "requestAnimationFrame");
    viewport.height = 240; viewport.offsetTop = 30;
    viewport.dispatchEvent(new Event("resize")); viewport.dispatchEvent(new Event("scroll")); window.dispatchEvent(new Event("resize"));
    expect(raf).toHaveBeenCalledOnce(); await vi.advanceTimersByTimeAsync(20);
    expect(root.style.getPropertyValue("--fce-viewport-height")).toBe("240px"); expect(document.activeElement).toBe(input);
    viewport.dispatchEvent(new Event("resize")); stop(); await vi.advanceTimersByTimeAsync(20);
    expect(root.style.getPropertyValue("--fce-viewport-height")).toBe("");
    viewport.dispatchEvent(new Event("resize")); expect(raf).toHaveBeenCalledTimes(2);
    Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
  });
});
