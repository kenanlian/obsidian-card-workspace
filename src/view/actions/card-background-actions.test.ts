import { describe, expect, it, vi } from "vitest";
import { Menu, TFile } from "obsidian";
import { ObsidianMockMenu } from "../../__mocks__/obsidian";
import { DEFAULT_SETTINGS, mergeSettings, type PartialPluginSettings } from "../../settings";
import { getUiStrings } from "../../i18n";
import type { ViewContext } from "../view-context";
import { CardBackgroundActions } from "./card-background-actions";
import { buildCardBackgroundMenu } from "../menus/card-background-menu";
import { CARD_BACKGROUND_TINTS } from "../../card-background";

function harness() {
  let settings = mergeSettings(DEFAULT_SETTINGS, {});
  const a = Object.assign(new TFile(), { path: "a.md" });
  const b = Object.assign(new TFile(), { path: "b.pdf" });
  const live = new Map([[a.path, a], [b.path, b]]);
  const saveSettings = vi.fn(async (patch: PartialPluginSettings) => { settings = mergeSettings(settings, patch); });
  const notify = vi.fn();
  const context = { getApp: () => ({ vault: { getAbstractFileByPath: (path: string) => live.get(path) } }), getSettings: () => settings, saveSettings, getUiStrings: () => getUiStrings("en"), notify } as unknown as ViewContext;
  return { a, b, live, saveSettings, notify, getSettings: () => settings, actions: new CardBackgroundActions(context) };
}
describe("card background actions and menus", () => {
  it("merges latest overrides, uses renamed identities, skips replacements and resets without disturbing other cards", async () => {
    const h = harness();
    await h.actions.apply([h.a], "red");
    h.live.delete(h.b.path); h.b.path = "renamed.pdf"; h.live.set(h.b.path, h.b);
    await h.actions.apply([h.b], "blue");
    expect(h.getSettings().cardBackgroundOverrides).toEqual({ "a.md": "red", "renamed.pdf": "blue" });
    h.live.set(h.a.path, Object.assign(new TFile(), { path: h.a.path }));
    await h.actions.apply([h.a, h.b], "pink");
    expect(h.getSettings().cardBackgroundOverrides).toEqual({ "a.md": "red", "renamed.pdf": "pink" });
    await h.actions.apply([h.b], null);
    expect(h.getSettings().cardBackgroundOverrides).toEqual({ "a.md": "red" });
    h.saveSettings.mockClear();
    await h.actions.apply([h.b], null);
    h.actions.dispose();
    await h.actions.apply([h.b], "red");
    expect(h.saveSettings).not.toHaveBeenCalled();
  });
  it("applies a mixed-type batch in a single write and reports failed persistence", async () => {
    const h = harness();
    await h.actions.apply([h.a, h.b], "green");
    expect(h.saveSettings).toHaveBeenCalledTimes(1);
    expect(h.getSettings().cardBackgroundOverrides).toEqual({ "a.md": "green", "b.pdf": "green" });
    h.saveSettings.mockRejectedValueOnce(new Error("disk"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await h.actions.apply([h.a], "red");
    expect(h.notify).toHaveBeenCalledWith(getUiStrings("en").cardBackground.failed);
    warn.mockRestore();
  });
  it("shows all direct choices in the submenu fallback and handles mixed checks", () => {
    const h = harness();
    const menu = new Menu();
    h.actions.appendMenu(menu, h.a.path);
    expect((menu as unknown as ObsidianMockMenu).items).toHaveLength(10);
    const mixed = new Menu() as unknown as ObsidianMockMenu;
    const apply = vi.fn();
    buildCardBackgroundMenu(mixed as unknown as Menu, getUiStrings("zh").cardBackground, undefined, apply);
    expect(mixed.items.every(item => !item.checked)).toBe(true);
    // Swatches are native icons even when the menu exposes no rendered DOM.
    expect(mixed.items.slice(1).map(item => ({ title: item.title, icon: item.icon }))).toEqual(
      CARD_BACKGROUND_TINTS.map(tint => ({
        title: getUiStrings("zh").cardBackground.colors[tint],
        icon: `card-workspace-background-${tint}`,
      })),
    );
    mixed.items[1]!.onClick?.({} as MouseEvent);
    expect(apply).toHaveBeenCalledWith("red");
  });
});
