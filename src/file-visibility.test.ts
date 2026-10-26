import type { App } from "obsidian";
import { describe, expect, it } from "vitest";
import { canOpenFileInObsidian, createFileVisibilityPolicy, isFileVisibility } from "./file-visibility";
import { normalizeSettings } from "./settings";
import { serializeSettings } from "./services/SettingsStore";
import { resolveCardFileKindFromPath } from "./view/file-kind";

const paths = ["a.md", "a.base", "a.canvas", "a.excalidraw", "a.excalidraw.md", "PHOTO.PNG", "a.pdf", "a.mp3", "a.webm", "a.custom", "a.zip", "LICENSE"];
function app(registered: Record<string, string> = {}): App {
  return { viewRegistry: { typeByExtension: registered } } as unknown as App;
}

describe("global file visibility", () => {
  it("retains the four document kinds and follows registered formats in the common tier", () => {
    const host = app({ custom: "custom-view" });
    const visible = (visibility: "documents" | "supported" | "all") => {
      const policy = createFileVisibilityPolicy(host, visibility);
      return paths.filter((path) => policy.accepts({ path }));
    };
    expect(visible("documents")).toEqual(paths.slice(0, 5));
    expect(visible("supported")).toEqual(paths.slice(0, 10));
    expect(visible("all")).toEqual(paths);
  });
  it("uses optional registry capabilities, snapshots them, and updates their cache identity on refresh", () => {
    const registry: Record<string, string> = {};
    const host = app(registry);
    const before = createFileVisibilityPolicy(host);
    registry.CUSTOM = "custom";
    const after = createFileVisibilityPolicy(host);
    expect(before.accepts({ path: "a.custom" })).toBe(false);
    expect(after.accepts({ path: "a.CUSTOM" })).toBe(true);
    expect(before.key).not.toBe(after.key);
    delete registry.CUSTOM;
    expect(createFileVisibilityPolicy(host).accepts({ path: "a.custom" })).toBe(false);
    const unavailable = Object.defineProperty({}, "viewRegistry", { get: () => { throw new Error("unavailable"); } }) as App;
    expect(createFileVisibilityPolicy(unavailable).accepts({ path: "a.pdf" })).toBe(true);
    expect(createFileVisibilityPolicy(unavailable).accepts({ path: "a.custom" })).toBe(false);
  });
  it("separates classification, visibility, and host opening capabilities", () => {
    expect(resolveCardFileKindFromPath("a.custom")).toBe("file");
    expect(resolveCardFileKindFromPath("LICENSE")).toBe("file");
    expect(resolveCardFileKindFromPath("a.EXCALIDRAW.MD")).toBe("excalidraw");
    expect(createFileVisibilityPolicy(app(), "documents").accepts({ path: "a.excalidraw" })).toBe(true);
    expect(canOpenFileInObsidian(app(), { path: "a.excalidraw" })).toBe(false);
    expect(canOpenFileInObsidian(app({ excalidraw: "drawing" }), { path: "a.excalidraw" })).toBe(true);
    expect(canOpenFileInObsidian(app(), { path: "a.zip" })).toBe(false);
  });
  it("defaults missing or invalid settings to common formats and persists the preference", () => {
    for (const value of [undefined, null, "invalid", 1, {}]) {
      expect(isFileVisibility(value)).toBe(false);
      expect(normalizeSettings({ fileVisibility: value }).fileVisibility).toBe("supported");
    }
    for (const visibility of ["documents", "supported", "all"] as const) {
      const settings = normalizeSettings({ fileVisibility: visibility });
      const serialized = serializeSettings(settings);
      expect(serialized.schemaVersion).toBe(2);
      expect(serialized.preferences.fileVisibility).toBe(visibility);
    }
  });
});
