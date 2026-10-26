import { describe, it, expect, vi } from "vitest";
import { resolveVaultCacheIdentity } from "./vault-namespace";
import { resolveRuntimeResourceBudget, DESKTOP_RESOURCE_BUDGET } from "./resource-budget";
import { createRuntimePlatformServices } from "./platform-services";
import { Platform } from "obsidian";

describe("mobile identity and policy", () => {
  const vault = () => {
    const data = new Map<string, unknown>();
    return { vault: { getName: () => "same" }, loadLocalStorage: (key: string) => data.get(key), saveLocalStorage: (key: string, value: unknown) => { data.set(key, value); } };
  };
  it("isolates same-name vaults and keeps identity through restart and display rename", () => {
    const a = vault(), b = vault();
    const identity = resolveVaultCacheIdentity(a as never, "phone");
    expect(identity.persistent).toBe(true);
    expect(identity.namespace).not.toBe(resolveVaultCacheIdentity(b as never, "phone").namespace);
    a.vault.getName = () => "renamed";
    expect(resolveVaultCacheIdentity(a as never, "tablet")).toEqual(identity);
  });
  it("disables persistent caches when local storage throws or silently drops writes", () => {
    const a = vault(); a.saveLocalStorage = () => {};
    const first = resolveVaultCacheIdentity(a as never, "phone");
    expect(first).toMatchObject({ persistent: false, degradation: "vault-local-storage-unavailable" });
    expect(resolveVaultCacheIdentity(a as never, "phone").namespace).not.toBe(first.namespace);
    expect(resolveVaultCacheIdentity({} as never, "phone").persistent).toBe(false);
  });
  it("keeps desktop path identity and every desktop budget unchanged", () => {
    expect(resolveVaultCacheIdentity({ vault: { adapter: { getBasePath: () => "/a" } } } as never, "desktop").namespace).toBe("path:/a");
    expect(resolveRuntimeResourceBudget("desktop")).toBe(DESKTOP_RESOURCE_BUDGET);
    const phone = resolveRuntimeResourceBudget("phone"), tablet = resolveRuntimeResourceBudget("tablet");
    expect(phone.preview).toEqual({ concurrency: 2, startupCards: 3, startupWaitMs: 120, entries: 128, diagramBytes: 4 * 1024 * 1024 });
    expect(tablet.search).toEqual({ readers: 4, batchSize: 150, ingestTerms: 15000 });
    expect(phone.image).toEqual({ maxBytes: 20000000, maxPixels: 16000000, maxEdge: 768, coldTasks: 1 });
    expect(tablet.thumbnails).toEqual({ memoryEntries: 32, memoryBytes: 8 * 1024 * 1024, diskEntries: 1000, diskBytes: 128 * 1024 * 1024 });
    expect(Object.values(phone).every(Object.isFrozen)).toBe(true);
  });
  it("checks the optional host history adapter", () => {
    const service = createRuntimePlatformServices(() => ({} as never), globalThis as never);
    const back = vi.fn();
    expect(service.navigateBack({} as never).outcome).toBe("unavailable");
    expect(service.navigateBack({ history: { back } } as never).outcome).toBe("ok");
    expect(back).toHaveBeenCalledOnce(); expect(Platform.isDesktopApp).toBe(true);
  });
});
