import { TFile, type App } from "obsidian";
export type ImageSource = { status: "unknown" | "none" } | { status: "found"; file: TFile };
export function isSupportedImagePath(path: string): boolean { return /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(path); }
/** Metadata is the sole body-reference source; never read Markdown for images. */
export function resolveFirstImage(app: App, note: TFile): ImageSource {
  const cache = app.metadataCache.getFileCache(note);
  if (!cache) return { status: "unknown" };
  let first: TFile | null = null;
  let firstOffset = Infinity;
  for (const ref of cache.embeds ?? []) {
    if (ref.position.start.offset >= firstOffset) continue;
    if (!ref.original.startsWith("!") || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(ref.link) || ref.position.start.offset <= (cache.frontmatterPosition?.end.offset ?? -1)) continue;
    let path = ref.link.split("#")[0];
    try { path = decodeURIComponent(path); } catch { /* valid literal percent paths still resolve */ }
    if (!path || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path) || !isSupportedImagePath(path)) continue;
    const file = app.metadataCache.getFirstLinkpathDest(path, note.path)
      ?? app.metadataCache.getFirstLinkpathDest(ref.link.split("#")[0], note.path);
    if (file instanceof TFile && isSupportedImagePath(file.path)) { first = file; firstOffset = ref.position.start.offset; }
  }
  return first ? { status: "found", file: first } : { status: "none" };
}
