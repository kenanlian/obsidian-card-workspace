import { describe, expect, it } from "vitest";

import type { PluginSettings } from "../settings";
import { createBoxScope, createFolderScope } from "./scope";
import type { CardBoxDefinition } from "./types";
import { resolveViewConfig } from "./view-config";

function makeBox(overrides: Partial<CardBoxDefinition> = {}): CardBoxDefinition {
  return {
    id: "box-1",
    name: "Ideas",
    rules: [],
    manualPaths: [],
    excludedPaths: [],
    pinnedPaths: ["box.md"],
    sort: { field: "name", direction: "asc" },
    ...overrides,
  };
}

function makeSettings(overrides: Partial<PluginSettings> = {}): PluginSettings {
  return {
    sort: { field: "mtime", direction: "desc" },
    pinnedPaths: ["global.md"],
    boxes: [],
    ...overrides,
  } as PluginSettings;
}

describe("resolveViewConfig", () => {
  it("returns global sort and pins for folder scope", () => {
    const settings = makeSettings({ boxes: [makeBox()] });
    const result = resolveViewConfig(createFolderScope("notes", true), settings);

    expect(result.sort).toBe(settings.sort);
    expect(result.pinnedPaths).toBe(settings.pinnedPaths);
  });

  it("returns the resolvable box's sort and pins by reference", () => {
    const box = makeBox();
    const settings = makeSettings({ boxes: [box] });
    const result = resolveViewConfig(createBoxScope("box-1"), settings);

    expect(result.sort).toBe(box.sort);
    expect(result.pinnedPaths).toBe(box.pinnedPaths);
  });

  it("falls back to global sort and pins when the box id is unresolvable", () => {
    const settings = makeSettings({ boxes: [makeBox()] });
    const result = resolveViewConfig(createBoxScope("ghost"), settings);

    expect(result.sort).toBe(settings.sort);
    expect(result.pinnedPaths).toBe(settings.pinnedPaths);
  });

  it("treats undefined boxes as empty and falls back to global settings", () => {
    const settings = makeSettings();
    (settings as { boxes?: PluginSettings["boxes"] }).boxes = undefined;
    const result = resolveViewConfig(createBoxScope("box-1"), settings);

    expect(result.sort).toBe(settings.sort);
    expect(result.pinnedPaths).toBe(settings.pinnedPaths);
  });

  it("takes the box sort as a unit when both field and direction differ from global", () => {
    const box = makeBox({ sort: { field: "name", direction: "asc" } });
    const settings = makeSettings({
      sort: { field: "mtime", direction: "desc" },
      boxes: [box],
    });
    const result = resolveViewConfig(createBoxScope("box-1"), settings);

    expect(result.sort).toEqual({ field: "name", direction: "asc" });
    expect(result.sort).toBe(box.sort);
    expect(result.pinnedPaths).toBe(box.pinnedPaths);
  });
});
