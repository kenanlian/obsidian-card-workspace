import {
  DEFAULT_PREVIEW_LINES,
  PREVIEW_LINES_MAX,
  PREVIEW_LINES_MIN,
} from "../settings";

const MAX_PREVIEW_SCAN_LINES = 400;

// Contract preset for preview normalization workstream: unified summary with weak cues only.
export const PREVIEW_STYLE_PRESET = "unified-summary-weak-cues" as const;
export const DEFAULT_PREVIEW_MAX_VISIBLE_CHARS = 200;

export type PreviewMode = "text" | "code" | "empty";

export interface LightPreviewResult {
  html: string;
  mode: PreviewMode;
}

interface InlineSegment {
  type: "text" | "strong" | "em" | "code";
  text: string;
}

interface InlineRenderResult {
  html: string;
  consumedChars: number;
  truncated: boolean;
}

export function stripMarkdownToText(markdown: string, maxLength = 260): string {
  const text = markdown
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, (_match: string, codeText: string) => {
      return /^[A-Za-z0-9 _-]+$/.test(codeText) ? codeText : " ";
    })
    .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
    .replace(/\$([^$\n]+)\$/g, "$1")
    .replace(/\\\((.*?)\\\)/g, "$1")
    .replace(/\\\[(.*?)\\\]/g, "$1")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/!\[\[[^\]]+]]/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\[\[([^\]#|]+)(?:#[^\]|]+)?(?:\|([^\]]+))?]]/g, (_, link, alias) => alias ?? link)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~=>]/g, " ")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength).trimEnd()}...`;
}

export function buildLightPreview(
  markdown: string,
  maxVisibleChars = DEFAULT_PREVIEW_MAX_VISIBLE_CHARS,
  previewLines = DEFAULT_PREVIEW_LINES,
): LightPreviewResult {
  const content = stripFrontmatter(markdown).replace(/\r\n/g, "\n");
  const lines = content.split("\n");
  const scanLimit = Math.min(lines.length, MAX_PREVIEW_SCAN_LINES);
  const normalizedPreviewLines = normalizePreviewLineBudget(previewLines);

  let index = 0;
  while (index < scanLimit) {
    const trimmed = lines[index].trim();
    if (trimmed.length === 0 || isImageOnlyLine(trimmed)) {
      index += 1;
      continue;
    }

    const fence = getFenceInfo(trimmed);
    if (fence) {
      const codeBlock = readFenceCodeBlock(
        lines,
        index,
        scanLimit,
        fence.marker,
        fence.size,
        normalizedPreviewLines,
      );
      if (codeBlock.previewText.length > 0) {
        const clipped = clipTextWithLimit(codeBlock.previewText, maxVisibleChars);
        let display = clipped.text.trimEnd();
        if ((clipped.truncated || codeBlock.truncatedByLines) && display.length > 0) {
          display = display.includes("\n") ? `${display}\n...` : `${display}...`;
        }
        if (display.length > 0) {
          return {
            html: `<p class="fce-preview-code"><code>${escapeHtml(display)}</code></p>`,
            mode: "code"
          };
        }
      }
      index = codeBlock.nextIndex;
      continue;
    }

    break;
  }

  let remainingChars = maxVisibleChars;
  let remainingBlocks = normalizedPreviewLines;
  const htmlParts: string[] = [];

  while (index < scanLimit && remainingChars > 0 && remainingBlocks > 0) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      index += 1;
      continue;
    }

    if (isImageOnlyLine(trimmed)) {
      index += 1;
      continue;
    }

    const fence = getFenceInfo(trimmed);
    if (fence) {
      index = skipFenceCodeBlock(lines, index, scanLimit, fence.marker, fence.size);
      continue;
    }

    const headingMatch = trimmed.match(/^#{1,6}\s+(.*)$/);
    if (headingMatch?.[1]) {
      const rendered = renderInlineWithLimit(headingMatch[1], remainingChars);
      if (rendered.consumedChars > 0) {
        htmlParts.push(`<p class="fce-preview-heading">${rendered.html}</p>`);
        remainingChars -= rendered.consumedChars;
        remainingBlocks -= 1;
      }
      if (rendered.truncated) {
        break;
      }
      index += 1;
      continue;
    }

    const ulMatch = trimmed.match(/^[-*+]\s+(.*)$/);
    if (ulMatch?.[1]) {
      const rendered = renderInlineWithLimit(ulMatch[1], remainingChars);
      if (rendered.consumedChars > 0) {
        htmlParts.push(`<p>${rendered.html}</p>`);
        remainingChars -= rendered.consumedChars;
        remainingBlocks -= 1;
      }
      if (rendered.truncated) {
        break;
      }
      index += 1;
      continue;
    }

    const olMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (olMatch?.[1]) {
      const rendered = renderInlineWithLimit(olMatch[1], remainingChars);
      if (rendered.consumedChars > 0) {
        htmlParts.push(`<p>${rendered.html}</p>`);
        remainingChars -= rendered.consumedChars;
        remainingBlocks -= 1;
      }
      if (rendered.truncated) {
        break;
      }
      index += 1;
      continue;
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      const quoteText = quoteMatch[1] ?? "";
      const rendered = renderInlineWithLimit(quoteText, remainingChars);
      if (rendered.consumedChars > 0) {
        htmlParts.push(`<p>${rendered.html}</p>`);
        remainingChars -= rendered.consumedChars;
        remainingBlocks -= 1;
      }
      if (rendered.truncated) {
        break;
      }
      index += 1;
      continue;
    }

    const paragraphLines: string[] = [trimmed];
    let cursor = index + 1;
    while (cursor < scanLimit && paragraphLines.length < remainingBlocks) {
      const next = lines[cursor].trim();
      if (next.length === 0 || isBlockStarter(next)) {
        break;
      }
      paragraphLines.push(next);
      cursor += 1;
    }

    const rendered = renderInlineWithLimit(paragraphLines.join(" "), remainingChars);
    if (rendered.consumedChars > 0) {
      htmlParts.push(`<p>${rendered.html}</p>`);
      remainingChars -= rendered.consumedChars;
      remainingBlocks -= paragraphLines.length;
    }
    if (rendered.truncated) {
      break;
    }

    index = cursor;
  }

  if (htmlParts.length === 0) {
    // Explicit empty handling: only truly non-previewable/syntactically empty notes return `empty`.
    return { html: "", mode: "empty" };
  }

  return { html: htmlParts.join(""), mode: "text" };
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---[\s\S]*?---\s*/m, "");
}

