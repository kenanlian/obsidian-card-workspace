import type { LinksScope } from "./scope";
import { locationExistsInLines, type LinkCardLocation, type LinkReferenceLocation } from "./link-card-location";
import { buildLightPreview, type LightPreviewResult, type PreviewMode } from "./markdown-utils";
import { buildLocationPreviewFromLines } from "./context-preview";

export interface LinkReferenceSnippet {
  readonly id: string;
  readonly text: string;
  readonly html: string;
  readonly mode: PreviewMode;
  readonly referenceCount: number;
  readonly location: LinkCardLocation;
  readonly targetLocation?: LinkCardLocation;
  readonly displayTarget?: boolean;
  readonly openingPreview?: boolean;
}

export interface LinkReferencePreview {
  readonly direction: LinksScope["direction"];
  readonly expanded: boolean;
  readonly status: "loading" | "ready" | "unavailable";
  readonly sourcePath: string;
  readonly sourceMtime: number;
  readonly sourceRevision: number;
  readonly contextKey: string;
  readonly totalSnippets: number;
  readonly snippets: readonly LinkReferenceSnippet[];
}

/** Display grouping keeps the original reference positions unchanged. */
export async function buildLinkReferenceSnippets(
  markdown: string, references: readonly LinkReferenceLocation[], limit: number,
  idPrefix: string, isCurrent: () => boolean,
): Promise<{ snippets: LinkReferenceSnippet[]; totalSnippets: number } | null> {
  if (!isCurrent()) return null;
  const lines = markdown.split(/\r?\n/);
  const paragraphs = new Map<number, LinkReferenceLocation[]>();
  const boundaries = new Int32Array(lines.length);
  let paragraph = 0;
  let deadline = performance.now() + 8;
  const checkpoint = async (): Promise<boolean> => {
    if (performance.now() >= deadline) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      if (!isCurrent()) return false;
      deadline = performance.now() + 8;
    }
    // A synchronous slice cannot receive a newer view selection. Revalidating
    // the entire metadata fingerprint per snippet would make "all" quadratic.
    return true;
  };
  for (let line = 0; line < lines.length; line++) {
    if (!lines[line].trim() || /^(?:#{1,6}\s|\s*(?:[-*+]\s|\d+[.)]\s|>|`{3,}|~{3,}))/.test(lines[line])) paragraph = line;
    boundaries[line] = paragraph;
    if (line % 256 === 0 && !(await checkpoint())) return null;
  }
  let referenceIndex = 0;
  for (const reference of references) {
    if (++referenceIndex % 256 === 0 && !(await checkpoint())) return null;
    if (!locationExistsInLines(lines, reference.source)
      || !markdown.startsWith(reference.original, reference.offset)
      || !lines[reference.source.line].startsWith(reference.original, reference.source.ch ?? 0)) continue;
    const key = boundaries[reference.source.line];
    const group = paragraphs.get(key);
    if (group) group.push(reference);
    else paragraphs.set(key, [reference]);
  }
  const snippets: LinkReferenceSnippet[] = [];
  for (const group of paragraphs.values()) {
    if (snippets.length >= limit) break;
    const first = group[0];
    const startLine = first.source.line;
    const sourceLine = lines[startLine];
    const startCol = Math.max(0, (first.source.ch ?? 0) - 60);
    // Each excerpt is bounded even when the user chooses every reference.
    const following = lines[startLine + 1];
    const raw = sourceLine.slice(startCol, startCol + 200)
      + (following?.trim() && boundaries[startLine + 1] === boundaries[startLine] ? `\n${following.slice(0, 200)}` : "");
    const text = raw.slice(0, 200).replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, alias: string | undefined) => alias ?? target);
    const preview = buildLightPreview(raw, 200, 3);
    snippets.push({ id: `${idPrefix}:${first.offset}`, text, html: preview.html, mode: preview.mode, referenceCount: group.length,
      location: { ...first.source }, targetLocation: group.find((reference) => reference.target)?.target });
    if (!(await checkpoint())) return null;
  }
  return isCurrent() ? { snippets, totalSnippets: paragraphs.size } : null;
}

