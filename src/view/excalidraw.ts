import type { App, TFile } from "obsidian";

/** Narrow compatibility seam for Obsidian's community-plugin registry. */
type AppWithPlugins = App & {
  plugins?: { getPlugin?: (id: string) => unknown };
  viewRegistry?: { getViewCreatorByType?: (type: string) => unknown };
};

export function isExcalidrawReady(app: App): boolean {
  const host = app as AppWithPlugins;
  const plugin = host.plugins?.getPlugin?.("obsidian-excalidraw-plugin");
  // Excalidraw registers its view before isReady, but returns a loading view until
  // that flag is true. A disabled/unloaded instance must not permit creation.
  return typeof plugin === "object" && plugin !== null
    && "_loaded" in plugin && plugin._loaded === true
    && "isReady" in plugin && plugin.isReady === true
    && typeof host.viewRegistry?.getViewCreatorByType?.("excalidraw") === "function";
}

/** Only for newly created drawings; ordinary card opening keeps its host policy. */
export async function openNewExcalidraw(app: App, file: TFile): Promise<void> {
  const leaf = app.workspace.getLeaf("tab");
  try {
    // Excalidraw's own setExcalidrawView uses this registered view type. Going
    // through openFile would depend on its metadata-based Markdown takeover.
    await leaf.setViewState({ type: "excalidraw", state: { file: file.path }, active: true });
    await leaf.loadIfDeferred();
    const opened = leaf.getViewState();
    if (opened.type !== "excalidraw" || opened.state?.file !== file.path) {
      throw new Error("Excalidraw view did not open the drawing");
    }
  } catch (error) {
    leaf.detach();
    throw error;
  }
}
