import { describe, expect, it } from "vitest";
import { normalizeNoteTemplates, normalizeQuickInput, normalizeTemplateFolderPath, resolveTemplateName, isInitialTemplateTitle } from "./note-input";
import { DEFAULT_SETTINGS, migrateSettings, mergeSettings } from "./settings";
import { serializeSettings } from "./services/SettingsStore";
import { getUiStrings } from "./i18n";

const template = { id: "daily", filePath: "Templates/{{date}}.md", targetFolderPath: "Daily", dateFormat: "YYYY-MM-DD", timeFormat: "HH:mm:ss" };

describe("note input settings", () => {
  it.each(["start", "end"] as const)("round-trips per-template existing-note insertion at %s without changing the schema", (position) => {
    const definition = { ...template, existingNoteInsertPosition: position };
    const settings = mergeSettings(DEFAULT_SETTINGS, { noteTemplates: [definition] });
    const document = serializeSettings(settings);
    expect(document.schemaVersion).toBe(2);
    expect(document.userData.noteTemplates).toEqual([definition]);
    expect(migrateSettings(document).noteTemplates).toEqual([definition]);
  });
  it.each([undefined, null, "middle", 42])("keeps legacy end insertion for an absent or invalid template position: %j", (position) => {
    expect(normalizeNoteTemplates([{ ...template, existingNoteInsertPosition: position }])).toEqual([template]);
  });

  it("normalizes hostile template definitions while retaining missing references and authored order", () => {
    expect(normalizeNoteTemplates([
      null, {}, { ...template, id: "" }, { ...template, filePath: "../bad.md" }, { ...template, id: "renamed", filePath: "a.txt" },
      { ...template, id: " daily ", filePath: "/Templates//{{date}}.md", targetFolderPath: "/", dateFormat: "invalid", timeFormat: null },
      template, { ...template, id: "other" }, { ...template, id: "second", filePath: "Missing.md", targetFolderPath: "Missing", dateFormat: "YYYY年MM月", timeFormat: "HH时" },
    ])).toEqual([
      { ...template, id: "renamed", filePath: "a.txt" },
      { ...template, targetFolderPath: "" },
      { ...template, id: "second", filePath: "Missing.md", targetFolderPath: "Missing", dateFormat: "YYYY年MM月", timeFormat: "HH时" },
    ]);
    expect(normalizeNoteTemplates({})).toEqual([]);
    expect(normalizeNoteTemplates([{ ...template, targetFolderPath: "../bad" }])[0]?.targetFolderPath).toBeNull();
  });

  it.each(["canvas", "txt"])("retains an unavailable template renamed to .%s across settings persistence", (extension) => {
    const renamed = { ...template, filePath: `Templates/{{date}}.${extension}` };
    const settings = mergeSettings(DEFAULT_SETTINGS, { noteTemplates: [renamed] });
    expect(settings.noteTemplates).toEqual([renamed]);
    expect(migrateSettings(serializeSettings(settings)).noteTemplates).toEqual([renamed]);
  });

  it("defaults old shortcuts to unset and round-trips preferences without a schema bump", () => {
    expect(migrateSettings({}).quickInputGlobalShortcut).toBe("");
    expect(migrateSettings({ schemaVersion: 2, preferences: { quickInputGlobalShortcut: 42 } }).quickInputGlobalShortcut).toBe("");
    const settings = mergeSettings(DEFAULT_SETTINGS, { quickInputGlobalShortcut: " Control+Shift+Q " });
    const document = serializeSettings(settings);
    expect(document.schemaVersion).toBe(2);
    expect(document.preferences.quickInputGlobalShortcut).toBe("Control+Shift+Q");
    expect(document.workspace).not.toHaveProperty("quickInputGlobalShortcut");
    expect(document.userData).not.toHaveProperty("quickInputGlobalShortcut");
    expect(migrateSettings(document)).toEqual(settings);
  });

  it("normalizes quick input and drops the retired template selection", () => {
    expect(normalizeQuickInput({ templateId: " missing ", folderPath: "/Inbox//Notes/", insertPosition: "start", duplicateTitle: "append" }))
      .toEqual({ folderPath: "Inbox/Notes", insertPosition: "start", duplicateTitle: "append" });
    for (const raw of [undefined, null, [], 42, { templateId: false, folderPath: false, insertPosition: "middle", duplicateTitle: "replace" }]) {
      expect(normalizeQuickInput(raw)).toEqual({ folderPath: "", insertPosition: "end", duplicateTitle: "ask" });
    }
  });

  it.each(["../Outside", "Inbox/../Outside", "./Inbox", "Inbox/" + String.fromCharCode(0) + "Bad"])("retains invalid quick input path %s instead of selecting root", (folderPath) => {
    expect(normalizeQuickInput({ folderPath }).folderPath).toBe(folderPath);
    expect(normalizeQuickInput({ folderPath }).folderPath).not.toBe("");
  });

  it("retains a persisted invalid quick input destination across migration and serialization", () => {
    const settings = migrateSettings({ schemaVersion: 2, preferences: { quickInput: { folderPath: "../Outside", insertPosition: "end", duplicateTitle: "ask" } } });
    expect(settings.quickInput.folderPath).toBe("../Outside");
    const serialized = serializeSettings(settings);
    expect(serialized.preferences.quickInput.folderPath).toBe("../Outside");
    expect(migrateSettings(serialized).quickInput.folderPath).toBe("../Outside");
  });

  it("adds defaults to old layers and round trips template and quick input data at schema 2", () => {
    const old = migrateSettings({ schemaVersion: 2 });
    expect(old.noteTemplates).toEqual([]);
    expect(old.quickInput).toEqual({ folderPath: "", insertPosition: "end", duplicateTitle: "ask" });
    expect(old.sectionCollapsed.templates).toBe(false);
    expect(old.navSectionOrder.slice(-3)).toEqual(["boxes", "links", "templates"]);
    const settings = mergeSettings(DEFAULT_SETTINGS, {
      noteTemplates: [template], quickInput: { folderPath: "Inbox", insertPosition: "start", duplicateTitle: "append" }, sectionCollapsed: { templates: true },
    });
    const document = serializeSettings(settings);
    expect(document.schemaVersion).toBe(2);
    expect(document.userData.noteTemplates).toEqual([template]);
    expect(document.preferences.quickInput).toEqual(settings.quickInput);
    expect(document.workspace.sectionCollapsed.templates).toBe(true);
    expect(migrateSettings(document)).toEqual(settings);
    expect(document.preferences.quickInput).not.toBe(settings.quickInput);
    expect(document.userData.noteTemplates[0]).not.toBe(settings.noteTemplates[0]);
  });

  it("provides bilingual note input messages with the same field shapes", () => {
    const english = getUiStrings("en").noteInput;
    const chinese = getUiStrings("zh").noteInput;
    expect(Object.keys(english).sort()).toEqual(Object.keys(chinese).sort());
    for (const strings of [english, chinese]) {
      expect(strings.sent("Inbox.md")).toContain("Inbox.md");
      expect(strings.sendFailed("reason")).toContain("reason");
      expect(strings.createFailed("reason")).toContain("reason");
    }
  });
});


