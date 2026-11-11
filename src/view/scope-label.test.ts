import { describe, expect, it } from "vitest";
import { getUiStrings } from "../i18n";
import { buildScopeLabel, buildScopeTitle, type ScopeLabelInput } from "./scope-label";

const strings = getUiStrings("en").toolbar;
const folder = (displayPath: string, activeFilterTags: string[] = []): ScopeLabelInput => ({
  scope: { displayPath, activeBoxId: null, activeBoxName: null, linksDirection: null, linksLabel: null },
  activeFilterTags, strings,
});

describe("buildScopeLabel", () => {
  it("names the vault root and folders, with full paths for the full variant", () => {
    expect(buildScopeLabel(folder("/"), "name")).toBe(strings.folderMenu.rootFolder);
    expect(buildScopeLabel(folder(""), "full")).toBe(strings.folderMenu.rootFolder);
    expect(buildScopeLabel(folder("projects/alpha"), "name")).toBe("alpha");
    expect(buildScopeLabel(folder("projects/alpha"), "full")).toBe("projects/alpha");
  });

  it("keeps active tag filters out of folder labels and tooltips", () => {
    expect(buildScopeLabel(folder("projects/alpha", ["work", "#urgent"]), "name")).toBe("alpha");
    expect(buildScopeLabel(folder("projects/alpha", ["work", "#urgent"]), "full")).toBe("projects/alpha");
  });

  it("builds the phone title from the source and every applicable browse filter", () => {
    const ui = getUiStrings("en");
    const base = { ...folder("projects/alpha", ["work"]), propertyStrings: ui.property,
      propertyFilters: [{ key: "status", values: [{ kind: "text" as const, value: "open" }, { kind: "missing" as const }] }] };
    const enabled = { browseTagFilterEnabled: true, browsePropertyFilterEnabled: true };
    const sep = strings.scope.separator;
    expect(buildScopeTitle({ ...base, scope: { ...base.scope, ...enabled } }))
      .toBe(`alpha${sep}#work${sep}status: open, ${ui.property.valueUnassigned}`);
    expect(buildScopeTitle({ ...base, scope: { ...base.scope, ...enabled, activeBoxId: "b1", activeBoxName: "Reading" } }))
      .toBe(`Reading${sep}#work${sep}status: open, ${ui.property.valueUnassigned}`);
    expect(buildScopeTitle({ ...base, scope: { ...base.scope, browseTagFilterEnabled: false, browsePropertyFilterEnabled: false,
      linksDirection: "backlinks", linksLabel: "“Note” · Backlinks" } })).toBe("“Note” · Backlinks");
  });

  it("uses the box name and links label without tags", () => {
    const box = { ...folder("projects", ["work"]), scope: { ...folder("").scope, activeBoxId: "b1", activeBoxName: "Reading" } };
    expect(buildScopeLabel(box, "name")).toBe("Reading");
    const links = { ...folder("projects", ["work"]), scope: { ...folder("").scope, linksDirection: "backlinks" as const, linksLabel: "“Note” · Backlinks" } };
    expect(buildScopeLabel(links, "full")).toBe("“Note” · Backlinks");
  });
});
