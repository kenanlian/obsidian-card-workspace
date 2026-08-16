import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  Menu: class Menu {},
  Modal: class Modal {},
  Setting: class Setting {},
  TFile: class TFile {},
  TFolder: class TFolder {},
}));

import { createBoxScope, createFolderScope } from "../scope";
import { BoxActions } from "./box-actions";

describe("BoxActions", () => {
  it("derives active-box list semantics from runtime scope, not persisted activeBoxId", () => {
    let scope = createFolderScope("notes", true);
    const box = { id: "box-1", name: "One" };
    const actions = new BoxActions({
      context: {
        store: { getScope: () => scope },
        getSettings: () => ({ activeBoxId: "stale", boxes: [box] }),
      },
    } as never);

    expect(actions.isBoxMode()).toBe(false);
    expect(actions.getActiveBox()).toBeNull();

    scope = createBoxScope("box-1");
    expect(actions.isBoxMode()).toBe(true);
    expect(actions.getActiveBox()).toBe(box);
  });

  it("does not return to cards or persist when entering a rejected box scope", async () => {
    const returnToCards = vi.fn();
    const saveSettings = vi.fn();
    const actions = new BoxActions({
      context: { saveSettings },
      createProgrammaticSelectionRequest: vi.fn(() => ({ scope: createBoxScope("missing") })),
      handleScopeSelection: vi.fn(async () => ({ action: "rejected_invalid" })),
      returnToCardsViewIfSinglePane: returnToCards,
    } as never);

    await actions.enterBoxScope("missing");

    expect(returnToCards).not.toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("returns to cards once after entering an accepted box scope without direct persistence", async () => {
    const returnToCards = vi.fn();
    const saveSettings = vi.fn();
    const actions = new BoxActions({
      context: { saveSettings },
      createProgrammaticSelectionRequest: vi.fn(() => ({ scope: createBoxScope("box-1") })),
      handleScopeSelection: vi.fn(async () => ({ action: "started" })),
      returnToCardsViewIfSinglePane: returnToCards,
    } as never);

    await actions.enterBoxScope("box-1");

    expect(returnToCards).toHaveBeenCalledTimes(1);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("does not return to cards or persist when exiting to a rejected folder scope", async () => {
    const returnToCards = vi.fn();
    const saveSettings = vi.fn();
    const actions = new BoxActions({
      context: {
        getSettings: () => ({ lastFolderPath: "missing" }),
        saveSettings,
      },
      moveScopeToFolder: vi.fn(async () => ({ action: "rejected_invalid" })),
      returnToCardsViewIfSinglePane: returnToCards,
    } as never);

    await actions.exitBoxScope();

    expect(returnToCards).not.toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("returns to cards once after exiting to an accepted folder scope without direct persistence", async () => {
    const returnToCards = vi.fn();
    const saveSettings = vi.fn();
    const actions = new BoxActions({
      context: {
        getSettings: () => ({ lastFolderPath: "notes" }),
        saveSettings,
      },
      moveScopeToFolder: vi.fn(async () => ({ action: "started" })),
      returnToCardsViewIfSinglePane: returnToCards,
    } as never);

    await actions.exitBoxScope();

    expect(returnToCards).toHaveBeenCalledTimes(1);
    expect(saveSettings).not.toHaveBeenCalled();
  });
});
