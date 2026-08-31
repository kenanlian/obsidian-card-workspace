import { describe, expect, it } from "vitest";

import { createBoxScope, createFolderScope } from "../scope";
import { GroupCollapseController } from "./GroupCollapseController";

const NOTES = createFolderScope("notes", true);
const ARCHIVE = createFolderScope("archive", true);
const BOX = createBoxScope("box-1");

describe("GroupCollapseController", () => {
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
