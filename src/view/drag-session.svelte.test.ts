import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DragSession } from "./drag-session";

function touch(type: string, x = 20, y = 30, count = 1): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: Array.from({ length: count }, (_, identifier) => ({ identifier, clientX: x, clientY: y })) });
  return event;
}
const sessions: DragSession[] = [];
function setup() {
  const session = new DragSession(); sessions.push(session);
  const node = document.createElement("div"); document.body.append(node);
  const paths = ["A.md", "B.md"];
  const action = session.bindTouch(node, () => ({ kind: "cards", paths, label: "A" }));
  return { session, node, paths, action };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { for (const session of sessions.splice(0)) session.dispose(); vi.runOnlyPendingTimers(); vi.useRealTimers(); document.body.replaceChildren(); });
describe("document-owned drag sessions", () => {
  it("activates at 500ms, freezes ordered paths, shows a count and consumes active touch moves", () => {
    const { session, node, paths } = setup();
    node.dispatchEvent(touch("touchstart")); vi.advanceTimersByTime(499); expect(session.current).toBeNull();
    vi.advanceTimersByTime(1); paths.push("C.md");
    expect(session.current?.source).toEqual({ kind: "cards", paths: ["A.md", "B.md"], label: "A" });
    expect(document.querySelector(".fce-card-drag-count")?.textContent).toBe("2");
    const move = touch("touchmove", 70, 90); document.dispatchEvent(move);
    expect(move.defaultPrevented).toBe(true); expect(session.current?.x).toBe(70);
    expect((document.querySelector(".fce-touch-drag-ghost") as HTMLElement).style.left).toBe("86px");
  });
  it.each(["move", "scroll", "second-touch", "release", "cancel", "blur"])("lets %s win before activation", (reason) => {
    const { session, node } = setup(); node.dispatchEvent(touch("touchstart"));
    if (reason === "move") { const event = touch("touchmove", 29); document.dispatchEvent(event); expect(event.defaultPrevented).toBe(false); }
    if (reason === "scroll") document.dispatchEvent(new Event("scroll"));
    if (reason === "second-touch") document.dispatchEvent(touch("touchstart", 20, 30, 2));
    if (reason === "release") document.dispatchEvent(touch("touchend", 20, 30, 0));
    if (reason === "cancel") document.dispatchEvent(touch("touchcancel"));
    if (reason === "blur") window.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(500); expect(session.current).toBeNull();
  });
  it("survives source removal and commits once from document touchend", () => {
    const { session, node, action } = setup(); node.dispatchEvent(touch("touchstart")); vi.advanceTimersByTime(500);
    action.destroy(); node.remove(); const commit = vi.fn(); session.setTarget(commit);
    node.dispatchEvent(touch("touchmove", 60, 80)); node.dispatchEvent(touch("touchend", 60, 80, 0));
    document.dispatchEvent(touch("touchend", 60, 80, 0));
    expect(commit).toHaveBeenCalledOnce(); expect(session.current).toBeNull();
    expect(document.querySelector(".fce-touch-drag-ghost")).toBeNull();
  });
  it.each(["second-touch", "cancel", "blur", "escape", "scope"])("cancels an active drag on %s without committing", (reason) => {
    const { session, node } = setup(); node.dispatchEvent(touch("touchstart")); vi.advanceTimersByTime(500); const commit = vi.fn(); session.setTarget(commit);
    if (reason === "second-touch") document.dispatchEvent(touch("touchstart", 20, 30, 2));
    if (reason === "cancel") document.dispatchEvent(touch("touchcancel"));
    if (reason === "blur") window.dispatchEvent(new Event("blur"));
    if (reason === "escape") document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    if (reason === "scope") session.cancel();
    document.dispatchEvent(touch("touchend", 20, 30, 0)); expect(commit).not.toHaveBeenCalled(); expect(session.current).toBeNull();
  });
  it("excludes action controls and removes pending activation when its source unmounts", () => {
    const { session, node, action } = setup(); const button = document.createElement("button"); node.append(button);
    button.dispatchEvent(touch("touchstart")); vi.advanceTimersByTime(500); expect(session.current).toBeNull();
    node.dispatchEvent(touch("touchstart")); action.destroy(); vi.advanceTimersByTime(500); expect(session.current).toBeNull();
  });
  it("suppresses an early native contextmenu without retiring the pending long press", () => {
    const { session, node } = setup(); const menu = vi.fn(); node.addEventListener("contextmenu", menu);
    node.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); expect(menu).toHaveBeenCalledOnce();
    node.dispatchEvent(touch("touchstart")); vi.advanceTimersByTime(350);
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); node.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true); expect(menu).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(150); expect(session.current?.mode).toBe("touch");
  });
  it("suppresses the synthetic click after completing a touch drag", () => {
    const { node } = setup(); const click = vi.fn(); node.addEventListener("click", click);
    node.dispatchEvent(touch("touchstart")); vi.advanceTimersByTime(500); document.dispatchEvent(touch("touchend", 20, 30, 0));
    node.click(); expect(click).not.toHaveBeenCalled(); vi.advanceTimersByTime(650); node.click(); expect(click).toHaveBeenCalledOnce();
  });
});
