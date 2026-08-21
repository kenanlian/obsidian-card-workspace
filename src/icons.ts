/**
 * Plugin-registered icons.
 *
 * `addIcon` renders its content inside a `0 0 100 100` viewBox, so 24-grid
 * artwork (Lucide, Tabler) has to be scaled up.
 */
const ICON_VIEWBOX_SCALE = 100 / 24;

/** Plugin identity glyph, shared by the view tab and the ribbon entry point. */
export const CARD_WORKSPACE_ICON = "card-workspace";

/**
 * Card Workspace's monochrome mark, from
 * `designs/card-workspace-icon/handoff/card-workspace-mono.svg`.
 */
export const CARD_WORKSPACE_ICON_SVG = `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="scale(${ICON_VIEWBOX_SCALE})"><path d="M3 4v16"/><rect x="7" y="3" width="11" height="7" rx="1.5"/><rect x="10" y="14" width="11" height="7" rx="1.5"/></g>`;

/**
 * Obsidian's built-in `folder` id resolves to its legacy open-folder glyph and
 * shadows Lucide's closed `folder`, so the Lucide artwork is registered here
 * under a plugin-owned id.
 */
export const PLAIN_FOLDER_ICON = "card-workspace-folder";

export const PLAIN_FOLDER_ICON_SVG = `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="scale(${ICON_VIEWBOX_SCALE})"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></g>`;

/** Tabler `package-import` / `package-export`, used by the bulk card box actions. */
export const BULK_ADD_TO_BOX_ICON = "card-workspace-package-import";

export const BULK_ADD_TO_BOX_ICON_SVG = `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="scale(${ICON_VIEWBOX_SCALE})"><path d="M12 21l-8 -4.5v-9l8 -4.5l8 4.5v4.5" /><path d="M12 12l8 -4.5" /><path d="M12 12v9" /><path d="M12 12l-8 -4.5" /><path d="M22 18h-7" /><path d="M18 15l-3 3l3 3" /></g>`;

export const BULK_REMOVE_FROM_BOX_ICON = "card-workspace-package-export";

export const BULK_REMOVE_FROM_BOX_ICON_SVG = `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="scale(${ICON_VIEWBOX_SCALE})"><path d="M12 21l-8 -4.5v-9l8 -4.5l8 4.5v4.5" /><path d="M12 12l8 -4.5" /><path d="M12 12v9" /><path d="M12 12l-8 -4.5" /><path d="M15 18h7" /><path d="M19 15l3 3l-3 3" /></g>`;
