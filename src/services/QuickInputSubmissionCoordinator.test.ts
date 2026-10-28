import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { DEFAULT_SETTINGS } from "../settings";
import type { QuickInputRequest } from "../note-input";
import { createCardBox } from "../view/card-boxes";
import type { NoteCreationService } from "./NoteCreationService";
import { QuickInputBoxesSaveError, QuickInputSubmissionCoordinator } from "./QuickInputSubmissionCoordinator";

function fixture() {
  let settings = structuredClone(DEFAULT_SETTINGS);
  settings.boxes = [createCardBox("One", []), createCardBox("Two", [])];
  const submitQuickInput = vi.fn(async () => ({ file: Object.assign(new TFile(), { path: "Saved.md" }), created: true }));
  let fail = false;
  const saveSettings = vi.fn(async (patch) => {
    if (fail) throw new Error("Disk unavailable");
    settings = { ...settings, ...patch };
  });
  const coordinator = new QuickInputSubmissionCoordinator({ notes: { submitQuickInput } as unknown as NoteCreationService,
    getSettings: () => settings, saveSettings });
  const request: QuickInputRequest = { submissionId: "one", text: "Body",
    config: { ...settings.quickInput, duplicateTitle: "number" }, now: new Date(), boxIds: settings.boxes.map((box) => box.id) };
  return { coordinator, request, submitQuickInput, saveSettings, settings: () => settings, fail: (value: boolean) => { fail = value; } };
}
describe("quick input plugin submission", () => {
  it("adds the final whole note path to all selected boxes without a card view", async () => {
    const f = fixture();
    await f.coordinator.submit(f.request);
    expect(f.settings().boxes.every((box) => box.manualPaths.includes("Saved.md"))).toBe(true);
  });
  it("keeps a completed note write when box persistence fails and retries only boxes", async () => {
    const f = fixture(); f.fail(true);
    await expect(f.coordinator.submit(f.request)).rejects.toBeInstanceOf(QuickInputBoxesSaveError);
    f.fail(false);
    await f.coordinator.submit(f.request);
    expect(f.submitQuickInput).toHaveBeenCalledOnce();
    expect(f.settings().boxes[0].manualPaths).toEqual(["Saved.md"]);
  });
  it("rejects missing boxes before saving any note", async () => {
    const f = fixture(); f.request.boxIds = ["missing"];
    await expect(f.coordinator.submit(f.request)).rejects.toMatchObject({ code: "missing-box" });
    expect(f.submitQuickInput).not.toHaveBeenCalled();
  });
  it("uses latest box settings on retry and never removes existing memberships", async () => {
    const f = fixture(); f.fail(true);
    await expect(f.coordinator.submit(f.request)).rejects.toBeInstanceOf(QuickInputBoxesSaveError);
    f.settings().boxes[0].name = "Renamed";
    f.settings().boxes[0].manualPaths = ["Existing.md"];
    f.fail(false);
    await f.coordinator.submit(f.request);
    expect(f.settings().boxes[0]).toMatchObject({ name: "Renamed", manualPaths: ["Existing.md", "Saved.md"] });
  });
  it("deduplicates a pending submission and preserves concurrent draft additions", async () => {
    const f = fixture();
    const first = f.coordinator.submit(f.request);
    expect(f.coordinator.submit(f.request)).toBe(first);
    f.submitQuickInput.mockResolvedValueOnce({ file: Object.assign(new TFile(), { path: "Other.md" }), created: true });
    await Promise.all([first, f.coordinator.submit({ ...f.request, submissionId: "two" })]);
    expect(f.settings().boxes[0].manualPaths).toEqual(["Saved.md", "Other.md"]);
  });
});


it("retains the frozen note attempt when a selected box disappears after an uncertain write", async () => {
  const f = fixture();
  f.submitQuickInput.mockRejectedValueOnce(new Error("Unknown write result"));
  await expect(f.coordinator.submit(f.request)).rejects.toThrow("Unknown write result");
  f.settings().boxes = [];
  await expect(f.coordinator.submit(f.request)).rejects.toBeInstanceOf(QuickInputBoxesSaveError);
  expect(f.submitQuickInput).toHaveBeenCalledTimes(2);
});
