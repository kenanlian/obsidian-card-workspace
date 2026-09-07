import { describe, expect, it } from "vitest";

import { createBoxScope, createFolderScope } from "./scope";
import {
  BOX_GROUP_DIMENSIONS,
  FOLDER_GROUP_DIMENSIONS,
  resolveSourceCapabilities,
} from "./source-capabilities";

describe("resolveSourceCapabilities", () => {
  it("returns the exact six-field capability table for folder scope", () => {
    expect(resolveSourceCapabilities(createFolderScope("notes/ideas", true))).toEqual({
      arrangementOwner: { kind: "global" },
      browseTagFilter: true,
      browsePropertyFilter: true,
      supportsIncludeSubfolders: true,
      supportsBoxRuleSeeding: true,
      groupDimensions: ["none", "folder", "tag", "task"],
    });
  });

  it("returns the exact six-field capability table for vault-root folder scope", () => {
    expect(resolveSourceCapabilities(createFolderScope("/", false))).toEqual({
      arrangementOwner: { kind: "global" },
      browseTagFilter: true,
      browsePropertyFilter: true,
      supportsIncludeSubfolders: true,
      supportsBoxRuleSeeding: true,
      groupDimensions: ["none", "folder", "tag", "task"],
    });
  });

  it("returns the exact six-field capability table for box scope", () => {
    expect(resolveSourceCapabilities(createBoxScope("box-42"))).toEqual({
      arrangementOwner: { kind: "box", boxId: "box-42" },
      browseTagFilter: false,
      browsePropertyFilter: false,
      supportsIncludeSubfolders: false,
      supportsBoxRuleSeeding: false,
      groupDimensions: ["none", "folder", "tag", "task", "box-rule"],
    });
  });

  it("keys the box arrangement owner to the scope's box id, not persisted state", () => {
    const folderOwner = resolveSourceCapabilities(createFolderScope("notes", true)).arrangementOwner;
    const boxOwner = resolveSourceCapabilities(createBoxScope("box-7")).arrangementOwner;

    expect(folderOwner).toEqual({ kind: "global" });
    expect(boxOwner).toEqual({ kind: "box", boxId: "box-7" });
    expect(resolveSourceCapabilities(createBoxScope("box-8")).arrangementOwner).toEqual({
      kind: "box",
      boxId: "box-8",
    });
  });

  it("keeps the group-dimension constants stable and module-level", () => {
    expect(FOLDER_GROUP_DIMENSIONS).toEqual(["none", "folder", "tag", "task"]);
    expect(BOX_GROUP_DIMENSIONS).toEqual(["none", "folder", "tag", "task", "box-rule"]);

    // `box-rule` is the only Box-only dimension; both share the rest.
    expect(BOX_GROUP_DIMENSIONS.filter((dimension) => !FOLDER_GROUP_DIMENSIONS.includes(dimension)))
      .toEqual(["box-rule"]);
  });

  it("serves the same stable group-dimension array identity per scope kind", () => {
    const first = resolveSourceCapabilities(createFolderScope("a", true)).groupDimensions;
    const second = resolveSourceCapabilities(createFolderScope("b", false)).groupDimensions;
    expect(second).toBe(first);

    const boxFirst = resolveSourceCapabilities(createBoxScope("x")).groupDimensions;
    const boxSecond = resolveSourceCapabilities(createBoxScope("y")).groupDimensions;
    expect(boxSecond).toBe(boxFirst);
  });

  it("is pure: resolving twice yields fresh owner objects with equal values", () => {
    const scope = createBoxScope("box-1");
    const first = resolveSourceCapabilities(scope);
    const second = resolveSourceCapabilities(scope);

    expect(second).toEqual(first);
    expect(second.arrangementOwner).not.toBe(first.arrangementOwner);
    expect(second.groupDimensions).toBe(first.groupDimensions);
  });
});