/** Plain outgoing links show the ordinary destination preview; anchors show their target. */
export async function buildOutgoingReferenceSnippets(
  sourceMarkdown: string, targetMarkdown: string, references: readonly LinkReferenceLocation[],
  idPrefix: string, isCurrent: () => boolean, openingPreview: LightPreviewResult,
): Promise<{ snippets: LinkReferenceSnippet[]; totalSnippets: number } | null> {
  if (!isCurrent()) return null;
  const sourceLines = sourceMarkdown.split(/\r?\n/);
  const targetLines = targetMarkdown.split(/\r?\n/);
  const targets = new Map<string, LinkReferenceLocation[]>();
  const openingReferences: LinkReferenceLocation[] = [];
  const fallback: LinkReferenceLocation[] = [];
  let deadline = performance.now() + 8;
  for (const reference of references) {
    if (performance.now() >= deadline) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      if (!isCurrent()) return null;
      deadline = performance.now() + 8;
    }
    if (!sourceMarkdown.startsWith(reference.original, reference.offset)
      || !locationExistsInLines(sourceLines, reference.source)
      || !sourceLines[reference.source.line].startsWith(reference.original, reference.source.ch ?? 0)) continue;
    const target = reference.target;
    if (!reference.subpath && !target) {
      openingReferences.push(reference);
      continue;
    }
    if (!target || !locationExistsInLines(targetLines, target)) {
      fallback.push({ ...reference, target: undefined });
      continue;
    }
    const key = `${target.line}:${target.endLine}:${target.expectedBlockId}:${target.expectedText}`;
    const group = targets.get(key);
    if (group) group.push(reference);
    else targets.set(key, [reference]);
  }
  const bySourceIdentity = new Map<string, LinkReferenceSnippet>();
  const firstOpening = openingReferences[0];
  if (firstOpening) {
    bySourceIdentity.set(firstOpening.source.identity, { id: `${idPrefix}:${firstOpening.offset}:opening`,
      text: targetMarkdown.slice(0, 200), ...openingPreview, referenceCount: openingReferences.length,
      location: { ...firstOpening.source }, targetLocation: { line: 0, ch: 0, identity: "target:opening" },
      displayTarget: true, openingPreview: true });
  }
  for (const group of targets.values()) {
    if (performance.now() >= deadline) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      if (!isCurrent()) return null;
      deadline = performance.now() + 8;
    }
    const first = group[0];
    const target = first.target!;
    let end = Math.min(targetLines.length, target.line + 6);
    if (target.expectedBlockId && target.endLine !== undefined) {
      end = Math.min(end, target.endLine + 1);
      if (targetLines[end]?.trim() === `^${target.expectedBlockId}`) end++;
    } else {
      const level = targetLines[target.line].match(/^\s{0,3}(#{1,6})\s/)?.[1].length
        ?? (/^\s*=+\s*$/.test(targetLines[target.line + 1] ?? "") ? 1 : 2);
      let fenceMarker = "", fenceLength = 0;
      for (let line = target.line + 1; line < end; line++) {
        const fence = targetLines[line].match(/^\s{0,3}(`{3,}|~{3,})/);
        if (fence) {
          if (!fenceMarker) { fenceMarker = fence[1][0]; fenceLength = fence[1].length; }
          else if (fence[1][0] === fenceMarker && fence[1].length >= fenceLength && /^\s*[`~]+\s*$/.test(targetLines[line])) fenceMarker = "";
          continue;
        }
        if (fenceMarker) continue;
        const nextLevel = targetLines[line].match(/^\s{0,3}(#{1,6})\s/)?.[1].length
          ?? (targetLines[line].trim() && /^\s*=+\s*$/.test(targetLines[line + 1] ?? "") ? 1
            : targetLines[line].trim() && /^\s*-+\s*$/.test(targetLines[line + 1] ?? "") ? 2 : undefined);
        if (nextLevel !== undefined && nextLevel <= level) { end = line; break; }
      }
    }
    const preview = buildLocationPreviewFromLines(targetLines, target, 200, 3, end);
    if (!preview?.html) {
      fallback.push(...group.map((reference) => ({ ...reference, target: undefined })));
      continue;
    }
    bySourceIdentity.set(first.source.identity, { id: `${idPrefix}:${first.offset}:target`,
      text: targetLines.slice(target.line, end).join("\n").slice(0, 200),
      html: preview.html, mode: preview.mode, referenceCount: group.length,
      location: { ...first.source }, targetLocation: { ...target }, displayTarget: true });
  }
  // Iterate in original source order even when invalid destination previews fall back.
  const fallbackIdentities = new Set(fallback.map((reference) => reference.source.identity));
  const sourceResult = fallback.length ? await buildLinkReferenceSnippets(sourceMarkdown,
    references.filter((reference) => fallbackIdentities.has(reference.source.identity)).map((reference) => ({ ...reference, target: undefined })),
    Infinity, idPrefix, isCurrent) : { snippets: [], totalSnippets: 0 };
  if (!sourceResult || !isCurrent()) return null;
  for (const snippet of sourceResult.snippets) bySourceIdentity.set(snippet.location.identity, snippet);
  const snippets: LinkReferenceSnippet[] = [];
  for (const reference of references) {
    const snippet = bySourceIdentity.get(reference.source.identity);
    if (snippet) { snippets.push(snippet); bySourceIdentity.delete(reference.source.identity); }
  }
  return { snippets, totalSnippets: snippets.length };
}
