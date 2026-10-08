import { describe, expect, it, vi } from "vitest";
import { asMock, elementsIn, groupsIn, settingsIn, type MockEl } from "../../__mocks__/obsidian-modal-mock";
import { getUiStrings } from "../../i18n";
import { DEFAULT_SETTINGS, mergeSettings } from "../../settings";
import { SettingsStore } from "../../services/SettingsStore";
import type { NavigationVisibilityModalOptions } from "./NavigationVisibilityModal";

vi.mock("obsidian", async () => ({
  ...await import("../../__mocks__/obsidian"),
  ...await import("../../__mocks__/obsidian-modal-mock"),
}));

const { NavigationVisibilityModal } = await import("./NavigationVisibilityModal");
class TestModal extends NavigationVisibilityModal {
  submitDraft() { return this.submit(); }
}
const strings = getUiStrings("en");
function content(modal: TestModal) { return modal.contentEl as unknown as MockEl; }
function rows(modal: TestModal) {
  const list = elementsIn(content(modal), (el) => el.hasClass("fce-navigation-visibility__list"))[0]!;
  return groupsIn(list)[0]!.settings;
}
function search(modal: TestModal, query: string) {
  settingsIn(content(modal)).find((setting) => setting.searches.length)?.searches[0]?.type(query);
}
function toggle(modal: TestModal, path: string, hidden: boolean) {
  rows(modal).find((row) => row.name === path)?.toggles[0]?.set(hidden);
}
function bulk(modal: TestModal, text: string) {
  settingsIn(content(modal)).flatMap((row) => row.buttons).find((button) => button.text === text)?.click();
}
function open(options: Partial<NavigationVisibilityModalOptions> = {}) {
  let settings = mergeSettings(DEFAULT_SETTINGS, {});
  const collectPaths = vi.fn(() => ["A", "A/child", "B"]);
  const saveSettings = vi.fn(async (patch) => { settings = mergeSettings(settings, patch); });
  const flushSettings = vi.fn(async () => {});
  const resolved: NavigationVisibilityModalOptions = { kind: "folders", strings, collectPaths,
    getSettings: () => settings, saveSettings, flushSettings, ...options };
  const modal = new TestModal({} as never, resolved);
  modal.open();
  return { modal, collectPaths, saveSettings, flushSettings, getSettings: resolved.getSettings,
    setSettings: (patch: Parameters<typeof mergeSettings>[1]) => { settings = mergeSettings(settings, patch); } };
}

