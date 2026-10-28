import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings, type PartialPluginSettings } from "../settings";
import { TemplateReferenceReconciler } from "./TemplateReferenceReconciler";
import type { VaultMutationEvent } from "./vault-events";
const event: VaultMutationEvent = { eventType: "rename", path: "New", oldPath: "Old", isFolder: true, fileKind: null };
function harness() {
  const settings = { ...DEFAULT_SETTINGS, noteTemplates: [
    { id: "one", filePath: "Old/daily.md", targetFolderPath: "Old/notes", dateFormat: "YYYY", timeFormat: "HH" },
    { id: "two", filePath: "Older/note.md", targetFolderPath: null, dateFormat: "YYYY", timeFormat: "HH" },
  ], boxNewNoteFolderPath: "Old/boxes", quickInput: { folderPath: "Old/quick", insertPosition: "end" as const, duplicateTitle: "ask" as const } };
  const saveSettings = vi.fn(async (_patch: PartialPluginSettings) => undefined);
  return { settings, saveSettings, reconciler: new TemplateReferenceReconciler({ getSettings: () => settings, saveSettings }) };
}
describe("TemplateReferenceReconciler", () => {
  it("rewrites descendant files, fixed destinations and quick folders on folder rename only", async () => {
    const h = harness(); await h.reconciler.handleVaultMutation(event);
    expect(h.saveSettings).toHaveBeenCalledWith({ noteTemplates: [
      { ...h.settings.noteTemplates[0], name: "daily.md", filePath: "New/daily.md", targetFolderPath: "New/notes" }, h.settings.noteTemplates[1],
    ], boxNewNoteFolderPath: "New/boxes", quickInput: { ...h.settings.quickInput, folderPath: "New/quick" } });
  });
  it("follows exact file rename and preserves destination and stable ID", async () => {
    const h = harness(); await h.reconciler.handleVaultMutation({ ...event, oldPath: "Old/daily.md", path: "New/different.md", isFolder: false, fileKind: "markdown" });
    expect(h.saveSettings).toHaveBeenCalledWith({ noteTemplates: [
      { ...h.settings.noteTemplates[0], name: "daily.md", filePath: "New/different.md" }, h.settings.noteTemplates[1],
    ] });
  });
  it("retains missing references after deletion so writes cannot silently fall back", async () => {
    const h = harness(); await h.reconciler.handleVaultMutation({ ...event, eventType: "delete", oldPath: null });
    expect(h.saveSettings).not.toHaveBeenCalled();
  });
});


it("retains unavailable registrations after a Markdown template changes extension", async () => {
  const h = harness();
  h.saveSettings.mockImplementation(async (patch) => { Object.assign(h.settings, mergeSettings(h.settings, patch)); });
  await h.reconciler.handleVaultMutation({ ...event, oldPath: "Old/daily.md", path: "Old/daily.canvas", isFolder: false, fileKind: "canvas" });
  expect(h.settings.noteTemplates[0]).toMatchObject({ id: "one", filePath: "Old/daily.canvas" });
});
