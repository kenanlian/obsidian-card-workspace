import { describe, expect, it } from "vitest";
import {
  isPathAtOrBelow,
  prunePathList,
  rewritePathListAfterRename,
  rewritePathReference,
} from "./path-references";

describe("isPathAtOrBelow", () => {
  it("matches an exact path", () => {
    expect(isPathAtOrBelow("foo", "foo")).toBe(true);
    expect(isPathAtOrBelow("foo/bar.md", "foo/bar.md")).toBe(true);
  });

  it("matches descendants at a / boundary only", () => {
    expect(isPathAtOrBelow("foo/bar.md", "foo")).toBe(true);
    expect(isPathAtOrBelow("foo/deep/nested.md", "foo")).toBe(true);
  });

  it("rejects prefix lookalikes", () => {
    expect(isPathAtOrBelow("foobar", "foo")).toBe(false);
    expect(isPathAtOrBelow("foobar/bar.md", "foo")).toBe(false);
    expect(isPathAtOrBelow("foo-bar.md", "foo")).toBe(false);
  });

  it("treats the vault root and other roots strictly", () => {
    expect(isPathAtOrBelow("", "")).toBe(true);
    expect(isPathAtOrBelow("foo", "")).toBe(false);
    expect(isPathAtOrBelow("foo", "/")).toBe(false);
  });
});

describe("rewritePathReference", () => {
  it("rewrites the exact renamed path and its descendants", () => {
    expect(rewritePathReference("foo", "foo", "bar")).toBe("bar");
    expect(rewritePathReference("foo/bar.md", "foo", "bar")).toBe("bar/bar.md");
    expect(rewritePathReference("foo/deep/nested.md", "foo", "bar")).toBe("bar/deep/nested.md");
  });

  it("leaves prefix lookalikes and unrelated paths untouched", () => {
    expect(rewritePathReference("foobar", "foo", "bar")).toBe("foobar");
    expect(rewritePathReference("foobar/bar.md", "foo", "bar")).toBe("foobar/bar.md");
    expect(rewritePathReference("other/bar.md", "foo", "bar")).toBe("other/bar.md");
  });

  it("never rewrites the vault root", () => {
    expect(rewritePathReference("", "foo", "bar")).toBe("");
  });

  it("is stable when old and new paths coincide", () => {
    expect(rewritePathReference("foo/bar.md", "foo", "foo")).toBe("foo/bar.md");
  });
});

describe("rewritePathListAfterRename", () => {
  it("rewrites only exact matches in exact mode (file rename)", () => {
    expect(rewritePathListAfterRename(["A.md", "AB.md", "B.md"], "A.md", "C.md", "exact")).toEqual([
      "C.md",
      "AB.md",
      "B.md",
    ]);
  });

  it("rewrites exact and descendant matches in at-or-below mode (folder rename)", () => {
    expect(
      rewritePathListAfterRename(["foo", "foo/a.md", "foo/sub/b.md", "foobar/a.md"], "foo", "bar", "at-or-below"),
    ).toEqual(["bar", "bar/a.md", "bar/sub/b.md", "foobar/a.md"]);
  });

  it("keeps the original order across multiple rewrites", () => {
    expect(
      rewritePathListAfterRename(["z.md", "foo/a.md", "m.md", "foo/b.md"], "foo", "bar", "at-or-below"),
    ).toEqual(["z.md", "bar/a.md", "m.md", "bar/b.md"]);
  });

  it("returns the original array reference when nothing changes", () => {
    const paths = ["Other.md", "foo-bar.md"];
    expect(rewritePathListAfterRename(paths, "foo", "bar", "at-or-below")).toBe(paths);
    expect(rewritePathListAfterRename(paths, "A.md", "C.md", "exact")).toBe(paths);
  });

  it("does not opportunistically deduplicate an unchanged list", () => {
    const paths = ["Other.md", "Other.md"];
    expect(rewritePathListAfterRename(paths, "foo", "bar", "at-or-below")).toBe(paths);
  });

  it("keeps the first occurrence when a rename collides two entries", () => {
    expect(
      rewritePathListAfterRename(["foo/a.md", "bar/a.md"], "foo", "bar", "at-or-below"),
    ).toEqual(["bar/a.md"]);
    // The first occurrence stays first even when it was already the target.
    expect(
      rewritePathListAfterRename(["bar/a.md", "foo/a.md"], "foo", "bar", "at-or-below"),
    ).toEqual(["bar/a.md"]);
    expect(rewritePathListAfterRename(["A.md", "B.md"], "A.md", "B.md", "exact")).toEqual(["B.md"]);
  });

  it("returns the original reference for an empty list", () => {
    const paths: string[] = [];
    expect(rewritePathListAfterRename(paths, "foo", "bar", "at-or-below")).toBe(paths);
  });
});

describe("prunePathList", () => {
  it("removes only exact matches in exact mode (file delete)", () => {
    expect(prunePathList(["A.md", "AB.md", "B.md"], "A.md", "exact")).toEqual(["AB.md", "B.md"]);
  });

  it("removes exact and descendant matches in at-or-below mode (folder delete)", () => {
    expect(prunePathList(["foo", "foo/a.md", "foo/sub/b.md", "foobar/a.md", "z.md"], "foo", "at-or-below")).toEqual([
      "foobar/a.md",
      "z.md",
    ]);
  });

  it("returns the original array reference when nothing is removed", () => {
    const paths = ["Other.md", "foo-bar.md"];
    expect(prunePathList(paths, "foo", "at-or-below")).toBe(paths);
    expect(prunePathList(paths, "A.md", "exact")).toBe(paths);
  });

  it("does not opportunistically deduplicate an unchanged list", () => {
    const paths = ["Other.md", "Other.md"];
    expect(prunePathList(paths, "foo", "at-or-below")).toBe(paths);
  });

  it("returns the original reference for an empty list", () => {
    const paths: string[] = [];
    expect(prunePathList(paths, "foo", "at-or-below")).toBe(paths);
  });
});
