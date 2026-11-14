import { describe, expect, it } from "vitest";
import { advanceBoxDraw, localDrawDate, mapBoxDrawProgress, normalizeBoxDraw, normalizeBoxDrawProgress, sampleBoxPaths } from "./box-draw";
import { createCardBox, duplicateCardBox, reconcileBoxForVaultMutation } from "./card-boxes";
import { normalizeSettings } from "../settings";

const pool = ["a.md", "b.md", "c.md", "d.md", "e.md"];
const config = { mode: "cycle" as const, count: 3 };
const now = new Date(2026, 10, 14, 12);
const random = () => 0;

describe("box draw", () => {
  it("samples without replacement, permits repetition between groups, and does not mutate the pool", () => {
    expect(sampleBoxPaths(pool, 100, random)).toEqual(pool);
    expect(new Set(sampleBoxPaths(pool, 3)).size).toBe(3);
    expect(sampleBoxPaths(pool, 3, random)).toEqual(sampleBoxPaths(pool, 3, random));
    expect(pool).toHaveLength(5);
  });
  it("restores a group, finishes a short final group, and starts a fresh round only on next draw", () => {
    const first = advanceBoxDraw(pool, config, undefined, false, now, random);
    expect(first.currentGroup?.paths).toEqual(pool.slice(0, 3));
    expect(advanceBoxDraw(pool, config, first, false, now, random)).toBe(first);
    const last = advanceBoxDraw(pool, config, first, true, now, random);
    expect(last.currentGroup?.paths).toEqual(pool.slice(3));
    expect(last.round).toBe(1);
    expect(last.drawnPaths).toEqual(pool);
    const next = advanceBoxDraw(pool, config, last, true, now, random);
    expect(next.round).toBe(2);
    expect(next.drawnPaths).toHaveLength(3);
  });
  it("keeps daily groups fixed and advances exactly once after missed days", () => {
    const daily = { ...config, mode: "daily" as const, count: 2 };
    const first = advanceBoxDraw(pool, daily, undefined, false, now, random);
    expect(first.currentGroup?.date).toBe("2026-11-14");
    expect(advanceBoxDraw(pool, daily, first, false, new Date(2026, 10, 14, 23), random)).toBe(first);
    const next = advanceBoxDraw(pool, daily, first, false, new Date(2026, 10, 20), random);
    expect(next.drawnPaths).toHaveLength(4);
    expect(next.currentGroup?.paths).toEqual(pool.slice(2, 4));
    expect(localDrawDate(new Date(2026, 0, 2))).toBe("2026-01-02");
  });
  it("changes N only for future groups and shares progress across cycle and daily", () => {
    const first = advanceBoxDraw(pool, config, undefined, false, now, random);
    expect(advanceBoxDraw(pool, { ...config, count: 1 }, first, false, now, random)).toBe(first);
    const daily = advanceBoxDraw(pool, { ...config, mode: "daily" }, first, false, now, random);
    expect(daily.currentGroup?.paths).toEqual(pool.slice(3));
    expect(advanceBoxDraw(pool, config, daily, false, now, random)).toBe(daily);
  });
  it("keeps hidden paths recorded, adds members to the remainder, and refills a fully departed group", () => {
    const first = advanceBoxDraw(pool, config, undefined, false, now, random);
    expect(advanceBoxDraw(pool.slice(3), config, first, false, now, random)).toBe(first);
    const pruned = mapBoxDrawProgress(first, path => first.currentGroup?.paths.includes(path) ? null : path);
    const next = advanceBoxDraw([...pool.slice(3), "new.md"], config, pruned, false, now, random);
    expect(next.currentGroup?.paths).toEqual(["d.md", "e.md", "new.md"]);
    expect(next.round).toBe(1);
  });
  it("follows file and folder renames, prunes deletions, and copies config without progress", () => {
    const box = { ...createCardBox("Box", []), draw: config, drawProgress: advanceBoxDraw(["old/a.md"], config, undefined, false, now, random) };
    const renamed = reconcileBoxForVaultMutation(box, { eventType: "rename", path: "new", oldPath: "old", isFolder: true });
    expect(renamed.drawProgress?.currentGroup?.paths).toEqual(["new/a.md"]);
    const moved = reconcileBoxForVaultMutation(renamed, { eventType: "rename", path: "b.md", oldPath: "new/a.md", isFolder: false });
    expect(moved.drawProgress?.drawnPaths).toEqual(["b.md"]);
    const deleted = reconcileBoxForVaultMutation(moved, { eventType: "delete", path: "b.md", oldPath: null, isFolder: false });
    expect(deleted.drawProgress?.currentGroup?.paths).toEqual([]);
    const copy = duplicateCardBox([box], box.id)[1]!;
    expect(copy.draw).toEqual(config);
    expect(copy.drawProgress).toBeUndefined();
  });
  it("loads legacy defaults, validates optional fields, and retains persisted progress", () => {
    expect(normalizeBoxDraw(undefined)).toEqual({ mode: "random", count: 5 });
    expect(normalizeBoxDraw({ mode: "bad", count: 1000 })).toEqual({ mode: "random", count: 100 });
    expect(normalizeBoxDrawProgress({ round: -1 })).toBeUndefined();
    const box = { ...createCardBox("Box", []), draw: config, drawProgress: advanceBoxDraw(pool, config, undefined, false, now, random) };
    expect(normalizeSettings({ boxes: [box] }).boxes[0]?.drawProgress).toEqual(box.drawProgress);
  });
});
