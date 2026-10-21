import { describe, expect, it, vi } from "vitest";
import { QuickInputShortcut, normalizeQuickInputAccelerator, captureQuickInputAccelerator } from "./QuickInputShortcut";
import type { QuickInputShortcutBridge } from "./quick-input-desktop";

function fixture(shared = new Map<string, () => void>()) {
  const bridge: QuickInputShortcutBridge = {
    register: vi.fn((key, callback) => { if (shared.has(key)) return false; shared.set(key, callback); return true; }),
    isRegistered: (key) => shared.has(key),
    unregister: vi.fn((key) => { shared.delete(key); }),
  };
  const save = vi.fn(async (_key: string) => {}), open = vi.fn();
  const resolveBridge = vi.fn(() => bridge);
  const shortcut = new QuickInputShortcut({ bridge: resolveBridge, save, open });
  return { shortcut, bridge, resolveBridge, shared, save, open };
}
describe("global quick input shortcut ownership", () => {
  it("does nothing for the unset default and canonicalizes explicitly applied combinations", async () => {
    const f = fixture(); await f.shortcut.start("");
    expect(f.resolveBridge).not.toHaveBeenCalled();
    await f.shortcut.apply(" shift + ctrl + q ");
    expect(f.save).toHaveBeenCalledExactlyOnceWith("Control+Shift+Q");
    f.shared.get("Control+Shift+Q")!(); expect(f.open).toHaveBeenCalledOnce();
    expect(f.shortcut.getState()).toEqual({ active: ["Control+Shift+Q"], error: null, pending: false });
    f.shortcut.dispose();
  });
  it("keeps the old binding until the replacement is persisted", async () => {
    const f = fixture(); await f.shortcut.start("Control+Q");
    let done!: () => void;
    f.save.mockImplementation(() => new Promise((resolve) => { done = resolve; }));
    const pending = f.shortcut.apply("Control+W");
    expect([...f.shared.keys()]).toEqual(["Control+Q", "Control+W"]);
    expect(f.shortcut.getState().pending).toBe(true);
    done(); await pending;
    expect([...f.shared.keys()]).toEqual(["Control+W"]);
    expect(f.bridge.unregister).toHaveBeenCalledExactlyOnceWith("Control+Q");
    f.shortcut.dispose();
  });
  it("preserves saved configuration and old binding on invalid input or conflicts", async () => {
    const f = fixture(); await f.shortcut.start("Control+Q"); f.shared.set("Control+W", () => {});
    await f.shortcut.apply("Control+W");
    expect(f.shortcut.getState()).toMatchObject({ active: ["Control+Q"], error: "conflict" });
    await f.shortcut.apply("Q"); expect(f.shortcut.getState().error).toBe("invalid");
    expect(f.save).not.toHaveBeenCalled(); f.shortcut.dispose();
    expect([...f.shared.keys()]).toEqual(["Control+W"]);
  });
  it("reports a startup conflict and never unregisters another vault's binding", async () => {
    const shared = new Map<string, () => void>(); const one = fixture(shared), two = fixture(shared);
    await one.shortcut.start("Control+Q"); await two.shortcut.start("Control+Q");
    expect(two.shortcut.getState()).toMatchObject({ active: [], error: "conflict" });
    two.shortcut.dispose(); expect(shared.has("Control+Q")).toBe(true);
    expect(two.bridge.unregister).not.toHaveBeenCalled(); expect(two.save).not.toHaveBeenCalled();
    one.shortcut.dispose(); expect(shared.size).toBe(0);
  });
  it("retains owned registrations and reports failed saves accurately until a retry succeeds", async () => {
    const f = fixture(); await f.shortcut.start("Control+Q");
    f.save.mockRejectedValueOnce(new Error("disk full")); await f.shortcut.apply("Control+W");
    expect(f.shortcut.getState()).toEqual({ active: ["Control+Q", "Control+W"], error: "save-failed", pending: false });
    await f.shortcut.apply("Control+W"); expect(f.bridge.register).toHaveBeenCalledTimes(2);
    expect(f.shortcut.getState()).toMatchObject({ active: ["Control+W"], error: null });
    f.shortcut.dispose();
  });
  it("clears this instance immediately and keeps failure visible for persistence retry", async () => {
    const f = fixture(); await f.shortcut.start("Control+Q"); f.shared.set("Control+W", () => {});
    f.save.mockRejectedValueOnce(new Error("save")); await f.shortcut.apply("");
    expect(f.shortcut.getState()).toMatchObject({ active: [], error: "save-failed" });
    expect([...f.shared.keys()]).toEqual(["Control+W"]);
    await f.shortcut.apply(""); expect(f.shortcut.getState().error).toBeNull(); f.shortcut.dispose();
  });
  it("releases both registrations on unload during a save and ignores late callbacks", async () => {
    const f = fixture(); await f.shortcut.start("Control+Q"); let done!: () => void;
    const callback = f.shared.get("Control+Q")!;
    f.save.mockImplementation(() => new Promise((resolve) => { done = resolve; }));
    const pending = f.shortcut.apply("Control+W"); f.shortcut.dispose(); f.shortcut.dispose();
    done(); await pending; callback();
    expect(f.shared.size).toBe(0); expect(f.open).not.toHaveBeenCalled();
    expect(f.bridge.unregister).toHaveBeenCalledTimes(2);
  });
  it("reports missing desktop capabilities and Electron validation errors", async () => {
    const f = fixture(); f.resolveBridge.mockImplementation(() => { throw new Error("missing"); });
    await f.shortcut.start("Control+Q"); expect(f.shortcut.getState().error).toBe("unavailable");
    const g = fixture(); vi.mocked(g.bridge.register).mockImplementation(() => { throw new Error("bad accelerator"); });
    await g.shortcut.apply("Control+Q"); expect(g.shortcut.getState().error).toBe("invalid");
    expect(g.save).not.toHaveBeenCalled();
  });
  it("captures physical letter keys, ignores IME, and rejects duplicated modifiers", () => {
    expect(normalizeQuickInputAccelerator("Ctrl+Control+Q")).toBeNull();
    expect(captureQuickInputAccelerator({ key: "Q", code: "KeyQ", ctrlKey: true, shiftKey: true } as KeyboardEvent)).toBe("Control+Shift+Q");
    expect(captureQuickInputAccelerator({ key: "Process", isComposing: true } as KeyboardEvent)).toBeNull();
  });
});
