import { describe, expect, it, vi } from "vitest";
import { LeafPreviewResources } from "./leaf-preview-resources";
import { DESKTOP_RESOURCE_BUDGET } from "../runtime/resource-budget";
import { createPreviewFingerprint } from "./preview-cache";

describe("leaf preview resources", () => {
  it("bounds admission across streams and settles cancelled queued work", async () => {
    const resources = new LeafPreviewResources(DESKTOP_RESOURCE_BUDGET);
    const owners = [{}, {}, {}]; const release: Array<() => void> = [];
    let active = 0, peak = 0; const starts: object[] = [];
    const jobs = owners.flatMap(owner => Array.from({ length: 8 }, () => resources.run(owner, () => true, async () => {
      starts.push(owner); active++; peak = Math.max(active, peak);
      await new Promise<void>(resolve => release.push(resolve)); active--;
    })));
    expect(resources.getDiagnostics().active).toBe(5);
    resources.cancel(owners[2]!);
    while (resources.getDiagnostics().active || resources.getDiagnostics().queued) {
      release.splice(0).forEach(resolve => resolve()); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    }
    await Promise.all(jobs);
    expect(peak).toBe(5); expect(starts).not.toContain(owners[2]);
    resources.dispose();
  });
  it("drops obsolete queued generations and keeps one bounded cache for the leaf", async () => {
    const resources = new LeafPreviewResources(DESKTOP_RESOURCE_BUDGET);
    let valid = true; const stale = vi.fn();
    const release: Array<() => void> = [];
    const blockers = Array.from({ length: 5 }, () => resources.run({}, () => true, () => new Promise<void>(resolve => release.push(resolve))));
    const queued = resources.run({}, () => valid, async () => { stale(); });
    valid = false; release.forEach(resolve => resolve());
    await Promise.all([...blockers, queued]); expect(stale).not.toHaveBeenCalled();
    for (let index = 0; index < 600; index++) resources.cache.set(createPreviewFingerprint(`${index}.md`, 1, 5, 100), { html: "preview", mode: "text" });
    expect(resources.getDiagnostics().cacheEntries).toBe(512);
    resources.dispose(); expect(resources.getDiagnostics().cacheEntries).toBe(0);
    await resources.run({}, () => true, async () => { throw new Error("closed pool must not run"); });
  });
});
