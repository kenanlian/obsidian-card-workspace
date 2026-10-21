import { describe, expect, it } from "vitest";
import { readDraftFrontmatter, updateDraftFrontmatter } from "./draft-frontmatter";

describe("draft frontmatter editing", () => {
  it("preserves an untouched template byte for byte", () => {
    const text = "---\r\n# Keep me\r\nstatus: 'draft'  # explanation\r\n---\r\nBody\r\n";
    expect(updateDraftFrontmatter(text, { status: "draft" })).toBe(text);
  });

  it("keeps comments, quoted strings, list item comments and body when changing a typed value", () => {
    const text = "---\n# heading\nstatus: 'draft' # status comment\ncount: 3 # number comment\ntags: # tags comment\n  - alpha # keep alpha\n---\nBody with --- and {{date}}\n";
    const updated = updateDraftFrontmatter(text, { status: "draft", count: 7, tags: ["alpha", "beta"] });
    expect(updated).toContain("# heading");
    expect(updated).toContain("status: 'draft' # status comment");
    expect(updated).toContain("count: 7 # number comment");
    expect(updated).toContain("# tags comment");
    expect(updated).toContain("alpha # keep alpha");
    expect(updated.endsWith("Body with --- and {{date}}\n")).toBe(true);
    expect(readDraftFrontmatter(updated)?.properties).toEqual({ status: "draft", count: 7, tags: ["alpha", "beta"] });
  });

  it("retains renamed-field comments and key order without losing string/boolean/null types", () => {
    const updated = updateDraftFrontmatter("---\n# field comment\nstatus: draft # value comment\nother: keep\n---\nBody", {
      state: "draft", enabled: true, other: "keep", empty: null, text: "true",
    });
    expect(updated).toContain("# field comment");
    expect(updated).toContain("state: draft # value comment");
    expect(Object.keys(readDraftFrontmatter(updated)!.properties)).toEqual(["state", "enabled", "other", "empty", "text"]);
    expect(readDraftFrontmatter(updated)?.properties).toEqual({ state: "draft", enabled: true, other: "keep", empty: null, text: "true" });
  });

  it("preserves block scalars and Windows newlines", () => {
    const text = "---\r\ndescription: |\r\n  first\r\n  second\r\ncount: 3\r\n---\r\nBody\r\n";
    const updated = updateDraftFrontmatter(text, { description: "first\nsecond\n", count: 4 });
    expect(updated).toContain("description: |\r\n  first\r\n  second\r\n");
    expect(updated.replace(/\r\n/g, "")).not.toContain("\n");
    expect(updated.endsWith("---\r\nBody\r\n")).toBe(true);
  });

  it("supports empty frontmatter and deleting every property", () => {
    expect(readDraftFrontmatter("---\n---\n")?.properties).toEqual({});
    const updated = updateDraftFrontmatter("---\na: b\n---\nBody", {});
    expect(readDraftFrontmatter(updated)?.properties).toEqual({});
    expect(updated.endsWith("Body")).toBe(true);
  });

  it.each([
    "Body\n---\na: b\n---\n",
    "---\na: b\n",
    "---\na: [\n---\nBody",
    "---\na: 1\na: 2\n---\nBody",
    "---\na:\n  nested: value\n---\nBody",
    "---\na: [1, 2]\n---\nBody",
    "---\na: &anchor value\nb: *anchor\n---\nBody",
    "---\n- a\n- b\n---\nBody",
    "---\n42: value\n---\nBody",
    "---\nconstructor: value\n---\nBody",
    "---\n__proto__: value\n---\nBody",
    "---\n? [complex, key]\n: value\n---\nBody",
  ])("leaves unsupported YAML in source mode: %s", (text) => {
    expect(readDraftFrontmatter(text)).toBeNull();
    expect(() => updateDraftFrontmatter(text, { a: "changed" })).toThrow();
  });
});