describe("NavigationVisibilityModal", () => {
  it("searches the one-time full inventory, edits a draft, and discards Cancel", () => {
    const { modal, collectPaths, saveSettings } = open();
    const searchRow = settingsIn(content(modal))[0];
    toggle(modal, "B", true);
    search(modal, "A/CHILD");
    expect(rows(modal).map((row) => row.name)).toEqual(["A/child"]);
    search(modal, "");
    expect(rows(modal).find((row) => row.name === "B")?.toggles[0]?.value).toBe(true);
    expect(settingsIn(content(modal))[0]).toBe(searchRow);
    expect(collectPaths).toHaveBeenCalledTimes(1);
    asMock(modal).buttons.find((button) => button.cancel)?.click();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("blocks inherited child edits, restores the parent in place, and retains independent child hiding", async () => {
    const settings = mergeSettings(DEFAULT_SETTINGS, { hiddenFolderPaths: ["A", "A/child"] });
    const h = open({ getSettings: () => settings });
    const parent = rows(h.modal).find((row) => row.name === "A")!;
    const child = rows(h.modal).find((row) => row.name === "A/child")!;
    expect(child.toggles[0]?.disabled).toBe(true);
    expect(child.desc).toContain(strings.navigationVisibility.inherited("A"));
    toggle(h.modal, "A/child", false);
    toggle(h.modal, "A", false);
    expect(rows(h.modal).find((row) => row.name === "A")).toBe(parent);
    expect(child.toggles[0]?.disabled).toBe(false);
    expect(child.toggles[0]?.value).toBe(true);
    await h.modal.submitDraft();
    expect(h.saveSettings).toHaveBeenCalledWith({ hiddenFolderPaths: ["A/child"] });
  });

  it("includes missing rules and keeps them listed after restoration", async () => {
    const settings = mergeSettings(DEFAULT_SETTINGS, { hiddenFolderPaths: ["ghost"] });
    const h = open({ getSettings: () => settings });
    const ghost = rows(h.modal).find((row) => row.name === "ghost")!;
    expect(ghost.desc).toContain(strings.navigationVisibility.missing);
    toggle(h.modal, "ghost", false);
    search(h.modal, "ghost");
    expect(rows(h.modal)[0]?.toggles[0]?.value).toBe(false);
    await h.modal.submitDraft();
    expect(h.saveSettings).toHaveBeenCalledWith({ hiddenFolderPaths: [] });
    expect(asMock(h.modal).closeCount).toBe(1);
  });

  it("bulk edits only the filtered list and restores all even behind a search", async () => {
    const h = open();
    search(h.modal, "A");
    bulk(h.modal, strings.navigationVisibility.hideMatches);
    search(h.modal, "B");
    expect(rows(h.modal)[0]?.toggles[0]?.value).toBe(false);
    bulk(h.modal, strings.navigationVisibility.hideMatches);
    bulk(h.modal, strings.navigationVisibility.restoreMatches);
    search(h.modal, "A");
    expect(rows(h.modal).every((row) => row.toggles[0]?.value)).toBe(true);
    bulk(h.modal, strings.navigationVisibility.restoreAll);
    expect(rows(h.modal).every((row) => !row.toggles[0]?.value)).toBe(true);
    await h.modal.submitDraft();
    expect(h.saveSettings).toHaveBeenCalledWith({ hiddenFolderPaths: [] });
  });

  it("merges additions and removals against latest settings, preserving concurrent rules and other fields", async () => {
    const h = open();
    toggle(h.modal, "A", true);
    h.setSettings({ hiddenFolderPaths: ["concurrent"], filter: { tags: ["keep"] }, hiddenTagPaths: ["other"] });
    await h.modal.submitDraft();
    expect(h.getSettings()).toMatchObject({ hiddenFolderPaths: ["A", "concurrent"], filter: { tags: ["keep"] }, hiddenTagPaths: ["other"] });
    expect(h.flushSettings).toHaveBeenCalledTimes(1);
  });

  it("keeps draft and a visible error after a failed save; no-op retry flushes dirty memory to disk", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("disk failed")).mockResolvedValue(undefined);
    const store = new SettingsStore({ load: async () => undefined, save });
    await store.init();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = open({ getSettings: () => store.getFlat(), saveSettings: async (patch) => { await store.updateFlat(patch); },
      flushSettings: () => store.flushPendingWrites() });
    toggle(h.modal, "B", true);
    await h.modal.submitDraft();
    expect(asMock(h.modal).closeCount).toBe(0);
    const error = elementsIn(content(h.modal), (el) => el.hasClass("fce-navigation-visibility__error"))[0]!;
    expect(error.text).toBe(strings.navigationVisibility.saveFailed);
    expect(store.getFlat().hiddenFolderPaths).toEqual(["B"]);
    expect(save).toHaveBeenCalledTimes(1);
    await h.modal.submitDraft();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0].userData.hiddenFolderPaths).toEqual(["B"]);
    expect(asMock(h.modal).closeCount).toBe(1);
    warning.mockRestore();
  });

  it("freezes draft controls and prevents concurrent submissions while a save is pending", async () => {
    let release!: () => void;
    const saveSettings = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const h = open({ saveSettings });
    toggle(h.modal, "B", true);
    const pending = h.modal.submitDraft();
    expect(rows(h.modal).find((row) => row.name === "B")?.toggles[0]?.disabled).toBe(true);
    bulk(h.modal, strings.navigationVisibility.restoreAll);
    await h.modal.submitDraft();
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(saveSettings).toHaveBeenCalledWith({ hiddenFolderPaths: ["B"] });
    release();
    await pending;
    expect(asMock(h.modal).closeCount).toBe(1);
  });

  it("uses tag identities, searches with #, and leaves folder rules alone", async () => {
    const h = open({ kind: "tags", collectPaths: () => ["work", "work/child"] });
    search(h.modal, "#work/child");
    toggle(h.modal, "#work/child", true);
    await h.modal.submitDraft();
    expect(h.saveSettings).toHaveBeenCalledWith({ hiddenTagPaths: ["work/child"] });
    expect(h.getSettings().hiddenFolderPaths).toEqual([]);
  });
});
