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

