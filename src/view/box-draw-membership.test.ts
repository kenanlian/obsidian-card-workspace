import { describe, expect, it } from "vitest";
import { TFile, type App } from "obsidian";
import { createCardBox } from "./card-boxes";
import { reconcileBoxDrawMembership } from "./card-box-membership";

function fixture() {
  const file = Object.assign(new TFile(), { path: "notes/a.md" });
  let metadata: unknown = {};
  const app = { vault: { getAbstractFileByPath: (path: string) => path === file.path ? file : null },
    metadataCache: { getFileCache: () => metadata } } as unknown as App;
  const box = { ...createCardBox("Box", []), rules: [{ id: "rule", name: "Rule", folder: "notes", includeSubfolders: true, tags: [] as string[], properties: [] }],
    drawProgress: { round: 2, drawnPaths: [file.path], currentGroup: { paths: [file.path], date: "2026-11-14" } } };
  return { app, box, file, setMetadata: (value: unknown) => { metadata = value; } };
}

describe("draw membership reconciliation", () => {
  it("keeps true members regardless of display visibility and does not write or clone unchanged history", () => {
    const h = fixture();
    expect(reconcileBoxDrawMembership(h.app, h.box)).toBe(h.box);
  });
  it("prunes departures in inactive boxes, including progress outside manual and pin lists", () => {
    const h = fixture(); h.box.rules = [];
    const result = reconcileBoxDrawMembership(h.app, h.box, h.file.path);
    expect(result.drawProgress).toEqual({ round: 2, drawnPaths: [], currentGroup: { paths: [], date: "2026-11-14" } });
    expect(h.box.drawProgress.currentGroup.paths).toEqual(["notes/a.md"]);
  });
  it("retains metadata-dependent members until metadata is trustworthy", () => {
    const h = fixture(); h.box.rules[0]!.tags = ["topic"]; h.setMetadata(null);
    expect(reconcileBoxDrawMembership(h.app, h.box)).toBe(h.box);
    h.setMetadata({});
    expect(reconcileBoxDrawMembership(h.app, h.box).drawProgress?.drawnPaths).toEqual([]);
  });
  it("does not defer authoritative exclusions or moves outside a rule's folder", () => {
    const h = fixture(); h.box.rules[0]!.tags = ["topic"]; h.setMetadata(null);
    expect(reconcileBoxDrawMembership(h.app, { ...h.box, excludedPaths: [h.file.path] }).drawProgress?.drawnPaths).toEqual([]);
    h.box.rules[0]!.folder = "elsewhere";
    expect(reconcileBoxDrawMembership(h.app, h.box).drawProgress?.drawnPaths).toEqual([]);
  });
  it("retains manual-member precedence over exclusions without consulting metadata", () => {
    const h = fixture(); h.setMetadata(null);
    const box = { ...h.box, manualPaths: [h.file.path], excludedPaths: [h.file.path] };
    expect(reconcileBoxDrawMembership(h.app, box)).toBe(box);
  });
});