function isBlockStarter(line: string): boolean {
  return isImageOnlyLine(line) || /^#{1,6}\s+/.test(line) || /^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line) || /^>\s?/.test(line) || !!getFenceInfo(line);
}

function isImageOnlyLine(line: string): boolean {
  const trimmed = line.trim();
  if (/^!\[\[[^\]]+]]$/.test(trimmed)) {
    return true;
  }
  if (/^!\[[^\]]*]\([^)]+\)$/.test(trimmed)) {
    return true;
  }
  return /^<img\s[^>]*>$/i.test(trimmed);
}

function getFenceInfo(line: string): { marker: "`" | "~"; size: number } | null {
  const match = line.match(/^\s*(`{3,}|~{3,})/);
  if (!match?.[1]) {
    return null;
  }
  const token = match[1];
  const marker = token[0] as "`" | "~";
  return { marker, size: token.length };
}

function readFenceCodeBlock(
  lines: string[],
  startIndex: number,
  scanLimit: number,
  marker: "`" | "~",
  size: number,
  previewLines: number,
): { previewText: string; truncatedByLines: boolean; nextIndex: number } {
  const body: string[] = [];
  let cursor = startIndex + 1;

  while (cursor < scanLimit) {
    const line = lines[cursor];
    if (isFenceClosingLine(line.trim(), marker, size)) {
      cursor += 1;
      break;
    }
    body.push(line);
    cursor += 1;
  }

  const selected = body.slice(0, previewLines);
  return {
    previewText: selected.join("\n").trimEnd(),
    truncatedByLines: body.length > previewLines,
    nextIndex: cursor
  };
}

function skipFenceCodeBlock(
  lines: string[],
  startIndex: number,
  scanLimit: number,
  marker: "`" | "~",
  size: number
): number {
  let cursor = startIndex + 1;
  while (cursor < scanLimit) {
    if (isFenceClosingLine(lines[cursor].trim(), marker, size)) {
      return cursor + 1;
    }
    cursor += 1;
  }
  return cursor;
}

function renderInlineWithLimit(source: string, limit: number): InlineRenderResult {
  if (limit <= 0) {
    return { html: "", consumedChars: 0, truncated: true };
  }

  const normalized = normalizeInlineSource(source);
  if (normalized.length === 0) {
    return { html: "", consumedChars: 0, truncated: false };
  }

  const segments = parseInlineSegments(normalized);
  let remaining = limit;
  let consumedChars = 0;
  const htmlParts: string[] = [];
  let truncated = false;

  for (const segment of segments) {
    if (remaining <= 0) {
      truncated = true;
      break;
    }

    const slice = segment.text.slice(0, remaining);
    if (slice.length === 0) {
      continue;
    }

    consumedChars += slice.length;
    remaining -= slice.length;

    const escaped = escapeHtml(slice);
    if (segment.type === "code") {
      htmlParts.push(`<code>${escaped}</code>`);
    } else {
      htmlParts.push(escaped);
    }

    if (slice.length < segment.text.length) {
      truncated = true;
      break;
    }
  }

  if (!truncated && consumedChars < normalized.length) {
    truncated = true;
  }

  if (truncated && htmlParts.length > 0) {
    htmlParts.push("...");
  }

  return {
    html: htmlParts.join(""),
    consumedChars,
    truncated
  };
}

function normalizeInlineSource(source: string): string {
  // Inline-only normalization scope: drop inline media artifacts and keep lightweight textual cues.
  return source
    .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
    .replace(/\$([^$\n]+)\$/g, "$1")
    .replace(/\\\((.*?)\\\)/g, "$1")
    .replace(/\\\[(.*?)\\\]/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/==([^=]+)==/g, "$1")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/!\[\[[^\]]+]]/g, " ")
    .replace(/<img\s[^>]*>/gi, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\[\[([^\]#|]+)(?:#[^\]|]+)?(?:\|([^\]]+))?]]/g, (_match: string, link: string, alias: string | undefined) => alias ?? link)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePreviewLineBudget(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_PREVIEW_LINES;
  }

  const rounded = Math.round(value);
  if (rounded < PREVIEW_LINES_MIN) {
    return PREVIEW_LINES_MIN;
  }
  if (rounded > PREVIEW_LINES_MAX) {
    return PREVIEW_LINES_MAX;
  }
  return rounded;
}

function parseInlineSegments(source: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let index = 0;

  while (index < source.length) {
    if (source.startsWith("**", index) || source.startsWith("__", index)) {
      const marker = source.slice(index, index + 2);
      const close = source.indexOf(marker, index + 2);
      if (close > index + 2) {
        segments.push({ type: "strong", text: source.slice(index + 2, close) });
        index = close + 2;
        continue;
      }
    }

    if (source[index] === "*" || source[index] === "_") {
      const marker = source[index];
      const close = source.indexOf(marker, index + 1);
      if (close > index + 1) {
        segments.push({ type: "em", text: source.slice(index + 1, close) });
        index = close + 1;
        continue;
      }
    }

    if (source[index] === "`") {
      const close = source.indexOf("`", index + 1);
      if (close > index + 1) {
        segments.push({ type: "code", text: source.slice(index + 1, close) });
        index = close + 1;
        continue;
      }
    }

    let next = index + 1;
    while (next < source.length && !startsInlineMarker(source, next)) {
      next += 1;
    }
    segments.push({ type: "text", text: source.slice(index, next) });
    index = next;
  }

  return segments;
}

function startsInlineMarker(source: string, index: number): boolean {
  return source.startsWith("**", index) || source.startsWith("__", index) || source[index] === "*" || source[index] === "_" || source[index] === "`";
}

function isFenceClosingLine(line: string, marker: "`" | "~", size: number): boolean {
  const trimmed = line.trim();
  if (trimmed.length < size) {
    return false;
  }

  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] !== marker) {
      return false;
    }
  }
  return true;
}

function clipTextWithLimit(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(0, limit),
    truncated: true
  };
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
