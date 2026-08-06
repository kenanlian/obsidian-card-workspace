import { describe, expect, it } from "vitest";
import {
  addFavorite,
  FAVORITE_KIND_ORDER,
  isFavorite,
  isFavoriteKind,
  moveFavorite,
  normalizeFavoriteRef,
  pruneFavoriteBoxes,
  pruneFavoriteTags,
  reconcileFavoritesForVaultMutation,
  removeFavorite,
  sortFavoritesByKind,
  toggleFavorite,
} from "./favorites";
import type { FavoriteEntry, FavoriteKind } from "./types";

function makeFavorite(kind: FavoriteKind, ref: string): FavoriteEntry {
  return { kind, ref };
}

describe("isFavoriteKind", () => {
  it("accepts every declared kind", () => {
    for (const kind of FAVORITE_KIND_ORDER) {
      expect(isFavoriteKind(kind)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    expect(isFavoriteKind("note")).toBe(false);
    expect(isFavoriteKind(null)).toBe(false);
    expect(isFavoriteKind(undefined)).toBe(false);
    expect(isFavoriteKind(3)).toBe(false);
  });
});

describe("normalizeFavoriteRef", () => {
  it("treats the vault root markers as the empty folder ref", () => {
    expect(normalizeFavoriteRef("folder", "")).toBe("");
    expect(normalizeFavoriteRef("folder", "   ")).toBe("");
    expect(normalizeFavoriteRef("folder", "/")).toBe("");
  });

  it("strips a trailing slash from folder refs", () => {
    expect(normalizeFavoriteRef("folder", "Projects/")).toBe("Projects");
    expect(normalizeFavoriteRef("folder", " Projects/Sub ")).toBe("Projects/Sub");
  });

  it("normalizes tags through normalizeTagPath", () => {
    expect(normalizeFavoriteRef("tag", "#Work/AI")).toBe("work/ai");
    expect(normalizeFavoriteRef("tag", "  ")).toBeNull();
    expect(normalizeFavoriteRef("tag", "#")).toBeNull();
  });

  it("requires a non-empty file or box ref", () => {
    expect(normalizeFavoriteRef("file", " Notes/A.md ")).toBe("Notes/A.md");
    expect(normalizeFavoriteRef("file", "  ")).toBeNull();
    expect(normalizeFavoriteRef("box", " box-1 ")).toBe("box-1");
    expect(normalizeFavoriteRef("box", "")).toBeNull();
  });
});

describe("addFavorite / removeFavorite / toggleFavorite", () => {
  it("appends a normalized entry", () => {
    const favorites: FavoriteEntry[] = [];
    const next = addFavorite(favorites, "tag", "#Work/AI");
    expect(next).toEqual([makeFavorite("tag", "work/ai")]);
  });

  it("keeps the vault-root folder ref", () => {
    const next = addFavorite([], "folder", "/");
    expect(next).toEqual([makeFavorite("folder", "")]);
  });

  it("returns the same reference for an invalid ref", () => {
    const favorites: FavoriteEntry[] = [];
    expect(addFavorite(favorites, "file", "   ")).toBe(favorites);
  });

  it("returns the same reference when already present", () => {
    const favorites = [makeFavorite("file", "A.md")];
    expect(addFavorite(favorites, "file", "A.md")).toBe(favorites);
  });

  it("returns the same reference when removing an absent entry", () => {
    const favorites = [makeFavorite("file", "A.md")];
    expect(removeFavorite(favorites, "file", "B.md")).toBe(favorites);
    expect(removeFavorite(favorites, "tag", "  ")).toBe(favorites);
  });

  it("removes an existing entry", () => {
    const favorites = [makeFavorite("file", "A.md"), makeFavorite("file", "B.md")];
    expect(removeFavorite(favorites, "file", "A.md")).toEqual([makeFavorite("file", "B.md")]);
  });

  it("toggles both ways", () => {
    const added = toggleFavorite([], "box", "box-1");
    expect(added).toEqual([makeFavorite("box", "box-1")]);
    expect(toggleFavorite(added, "box", "box-1")).toEqual([]);
  });

  it("reports membership through isFavorite", () => {
    const favorites = [makeFavorite("tag", "work/ai"), makeFavorite("folder", "")];
    expect(isFavorite(favorites, "tag", "#Work/AI")).toBe(true);
    expect(isFavorite(favorites, "folder", "/")).toBe(true);
    expect(isFavorite(favorites, "folder", "Projects")).toBe(false);
    expect(isFavorite(favorites, "tag", "#")).toBe(false);
  });
});

describe("sortFavoritesByKind", () => {
  it("groups by kind order and preserves insertion order inside a group", () => {
    const favorites = [
      makeFavorite("box", "box-1"),
      makeFavorite("file", "A.md"),
      makeFavorite("tag", "work"),
      makeFavorite("folder", "Projects"),
      makeFavorite("file", "B.md"),
      makeFavorite("folder", ""),
    ];
    expect(sortFavoritesByKind(favorites)).toEqual([
      makeFavorite("folder", "Projects"),
      makeFavorite("folder", ""),
      makeFavorite("file", "A.md"),
      makeFavorite("file", "B.md"),
      makeFavorite("tag", "work"),
      makeFavorite("box", "box-1"),
    ]);
  });

  it("keeps a new entry grouped with its kind when added", () => {
    const favorites = [makeFavorite("folder", "Projects"), makeFavorite("box", "box-1")];
    expect(addFavorite(favorites, "file", "A.md")).toEqual([
      makeFavorite("folder", "Projects"),
      makeFavorite("file", "A.md"),
      makeFavorite("box", "box-1"),
    ]);
  });
});

describe("moveFavorite", () => {
  const favorites = [
    makeFavorite("folder", "A"),
    makeFavorite("folder", "B"),
    makeFavorite("file", "One.md"),
    makeFavorite("file", "Two.md"),
  ];

  it("swaps two entries inside the same kind group", () => {
    expect(moveFavorite(favorites, "folder", "B", -1)).toEqual([
      makeFavorite("folder", "B"),
      makeFavorite("folder", "A"),
      makeFavorite("file", "One.md"),
      makeFavorite("file", "Two.md"),
    ]);
    expect(moveFavorite(favorites, "file", "One.md", 1)).toEqual([
      makeFavorite("folder", "A"),
      makeFavorite("folder", "B"),
      makeFavorite("file", "Two.md"),
      makeFavorite("file", "One.md"),
    ]);
  });

  it("refuses to cross a group boundary", () => {
    expect(moveFavorite(favorites, "file", "One.md", -1)).toBe(favorites);
    expect(moveFavorite(favorites, "folder", "B", 1)).toBe(favorites);
  });

  it("returns the same reference for a missing or invalid target", () => {
    expect(moveFavorite(favorites, "folder", "Missing", 1)).toBe(favorites);
    expect(moveFavorite(favorites, "tag", "#", 1)).toBe(favorites);
  });
});

describe("pruneFavoriteBoxes", () => {
  it("drops box entries whose id is gone", () => {
    const favorites = [
      makeFavorite("box", "box-1"),
      makeFavorite("box", "box-2"),
      makeFavorite("tag", "work"),
    ];
    expect(pruneFavoriteBoxes(favorites, ["box-2"])).toEqual([
      makeFavorite("box", "box-2"),
      makeFavorite("tag", "work"),
    ]);
  });

  it("returns the same reference when every box still exists", () => {
    const favorites = [makeFavorite("box", "box-1")];
    expect(pruneFavoriteBoxes(favorites, ["box-1", "box-2"])).toBe(favorites);
  });
});

describe("pruneFavoriteTags", () => {
  it("drops tag entries whose tag no longer exists in the vault", () => {
    const favorites = [
      makeFavorite("tag", "work"),
      makeFavorite("tag", "archive"),
      makeFavorite("file", "notes/A.md"),
    ];
    expect(pruneFavoriteTags(favorites, new Set(["work"]))).toEqual([
      makeFavorite("tag", "work"),
      makeFavorite("file", "notes/A.md"),
    ]);
  });

  it("keeps a parent tag that only exists through its children", () => {
    const favorites = [makeFavorite("tag", "work")];
    expect(pruneFavoriteTags(favorites, new Set(["work", "work/ai"]))).toBe(favorites);
  });

  it("compares by normalized tag path", () => {
    const favorites = [makeFavorite("tag", "Work/AI")];
    expect(pruneFavoriteTags(favorites, new Set(["work/ai"]))).toBe(favorites);
  });

  it("never drops non-tag entries", () => {
    const favorites = [
      makeFavorite("folder", "notes"),
      makeFavorite("file", "notes/A.md"),
      makeFavorite("box", "box-1"),
    ];
    expect(pruneFavoriteTags(favorites, new Set())).toBe(favorites);
  });
});

describe("reconcileFavoritesForVaultMutation", () => {
  it("prefix-rewrites folder and file entries on a folder rename", () => {
    const favorites = [
      makeFavorite("folder", "Projects"),
      makeFavorite("folder", "Projects/Sub"),
      makeFavorite("folder", "Other"),
      makeFavorite("file", "Projects/A.md"),
      makeFavorite("file", "Other/B.md"),
      makeFavorite("tag", "work"),
      makeFavorite("box", "box-1"),
    ];
    const next = reconcileFavoritesForVaultMutation(favorites, {
      eventType: "rename",
      path: "Work",
      oldPath: "Projects",
      isFolder: true,
    });
    expect(next).toEqual([
      makeFavorite("folder", "Work"),
      makeFavorite("folder", "Work/Sub"),
      makeFavorite("folder", "Other"),
      makeFavorite("file", "Work/A.md"),
      makeFavorite("file", "Other/B.md"),
      makeFavorite("tag", "work"),
      makeFavorite("box", "box-1"),
    ]);
  });

  it("rewrites only exact file matches on a file rename", () => {
    const favorites = [
      makeFavorite("folder", "Notes"),
      makeFavorite("file", "Notes/A.md"),
      makeFavorite("file", "Notes/AB.md"),
    ];
    const next = reconcileFavoritesForVaultMutation(favorites, {
      eventType: "rename",
      path: "Notes/Renamed.md",
      oldPath: "Notes/A.md",
      isFolder: false,
    });
    expect(next).toEqual([
      makeFavorite("folder", "Notes"),
      makeFavorite("file", "Notes/Renamed.md"),
      makeFavorite("file", "Notes/AB.md"),
    ]);
  });

  it("drops folder and file entries at or under a deleted folder", () => {
    const favorites = [
      makeFavorite("folder", "Projects"),
      makeFavorite("folder", "Projects/Sub"),
      makeFavorite("folder", "Projected"),
      makeFavorite("file", "Projects/A.md"),
      makeFavorite("file", "Other/B.md"),
      makeFavorite("tag", "work"),
      makeFavorite("box", "box-1"),
    ];
    const next = reconcileFavoritesForVaultMutation(favorites, {
      eventType: "delete",
      path: "Projects",
      oldPath: null,
      isFolder: true,
    });
    expect(next).toEqual([
      makeFavorite("folder", "Projected"),
      makeFavorite("file", "Other/B.md"),
      makeFavorite("tag", "work"),
      makeFavorite("box", "box-1"),
    ]);
  });

  it("drops only the exact file on a file delete", () => {
    const favorites = [
      makeFavorite("file", "Notes/A.md"),
      makeFavorite("file", "Notes/B.md"),
      makeFavorite("folder", "Notes/A.md"),
    ];
    const next = reconcileFavoritesForVaultMutation(favorites, {
      eventType: "delete",
      path: "Notes/A.md",
      oldPath: null,
      isFolder: false,
    });
    expect(next).toEqual([makeFavorite("file", "Notes/B.md"), makeFavorite("folder", "Notes/A.md")]);
  });

  it("keeps the vault-root folder ref through an unrelated rename and delete", () => {
    const favorites = [makeFavorite("folder", ""), makeFavorite("folder", "Projects")];
    const renamed = reconcileFavoritesForVaultMutation(favorites, {
      eventType: "rename",
      path: "Work",
      oldPath: "Projects",
      isFolder: true,
    });
    expect(renamed[0]).toEqual(makeFavorite("folder", ""));

    const deleted = reconcileFavoritesForVaultMutation(favorites, {
      eventType: "delete",
      path: "Projects",
      oldPath: null,
      isFolder: true,
    });
    expect(deleted).toEqual([makeFavorite("folder", "")]);
  });

  it("returns the same reference for create and modify events", () => {
    const favorites = [makeFavorite("file", "A.md")];
    expect(
      reconcileFavoritesForVaultMutation(favorites, {
        eventType: "create",
        path: "A.md",
        oldPath: null,
        isFolder: false,
      }),
    ).toBe(favorites);
    expect(
      reconcileFavoritesForVaultMutation(favorites, {
        eventType: "modify",
        path: "A.md",
        oldPath: null,
        isFolder: false,
      }),
    ).toBe(favorites);
  });

  it("returns the same reference when a rename touches nothing", () => {
    const favorites = [makeFavorite("tag", "work"), makeFavorite("box", "box-1")];
    expect(
      reconcileFavoritesForVaultMutation(favorites, {
        eventType: "rename",
        path: "Work",
        oldPath: "Projects",
        isFolder: true,
      }),
    ).toBe(favorites);
  });
});
