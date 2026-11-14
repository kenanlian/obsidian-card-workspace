import { describe, expect, it } from "vitest";

import { DEFAULT_GROUP_SPEC } from "../card-grouping-settings";
import { DEFAULT_SETTINGS, type PluginSettings } from "../settings";
import { DEFAULT_TASK_GROUP, DEFAULT_TASK_SORT } from "../task-view-settings";
import { createBoxScope, createFolderScope, createLinksScope } from "./scope";
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
    group: { ...DEFAULT_GROUP_SPEC },
    ...overrides,
  };
}

function makeSettings(overrides: Partial<PluginSettings> = {}): PluginSettings {
  return {
    ...DEFAULT_SETTINGS,
    sort: { field: "mtime", direction: "desc" },
    pinnedPaths: ["global.md"],
    group: { ...DEFAULT_GROUP_SPEC },
    boxes: [],
    ...overrides,
  };
}

describe("resolveViewConfig", () => {
  it("uses the direction's links sort by reference while keeping global pins and grouping", () => {
    const settings = { ...DEFAULT_SETTINGS, linksSort: {
      backlinks: { field: "reference-count" as const, direction: "desc" as const },
      outgoing: { field: "name" as const, direction: "asc" as const },
    } };
    for (const direction of ["backlinks", "outgoing"] as const) {
      const result = resolveViewConfig(createLinksScope("note.md", direction), settings);
      expect(result.sort).toBe(settings.linksSort[direction]);
      expect(result.pinnedPaths).toBe(settings.pinnedPaths);
      expect(result.group).toBe(settings.group);
    }
  });
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

  it("returns the global group for folder scope", () => {
    const settings = makeSettings({
      group: { dimension: "folder", orderBy: "name", orderDirection: "desc" },
      boxes: [makeBox()],
    });
    const result = resolveViewConfig(createFolderScope("notes", true), settings);

    expect(result.group).toBe(settings.group);
  });

  it("returns the box's own group for box scope", () => {
    const box = makeBox({ group: { dimension: "task", orderBy: "count", orderDirection: "desc" } });
    const settings = makeSettings({
      group: { dimension: "folder", orderBy: "name", orderDirection: "asc" },
      boxes: [box],
    });
    const result = resolveViewConfig(createBoxScope("box-1"), settings);

    expect(result.group).toBe(box.group);
  });

  it("falls back to the global group when the box id is unresolvable", () => {
    const settings = makeSettings({
      group: { dimension: "folder", orderBy: "name", orderDirection: "desc" },
      boxes: [makeBox()],
    });
    const result = resolveViewConfig(createBoxScope("ghost"), settings);

    expect(result.group).toBe(settings.group);
  });

  it("returns the box's own default group rather than the global object", () => {
    const box = makeBox();
    const settings = makeSettings({ boxes: [box] });
    const result = resolveViewConfig(createBoxScope("box-1"), settings);

    expect(result.group).toEqual(settings.group);
    expect(result.group).toBe(box.group);
    expect(result.group).not.toBe(settings.group);
  });

  it("reads the global task view config for folder scope", () => {
    const settings = makeSettings({
      defaultView: "tasks",
      taskSort: { field: "created", direction: "desc" },
      taskGroup: { dimension: "due" },
    });
    const result = resolveViewConfig(createFolderScope("notes", true), settings);

    expect(result.viewMode).toBe("tasks");
    expect(result.taskSort).toBe(settings.taskSort);
    expect(result.taskGroup).toBe(settings.taskGroup);
  });

  it("reads a box's own task view config when the box defines it", () => {
    const box = makeBox({
      viewMode: "tasks",
      taskSort: { field: "file", direction: "asc" },
      taskGroup: { dimension: "created", timeGranularity: "week" },
    });
    const settings = makeSettings({
      defaultView: "cards",
      taskSort: { field: "due", direction: "asc" },
      taskGroup: { dimension: "status" },
      boxes: [box],
    });
    const result = resolveViewConfig(createBoxScope("box-1"), settings);

    expect(result.viewMode).toBe("tasks");
    expect(result.taskSort).toBe(box.taskSort);
    expect(result.taskGroup).toBe(box.taskGroup);
  });

  it("falls back to cards and the task-view defaults when the box omits them", () => {
    const box = makeBox();
    const settings = makeSettings({
      defaultView: "tasks",
      taskSort: { field: "text", direction: "desc" },
      taskGroup: { dimension: "status" },
      boxes: [box],
    });
    const result = resolveViewConfig(createBoxScope("box-1"), settings);

    expect(result.viewMode).toBe("cards");
    expect(result.taskSort).toBe(DEFAULT_TASK_SORT);
    expect(result.taskGroup).toBe(DEFAULT_TASK_GROUP);
    expect(box).not.toHaveProperty("viewMode");
    expect(box).not.toHaveProperty("taskSort");
    expect(box).not.toHaveProperty("taskGroup");
  });

  it("falls back to the global task view config when the box id is unresolvable", () => {
    const settings = makeSettings({
      defaultView: "tasks",
      taskSort: { field: "done", direction: "asc" },
      taskGroup: { dimension: "done", timeGranularity: "month" },
      boxes: [makeBox()],
    });
    const result = resolveViewConfig(createBoxScope("ghost"), settings);

    expect(result.viewMode).toBe("tasks");
    expect(result.taskSort).toBe(settings.taskSort);
    expect(result.taskGroup).toBe(settings.taskGroup);
  });

  it("forces cards on links even when the global default view is tasks", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      defaultView: "tasks" as const,
      taskSort: { field: "text" as const, direction: "desc" as const },
      taskGroup: { dimension: "file" as const },
    };
    for (const direction of ["backlinks", "outgoing"] as const) {
      const result = resolveViewConfig(createLinksScope("note.md", direction), settings);
      expect(result.viewMode).toBe("cards");
      expect(result.taskSort).toBe(settings.taskSort);
      expect(result.taskGroup).toBe(settings.taskGroup);
      expect(result.sort).toBe(settings.linksSort[direction]);
    }
  });
});
