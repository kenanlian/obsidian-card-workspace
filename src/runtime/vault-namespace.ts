import type { App } from "obsidian";

export function resolveVaultCacheNamespace(app: App): string {
  const adapter = app.vault.adapter as { getBasePath?: () => string; basePath?: string };
  const basePath = typeof adapter.getBasePath === "function"
    ? adapter.getBasePath()
    : typeof adapter.basePath === "string" ? adapter.basePath : "";
  if (basePath.trim()) return `path:${basePath}`;
  const getName = (app.vault as { getName?: () => string }).getName;
  return `name:${typeof getName === "function" ? getName.call(app.vault) : "unknown-vault"}`;
}


export interface VaultCacheIdentity { readonly namespace: string; readonly persistent: boolean; readonly degradation: string | null }
const LOCAL_IDENTITY_KEY = "card-workspace.cache-identity.v1";
/** App local storage is vault scoped, device local, and available since 1.8.7. */
export function resolveVaultCacheIdentity(app: App, device: import("./platform").RuntimeDevice): VaultCacheIdentity {
  if (device === "desktop") return Object.freeze({ namespace: resolveVaultCacheNamespace(app), persistent: true, degradation: null });
  try {
    const saved: unknown = app.loadLocalStorage(LOCAL_IDENTITY_KEY);
    const valid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    if (valid(saved)) return Object.freeze({ namespace: `local:${saved}`, persistent: true, degradation: null });
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    app.saveLocalStorage(LOCAL_IDENTITY_KEY, id);
    if (app.loadLocalStorage(LOCAL_IDENTITY_KEY) !== id) throw new Error("Local identity did not persist");
    return Object.freeze({ namespace: `local:${id}`, persistent: true, degradation: null });
  } catch {
    return Object.freeze({ namespace: `session:${Date.now()}:${Math.random()}`, persistent: false, degradation: "vault-local-storage-unavailable" });
  }
}
