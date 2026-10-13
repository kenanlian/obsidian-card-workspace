import { describe, expect, it, vi } from "vitest";
import { getUiStrings } from "../../i18n";
import { DEFAULT_SETTINGS } from "../../settings";
import { normalizeNavigationSorting } from "../../navigation-sorting";
import { serializePropertyScalarRef } from "../../property-filter-settings";
import { createFolderScope, createBoxScope, createLinksScope, type CardScope } from "../scope";
import type { ViewContext } from "../view-context";
import { ScopeNoteActions, type ScopeNoteActionsDeps } from "./scope-note-actions";

function harness(scope: CardScope = createFolderScope("notes", true)) {
  const settings = {
    ...DEFAULT_SETTINGS,
    lastFolderPath: "recent",
    filter: { tags: ["project", "project/nested"], properties: [
      { key: "text", values: [{ kind: "text" as const, value: "z" }, { kind: "text" as const, value: "a" }] },
      { key: "number", values: [{ kind: "number" as const, value: 3 }, { kind: "number" as const, value: 1 }] },
      { key: "flag", values: [{ kind: "boolean" as const, value: false }] },
      { key: "absent", values: [{ kind: "missing" as const }] },
    ] },
    navigationSorting: normalizeNavigationSorting(undefined),
  };
  const context = {
    getSettings: () => settings, getApp: () => ({ metadataCache: { getFileCache: () => null } }),
    getUiStrings: () => getUiStrings("en"),
    store: { getScope: () => scope, getBaseCards: () => [] },
  } as unknown as ViewContext;
  const createNote = vi.fn<ScopeNoteActionsDeps["createNote"]>(async () => undefined);
  return { settings, createNote, actions: new ScopeNoteActions({ context, createNote }) };
}

describe("ScopeNoteActions", () => {
  it("captures all tags and supported scalars, ignoring missing-only and descendant creation", async () => {
    const h = harness();
    await h.actions.createNote();
    expect(h.createNote).toHaveBeenCalledWith("notes", ["project", "project/nested"], { text: "a", number: 1, flag: false });
  });
  it("uses complete manual value ordering independent of navigation query and collapse", async () => {
    const h = harness();
    h.settings.navigationSorting.propertyValues.text = { mode: "manual", order: [serializePropertyScalarRef({ kind: "text", value: "z" })] };
    h.settings.navigationSorting.propertyValues.number = { mode: "desc", order: [] };
    await h.actions.createNote();
    expect(h.createNote).toHaveBeenCalledWith("notes", expect.anything(), { text: "z", number: 3, flag: false });
  });
  it("creates in vault root rather than the recently visited folder", async () => {
    const h = harness(createFolderScope("", true));
    await h.actions.createNote();
    expect(h.createNote.mock.calls[0][0]).toBe("");
  });
  it.each([createBoxScope("b"), createLinksScope("note.md", "backlinks")])("keeps paused browse filters out of %s", async (scope) => {
    const h = harness(scope);
    await h.actions.createNote();
    expect(h.createNote).toHaveBeenCalledWith("recent", [], {});
  });
  it("passes snapshots unaffected by later settings changes", async () => {
    const h = harness();
    const pending = h.actions.createNote();
    h.settings.filter.tags.push("later");
    h.settings.filter.properties[0].values[0] = { kind: "text", value: "changed" };
    await pending;
    expect(h.createNote).toHaveBeenCalledWith("notes", ["project", "project/nested"], { text: "a", number: 1, flag: false });
  });
});
