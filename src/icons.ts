/**
 * Plugin-registered icons.
 *
 * `addIcon` renders its content inside a `0 0 100 100` viewBox, so 24-grid
 * Lucide artwork has to be scaled up.
 */
const LUCIDE_VIEWBOX_SCALE = 100 / 24;

/** Plugin identity glyph, shared by the view tab and the ribbon entry point. */
export const CARD_WORKSPACE_ICON = "layout-grid";

/**
 * Obsidian's built-in `folder` id resolves to its legacy open-folder glyph and
 * shadows Lucide's closed `folder`, so the Lucide artwork is registered here
 * under a plugin-owned id.
 */
export const PLAIN_FOLDER_ICON = "card-workspace-folder";

export const PLAIN_FOLDER_ICON_SVG = `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="scale(${LUCIDE_VIEWBOX_SCALE})"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></g>`;
