import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { editPropertiesInFile } from "./note-property-ops";
import type { BulkPropertiesDraft } from "./bulk-metadata";

function setup(initial: Record<string, unknown> = {}) {
  const file = new TFile(); file.path = "test.md"; file.extension = "md";
  const frontmatter = { ...initial };
  const processFrontMatter = vi.fn(async (_file, mutate) => mutate(frontmatter));
  return { file, frontmatter, processFrontMatter, app: { fileManager: { processFrontMatter } } };
}

describe("bulk note properties", () => {
  it("sets all six types and removes whole keys with a single host transaction", async () => {
    const { app, file, frontmatter, processFrontMatter } = setup({ STATUS: "old", obsolete: { nested: true }, keep: "yes", tags: ["work"] });
    const draft: BulkPropertiesDraft = { setProperties: [
      { name: "status", type: "text", value: "" }, { name: "list", type: "list", value: ["one", 1] },
      { name: "emptyList", type: "list", value: [] }, { name: "score", type: "number", value: 0 },
      { name: "enabled", type: "checkbox", value: false }, { name: "date", type: "date", value: "2024-02-29" },
      { name: "time", type: "datetime", value: "2024-02-29T12:30:00" },
    ], removeKeys: ["OBSOLETE"] };
    expect(await editPropertiesInFile(app as never, file, draft)).toMatchObject({ ok: true, changed: true });
    expect(processFrontMatter).toHaveBeenCalledTimes(1);
    expect(frontmatter).toEqual({ STATUS: "", list: ["one", 1], emptyList: [], score: 0, enabled: false, date: "2024-02-29", time: "2024-02-29T12:30:00", keep: "yes", tags: ["work"] });
    expect(await editPropertiesInFile(app as never, file, draft)).toMatchObject({ ok: true, changed: false });
  });
  it("adds a missing property without frontmatter and keeps text whitespace", async () => {
    const { app, file, frontmatter } = setup();
    await editPropertiesInFile(app as never, file, { setProperties: [{ name: " New Name ", type: "text", value: "  original  " }], removeKeys: [] });
    expect(frontmatter).toEqual({ "New Name": "  original  " });
  });
  it("reports failures and rejects invalid drafts before invoking the host", async () => {
    const { app, file, processFrontMatter } = setup();
    expect(await editPropertiesInFile(app as never, file, { setProperties: [{ name: "tags", type: "text", value: "x" }], removeKeys: [] })).toMatchObject({ ok: false });
    expect(processFrontMatter).not.toHaveBeenCalled();
    processFrontMatter.mockRejectedValueOnce(new Error("denied"));
    expect(await editPropertiesInFile(app as never, file, { setProperties: [], removeKeys: ["a"] })).toMatchObject({ ok: false, error: "Error: denied", path: file.path });
  });
});
