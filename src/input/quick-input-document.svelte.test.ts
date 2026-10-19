import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareQuickInputDocument } from "./quick-input-document";
import { installObsidianDomHelpers } from "../__mocks__/obsidian-dom";

let frame: HTMLIFrameElement;
let child: Window & typeof globalThis;
let cleanups: Array<() => void>;
function prepare() {
  const result = prepareQuickInputDocument(window, child);
  cleanups.push(result.dispose);
  return result;
}
function loadResources() {
  for (const element of Array.from(child.document.querySelectorAll("script, link"))) element.dispatchEvent(new Event("load"));
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => {
  cleanups = [];
  document.head.replaceChildren(); document.body.replaceChildren(); document.body.className = "theme-dark mod-windows is-frameless is-focused";
  const enhance = document.createElement("script"); enhance.src = "app://obsidian.md/enhance.js"; document.head.append(enhance);
  frame = document.createElement("iframe"); document.body.append(frame);
  child = frame.contentWindow! as Window & typeof globalThis; installObsidianDomHelpers(child.document);
  window.activeWindow = window; window.activeDocument = document;
});
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  document.head.replaceChildren(); document.body.replaceChildren(); document.body.className = ""; document.body.removeAttribute("style");
  window.activeWindow = window; window.activeDocument = document; vi.restoreAllMocks();
});

describe("custom quick input document", () => {
  it("loads only the host DOM initializer and existing styles before becoming ready", async () => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "app://obsidian.md/app.css"; document.head.append(css);
    const style = document.createElement("style"); style.textContent = ".fce-quick-input { color: red; }"; document.head.append(style);
    const cmStyle = document.createElement("style"); cmStyle.textContent = ".ͼ1 { color: blue; }"; document.head.append(cmStyle);
    const runtime = prepare(); const ready = vi.fn(); void runtime.ready.then(ready);
    await tick(); expect(ready).not.toHaveBeenCalled();
    child.document.querySelector("script")!.dispatchEvent(new Event("load"));
    await tick(); expect(ready).not.toHaveBeenCalled();
    child.document.querySelector("link")!.dispatchEvent(new Event("load"));
    await runtime.ready;
    expect(child.document.querySelector("base")!.href).toBe(document.baseURI);
    expect(child.document.querySelector("script")!.src).toBe("app://obsidian.md/enhance.js");
    expect(child.document.querySelectorAll("script")).toHaveLength(1);
    expect(child.document.querySelectorAll("style")).toHaveLength(1);
    expect(child.document.documentElement.classList.contains("fce-quick-input-window")).toBe(true);
    expect(child.document.body.classList.contains("theme-dark")).toBe(true);
    expect(child.document.body.classList.contains("is-frameless")).toBe(false);
    expect(child.document.body.classList.contains("is-focused")).toBe(false);
  });

  it("updates theme and cascade incrementally without replacing editor DOM or editor-owned styles", async () => {
    const first = document.createElement("style"); first.textContent = ".first {}";
    const second = document.createElement("style"); second.textContent = ".second {}";
    document.head.append(first, second);
    const runtime = prepare(); loadResources(); await runtime.ready;
    const original = child.document.querySelector("style")!;
    const editor = child.document.createElement("div"); child.document.body.append(editor);
    const ownedStyle = child.document.createElement("style"); ownedStyle.textContent = ".editor-owned {}"; child.document.head.append(ownedStyle);
    document.body.style.setProperty("--font-text-override", "My font");
    document.body.className = "theme-light mod-windows is-frameless";
    first.textContent = ".first { color: green; }";
    await tick();
    expect(child.document.querySelector("style")).toBe(original);
    expect(original.textContent).toContain("green"); expect(editor.isConnected).toBe(true); expect(ownedStyle.isConnected).toBe(true);
    expect(child.document.body.classList.contains("theme-dark")).toBe(false); expect(child.document.body.classList.contains("theme-light")).toBe(true);
    expect(child.document.body.style.getPropertyValue("--font-text-override")).toBe("My font");
    document.head.insertBefore(second, first); await tick();
    expect(Array.from(child.document.querySelectorAll("style"), (node) => node.textContent)).toEqual([".second {}", ".first { color: green; }", ".editor-owned {}"]);
    first.remove(); document.body.style.removeProperty("--font-text-override"); await tick();
    expect(original.isConnected).toBe(false); expect(child.document.body.style.getPropertyValue("--font-text-override")).toBe("");
    runtime.dispose();
    document.body.className = "theme-dark"; second.textContent = ".changed {}"; await tick();
    expect(child.document.body.classList.contains("theme-light")).toBe(true);
    expect(child.document.querySelectorAll("style")).toHaveLength(1); expect(ownedStyle.isConnected).toBe(true);
  });

  it("relays keys from their source realm and reflects host cancellation back to the child", async () => {
    const runtime = prepare(); loadResources(); await runtime.ready;
    const editor = child.document.createElement("div"); child.document.body.append(editor);
    const received = vi.fn((event: KeyboardEvent) => {
      if ((event as KeyboardEvent & { isRelayed?: boolean }).isRelayed) event.preventDefault();
    });
    window.addEventListener("keydown", received);
    cleanups.push(() => window.removeEventListener("keydown", received));
    const event = new child.KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true });
    editor.dispatchEvent(event);
    expect(received).toHaveBeenCalledOnce();
    expect(received.mock.calls[0][0].key).toBe("Enter");
    expect(received.mock.calls[0][0].ctrlKey).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(window.activeWindow).toBe(child); expect(window.activeDocument).toBe(child.document);
    child.dispatchEvent(new Event("blur")); expect(window.activeWindow).toBe(window);
    child.dispatchEvent(new Event("focus")); expect(window.activeWindow).toBe(child);
    runtime.dispose(); expect(window.activeWindow).toBe(window);
    editor.dispatchEvent(new child.KeyboardEvent("keydown", { key: "x", bubbles: true }));
    expect(received).toHaveBeenCalledOnce();
  });

  it("does not overwrite another focused window during cleanup", async () => {
    const runtime = prepare(); loadResources(); await runtime.ready;
    child.dispatchEvent(new Event("focus"));
    const other = document.createElement("iframe"); document.body.append(other);
    window.activeWindow = other.contentWindow!; window.activeDocument = other.contentDocument!;
    runtime.dispose();
    expect(window.activeWindow).toBe(other.contentWindow); expect(window.activeDocument).toBe(other.contentDocument);
  });

  it("rejects missing or failed DOM initialization and releases pending resources on close", async () => {
    document.head.replaceChildren(); expect(() => prepare()).toThrow("Missing host DOM initializer");
    const script = document.createElement("script"); script.src = "app://obsidian.md/enhance.js"; document.head.append(script);
    const failed = prepare();
    child.document.querySelector("script")!.dispatchEvent(new Event("error"));
    await expect(failed.ready).rejects.toThrow("resource failed");
    const pending = prepare(); pending.dispose();
    await expect(pending.ready).rejects.toThrow("document closed");
    expect(child.document.querySelector("script")).toBeNull();
  });
});