describe("template names and storage", () => {
  it("keeps authored navigation names separate from filenames across v2 persistence", () => {
    const named = { ...template, name: "  每日记录  " };
    const settings = mergeSettings(DEFAULT_SETTINGS, { noteTemplates: [named], templateStorageFolder: "My Templates" });
    expect(settings.noteTemplates[0]!.name).toBe("每日记录");
    expect(resolveTemplateName(settings.noteTemplates[0]!)).toBe("每日记录");
    const document = serializeSettings(settings);
    expect(document.preferences.templateStorageFolder).toBe("My Templates");
    expect(migrateSettings(document)).toEqual(settings);
    expect(migrateSettings({}).templateStorageFolder).toBe("Card Workspace Templates");
    expect(resolveTemplateName(template)).toBe("{{date}}.md");
  });
  it("rejects hidden and invalid storage while normalizing ordinary folder paths and root", () => {
    expect(normalizeTemplateFolderPath(" /Templates//Daily/ ")).toBe("Templates/Daily");
    expect(normalizeTemplateFolderPath("/")).toBe("");
    for (const value of [".obsidian/plugins", "Templates/.hidden", "../outside", "a:b"]) expect(normalizeTemplateFolderPath(value)).toBeNull();
  });
  it.each(["en", "zh"] as const)("recognizes unchanged initial titles and their collision suffixes in %s", (language) => {
    const title = getUiStrings(language).noteInput.initialTemplateTitle;
    expect(isInitialTemplateTitle(title)).toBe(true); expect(isInitialTemplateTitle(title + " 2")).toBe(true);
    expect(isInitialTemplateTitle("Daily {{date}}")).toBe(false);
  });
});
