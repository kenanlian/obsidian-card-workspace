import type { App, HeadingCache, TFile } from "obsidian";
import type { DragInsertAction } from "../settings";
import { buildContentClipboardText, buildTitleAndContentClipboardText } from "./note-ops";
import { extractHeadingSection, resolveHeadingAnchor } from "../services/heading-drag-insert";

/** One text builder for editor drops, menu insertion and mobile clipboard actions. */
export function buildCardInsertText(app: App, file: TFile, action: Exclude<DragInsertAction, "ask">,
  section?: { heading: HeadingCache; headings: HeadingCache[] }, targetPath = ""): string | null | Promise<string | null> {
  if (section) {
    if (action === "wiki" || action === "embed") {
      const anchor = resolveHeadingAnchor(section.headings, section.heading);
      return anchor === null ? null : `${action === "embed" ? "!" : ""}[[${app.metadataCache.fileToLinktext(file, targetPath, true)}${anchor}]]`;
    }
    return app.vault.cachedRead(file).then(content => extractHeadingSection(content, section.headings, section.heading, action === "title-content"));
  }
  switch (action) {
    case "wiki": return `[[${file.basename}]]`;
    case "embed": return `![[${file.basename}]]`;
    case "content": return buildContentClipboardText(app, file);
    case "title-content": return buildTitleAndContentClipboardText(app, file);
  }
}
