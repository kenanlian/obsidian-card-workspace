import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings, type PartialPluginSettings } from "../settings";
import { CardBackgroundReconciler } from "./CardBackgroundReconciler";
import type { VaultMutationEvent } from "./vault-events";

describe("CardBackgroundReconciler", () => {
  it("moves folder descendants at boundaries, deletes references and ignores unrelated events", async () => {
    let settings = mergeSettings(DEFAULT_SETTINGS, { cardBackgroundOverrides: { "A/n.md": "red", "A/p.pdf": "blue", "AB/n.md": "pink" } });
    const saveSettings = vi.fn(async (patch: PartialPluginSettings) => { settings = mergeSettings(settings, patch); });
    const reconciler = new CardBackgroundReconciler({ getSettings: () => settings, saveSettings });
    const event: VaultMutationEvent = { eventType: "rename", path: "B", oldPath: "A", isFolder: true, fileKind: null };
    await reconciler.handleVaultMutation(event);
    expect(settings.cardBackgroundOverrides).toEqual({ "B/n.md": "red", "B/p.pdf": "blue", "AB/n.md": "pink" });
    await reconciler.handleVaultMutation({ ...event, eventType: "delete", path: "B/n.md", isFolder: false });
    expect(settings.cardBackgroundOverrides).toEqual({ "B/p.pdf": "blue", "AB/n.md": "pink" });
    await reconciler.handleVaultMutation({ ...event, eventType: "delete", path: "B" });
    expect(settings.cardBackgroundOverrides).toEqual({ "AB/n.md": "pink" });
    saveSettings.mockClear();
    await reconciler.handleVaultMutation({ ...event, eventType: "modify" });
    await reconciler.handleVaultMutation({ ...event, oldPath: null });
    await reconciler.handleVaultMutation(event);
    expect(saveSettings).not.toHaveBeenCalled();
  });
  it("rewrites exact file references and lets the moved color win collisions", async () => {
    const saveSettings = vi.fn(async () => {});
    const reconciler = new CardBackgroundReconciler({ getSettings: () => mergeSettings(DEFAULT_SETTINGS, { cardBackgroundOverrides: { "a.pdf": "red", "b.pdf": "blue", "a.pdfx": "pink" } }), saveSettings });
    await reconciler.handleVaultMutation({ eventType: "rename", path: "b.pdf", oldPath: "a.pdf", isFolder: false, fileKind: "pdf" });
    expect(saveSettings).toHaveBeenCalledWith({ cardBackgroundOverrides: { "b.pdf": "red", "a.pdfx": "pink" } });
  });
});
