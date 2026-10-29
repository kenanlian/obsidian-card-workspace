import { afterEach, describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";
import { resolveRuntimeCapabilities, resolveRuntimeOpenBehavior } from "./capabilities";
import { createRuntimePlatformServices } from "./platform-services";
import { resolveVaultCacheNamespace } from "./vault-namespace";
import { getUiStrings } from "../i18n";

afterEach(() => { Platform.isDesktopApp = true; vi.unstubAllGlobals(); });

describe("runtime platform boundary", () => {
  it("refuses unsupported actions before touching any host or native bridge", async () => {
    Platform.isDesktopApp = false;
    const getApp = vi.fn(() => { throw new Error("Host must not be touched"); });
    const native = vi.fn(() => { throw new Error("Native modules forbidden"); });
    vi.stubGlobal("require", native);
    const services = createRuntimePlatformServices(getApp, globalThis as unknown as Window);
    expect(services.capabilities).toEqual({ ...resolveRuntimeCapabilities(false), quickInput: true });
    expect(services.device).toBe("phone");
    expect(services.quickInputPresentation).toBe("modal");
    expect(services.systemPath("note.md")).toBeNull();
    expect(services.quickInputDesktop()).toEqual({ outcome: "unavailable", reason: "platform" });
    expect(await services.openWindow()).toEqual({ outcome: "unavailable", reason: "platform" });
    expect(await services.reveal("note.md", getUiStrings("en").desktopShell)).toMatchObject({ ok: false });
    expect(await services.openExternal("note.md", getUiStrings("en").desktopShell)).toMatchObject({ ok: false });
    expect(getApp).not.toHaveBeenCalled(); expect(native).not.toHaveBeenCalled();
  });

  it("keeps host unavailability separate from platform support", async () => {
    const services = createRuntimePlatformServices(() => ({ workspace: {}, vault: { adapter: {} } }) as never, globalThis as unknown as Window);
    expect(services.capabilities.newWindow).toBe(true);
    expect(await services.openWindow()).toEqual({ outcome: "unavailable", reason: "host" });
    expect(services.systemPath("note.md")).toBeNull();
  });

  it("resolves a runtime preference without mutating persisted settings", () => {
    const settings = { defaultCardOpenBehavior: "new-window" as const };
    expect(resolveRuntimeOpenBehavior(settings.defaultCardOpenBehavior, resolveRuntimeCapabilities(false))).toBe("smart");
    expect(settings.defaultCardOpenBehavior).toBe("new-window");
    expect(resolveRuntimeOpenBehavior("new-window", resolveRuntimeCapabilities(true))).toBe("new-window");
  });

  it("preserves the namespace algorithm for both stores", () => {
    const namespace = (adapter: unknown, name = "vault") => resolveVaultCacheNamespace({ vault: { adapter, getName: () => name } } as never);
    expect(namespace({ getBasePath: () => "/vault" })).toBe("path:/vault");
    expect(namespace({ basePath: "/legacy" })).toBe("path:/legacy");
    expect(namespace({})).toBe("name:vault");
  });
});
