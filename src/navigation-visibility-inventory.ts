import { TFolder, type App } from "obsidian";
import { collectVaultTagIndex } from "./view/metadata-utils";

/** Vault APIs and cached metadata only; never read note bodies. */
export function collectNavigationVisibilityPaths(app: App, kind: "folders" | "tags"): string[] {
  if (kind === "tags") return [...(collectVaultTagIndex(app)?.tagPaths ?? [])];
  const paths: string[] = [];
  const walk = (folder: TFolder): void => {
    for (const child of folder.children) {
      if (child instanceof TFolder) { paths.push(child.path); walk(child); }
    }
  };
  walk(app.vault.getRoot());
  return paths;
}
