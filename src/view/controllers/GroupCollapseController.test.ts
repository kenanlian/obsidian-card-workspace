import { describe, expect, it } from "vitest";

import { createBoxScope, createFolderScope } from "../scope";
import { GroupCollapseController } from "./GroupCollapseController";

const NOTES = createFolderScope("notes", true);
const ARCHIVE = createFolderScope("archive", true);
const BOX = createBoxScope("box-1");

describe("GroupCollapseController", () => {
  it("isolates time collapse by field and granularity", () => {
    const controller = new GroupCollapseController();
    const spec = { dimension: "mtime" as const, timeGranularity: "day" as const, orderBy: "default" as const, orderDirection: "asc" as const };
    controller.toggle(NOTES, spec, "today");
    expect(controller.getCollapsedKeys(NOTES, { ...spec, timeGranularity: "month" }).size).toBe(0);
    expect(controller.getCollapsedKeys(NOTES, { ...spec, dimension: "ctime" }).size).toBe(0);
    expect(controller.getCollapsedKeys(NOTES, spec).has("today")).toBe(true);
  });
  it("keeps collapsed property groups separate for each property key", () => {
    const controller = new GroupCollapseController();
    const scope = createFolderScope("notes", true);
    const status = { dimension: "property" as const, propertyKey: "status", orderBy: "default" as const, orderDirection: "asc" as const };
    const priority = { ...status, propertyKey: "priority" };
    controller.toggle(scope, status, "value");
    expect(controller.getCollapsedKeys(scope, status).has("value")).toBe(true);
    expect(controller.getCollapsedKeys(scope, priority).has("value")).toBe(false);
  });
  it("toggles a key on and back off", () => {
    const controller = new GroupCollapseController();

    controller.toggle(NOTES, "folder", "folder:notes");
    expect([...controller.getCollapsedKeys(NOTES, "folder")]).toEqual(["folder:notes"]);

    controller.toggle(NOTES, "folder", "folder:notes");
    expect(controller.getCollapsedKeys(NOTES, "folder").size).toBe(0);
  });

  it("keeps independent sets per scope and per dimension", () => {
    const controller = new GroupCollapseController();

    controller.toggle(NOTES, "folder", "folder:notes");
    controller.toggle(ARCHIVE, "folder", "folder:archive");
    controller.toggle(BOX, "box-rule", "rule:r1");

    expect([...controller.getCollapsedKeys(NOTES, "folder")]).toEqual(["folder:notes"]);
    expect([...controller.getCollapsedKeys(ARCHIVE, "folder")]).toEqual(["folder:archive"]);
    expect([...controller.getCollapsedKeys(BOX, "box-rule")]).toEqual(["rule:r1"]);
  });

  it("reads an unseen dimension as fully expanded and restores the previous one", () => {
    const controller = new GroupCollapseController();
    controller.toggle(NOTES, "folder", "folder:notes");

    expect(controller.getCollapsedKeys(NOTES, "tag").size).toBe(0);
    expect(controller.getCollapsedKeys(NOTES, "task").size).toBe(0);
    expect([...controller.getCollapsedKeys(NOTES, "folder")]).toEqual(["folder:notes"]);
  });

  it("restores a previously collapsed pair after switching scope away and back", () => {
    const controller = new GroupCollapseController();
    controller.toggle(NOTES, "folder", "folder:notes");

    expect(controller.getCollapsedKeys(ARCHIVE, "folder").size).toBe(0);
    expect([...controller.getCollapsedKeys(NOTES, "folder")]).toEqual(["folder:notes"]);
  });

  it("round-trips collapseAll and expandAll", () => {
    const controller = new GroupCollapseController();
    const keys = ["folder:a", "folder:b", "folder:c"];

    controller.collapseAll(NOTES, "folder", keys);
    expect(controller.getCollapsedKeys(NOTES, "folder")).toEqual(new Set(keys));

    controller.expandAll(NOTES, "folder");
    expect(controller.getCollapsedKeys(NOTES, "folder").size).toBe(0);
  });

  it("does not consult a collapsed set belonging to an inactive dimension", () => {
    const controller = new GroupCollapseController();
    controller.collapseAll(NOTES, "tag", ["tag:work"]);

    expect(controller.getCollapsedKeys(NOTES, "folder").size).toBe(0);
    expect([...controller.getCollapsedKeys(NOTES, "tag")]).toEqual(["tag:work"]);
  });

  it("clears every set on dispose and stays idempotent", () => {
    const controller = new GroupCollapseController();
    controller.collapseAll(NOTES, "folder", ["folder:notes"]);
    controller.collapseAll(BOX, "box-rule", ["rule:r1"]);

    expect(controller.dispose()).toEqual({});
    expect(controller.dispose()).toEqual({});
    expect(controller.getCollapsedKeys(NOTES, "folder").size).toBe(0);
    expect(controller.getCollapsedKeys(BOX, "box-rule").size).toBe(0);

    controller.toggle(NOTES, "folder", "folder:notes");
    expect([...controller.getCollapsedKeys(NOTES, "folder")]).toEqual(["folder:notes"]);
  });
});
