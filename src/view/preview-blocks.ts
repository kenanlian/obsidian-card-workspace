interface PreviewSourceLine {
  text: string;
  quoteDepth: number;
  fenced: boolean;
}

interface PreviewFence {
  marker: string;
  size: number;
  quoteDepth: number;
  skip: boolean;
}

// Known rendered/query blocks only. Unknown languages remain ordinary code.
const NON_TEXT_FENCES = new Set(["mermaid", "dataview", "dataviewjs", "query", "tasks", "base"]);

/** Normalize only the already bounded preview source; never inspect the unseen tail. */
export function normalizePreviewBlocks(source: string[]): string[] {
  const lines = preparePreviewLines(source);
  const output = lines.map((line) => line.text.length === 0 ? ""
    : line.fenced || line.quoteDepth === 0 ? line.text : `> ${line.text}`);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.fenced || !line.text.trim()) continue;

    if (isTableStart(lines, index)) {
      output[index] = output[index + 1] = "";
      index += 2;
      while (index < lines.length && !lines[index].fenced
        && lines[index].quoteDepth === line.quoteDepth
        && !isStructuralLine(lines[index].text.trim())
        && splitTableCells(lines[index].text) !== null) {
        output[index] = "";
        index += 1;
      }
      index -= 1;
      continue;
    }

    if (isDefinition(line.text)) {
      output[index] = "";
      const footnote = /^ {0,3}\[\^/.test(line.text);
      let cursor = index + 1;
      while (cursor < lines.length) {
        let next = cursor;
        while (next < lines.length && !lines[next].fenced && !lines[next].text.trim()) next += 1;
        if (next >= lines.length || lines[next].fenced || lines[next].quoteDepth !== line.quoteDepth
          || !isDefinitionContinuation(lines[next].text, footnote)) break;
        for (; cursor <= next; cursor += 1) output[cursor] = "";
      }
      index = cursor - 1;
      continue;
    }

    // A Setext underline belongs to the preceding text, rather than being a divider.
    const next = lines[index + 1];
    if (!isStructuralLine(line.text.trim()) && next && !next.fenced
      && next.quoteDepth === line.quoteDepth && /^\s*(?:=+|-+)\s*$/.test(next.text)) {
      output[index] = line.quoteDepth ? `> ${line.text.trim()}` : `# ${line.text.trim()}`;
      output[index + 1] = "";
      index += 1;
      continue;
    }

    if (isThematicBreak(line.text.trim())) output[index] = "";
  }
  return output;
}

function preparePreviewLines(source: string[]): PreviewSourceLine[] {
  let fence: PreviewFence | null = null;
  let commentEnd: string | null = null;

  return source.map((raw): PreviewSourceLine => {
    if (fence) {
      const text = stripQuotePrefix(raw, fence.quoteDepth).text;
      const result = { text: fence.skip ? "" : text, quoteDepth: 0, fenced: true };
      const trimmed = text.trim();
      if (isFenceEnd(trimmed, fence)) {
        fence = null;
      }
      return result;
    }

    const quoted = stripQuotePrefix(raw);
    // Read fence info before looking for comments in its literal info string.
    const opening = commentEnd ? null : readPreviewFence(quoted.text, quoted.quoteDepth);
    if (opening) {
      fence = opening;
      return { text: fence.skip ? "" : quoted.text, quoteDepth: 0, fenced: true };
    }

    if (!commentEnd && !quoted.text.includes("<!--") && !quoted.text.includes("%%")) {
      return prepareTextLine(quoted.text, quoted.quoteDepth);
    }

    const parts: string[] = [];
    let index = 0;
    while (index < quoted.text.length) {
      if (commentEnd) {
        const end = quoted.text.indexOf(commentEnd, index);
        if (end < 0) break;
        index = end + commentEnd.length;
        commentEnd = null;
        parts.push(" ");
        continue;
      }
      if (quoted.text[index] === "\\") {
        parts.push(quoted.text.slice(index, index + 2));
        index += 2;
        continue;
      }
      if (quoted.text.startsWith("<!--", index) || quoted.text.startsWith("%%", index)) {
        const html = quoted.text.startsWith("<!--", index);
        commentEnd = html ? "-->" : "%%";
        index += html ? 4 : 2;
        parts.push(" ");
        continue;
      }
      // Comment-looking text in a code span is literal, including multi-backtick spans.
      if (quoted.text[index] === "`") {
        let end = index + 1;
        while (quoted.text[end] === "`") end += 1;
        const marker = quoted.text.slice(index, end);
        const close = quoted.text.indexOf(marker, end);
        if (close >= 0) {
          parts.push(quoted.text.slice(index, close + marker.length));
          index = close + marker.length;
          continue;
        }
      }
      parts.push(quoted.text[index]);
      index += 1;
    }

    const text = parts.join("");
    fence = commentEnd ? null : readPreviewFence(text, quoted.quoteDepth);
    if (fence) return { text: fence.skip ? "" : text, quoteDepth: 0, fenced: true };
    return prepareTextLine(text, quoted.quoteDepth);
  });
}

function readPreviewFence(text: string, quoteDepth: number): PreviewFence | null {
  const opening = text.trim().match(/^(`{3,}|~{3,})(.*)$/);
  if (!opening) return null;
  const language = opening[2].trim().split(/\s+/)[0].toLowerCase();
  return { marker: opening[1][0], size: opening[1].length,
    quoteDepth, skip: NON_TEXT_FENCES.has(language) };
}

function prepareTextLine(text: string, quoteDepth: number): PreviewSourceLine {
  if (quoteDepth > 0) text = text.replace(/^\s*\[![^\]\s]+\][+-]?(?:[ \t]+|$)/, "");
  return { text, quoteDepth, fenced: false };
}

function isFenceEnd(line: string, fence: PreviewFence): boolean {
  if (line.length < fence.size) return false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== fence.marker) return false;
  }
  return true;
}

function stripQuotePrefix(line: string, limit = Infinity): { text: string; quoteDepth: number } {
  let text = line;
  let quoteDepth = 0;
  while (quoteDepth < limit) {
    const match = text.match(/^[ \t]*>[ \t]?/);
    if (!match) break;
    text = text.slice(match[0].length);
    quoteDepth += 1;
  }
  return { text, quoteDepth };
}

function isThematicBreak(line: string): boolean {
  return /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line);
}

function isDefinition(line: string): boolean {
  return /^ {0,3}\[(?![[!])[^\]]+\]:/.test(line);
}

function isDefinitionContinuation(line: string, footnote: boolean): boolean {
  return /^(?: {4}|\t)/.test(line) || (!footnote && /^[ \t]+["'(]/.test(line));
}

function isStructuralLine(line: string): boolean {
  return !line || isThematicBreak(line) || isDefinition(line)
    || /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|`{3,}|~{3,}|!\[)/.test(line);
}

function isTableStart(lines: PreviewSourceLine[], index: number): boolean {
  const header = lines[index];
  const delimiter = lines[index + 1];
  if (!delimiter || delimiter.fenced || header.quoteDepth !== delimiter.quoteDepth
    || !/^[\s|:-]+$/.test(delimiter.text) || isStructuralLine(header.text.trim())) return false;
  const headerCells = splitTableCells(header.text);
  const delimiterCells = splitTableCells(delimiter.text);
  return headerCells !== null && delimiterCells !== null && headerCells.length === delimiterCells.length
    && delimiterCells.every((cell) => /^:?-+:?$/.test(cell.trim()));
}

/** Escaped pipes, code spans and wiki-link aliases are not column separators. */
function splitTableCells(line: string): string[] | null {
  const cells: string[] = [];
  let start = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "\\") {
      index += 1;
    } else if (line[index] === "`") {
      let end = index + 1;
      while (line[end] === "`") end += 1;
      const marker = line.slice(index, end);
      const close = line.indexOf(marker, end);
      if (close >= 0) index = close + marker.length - 1;
    } else if (line.startsWith("[[", index)) {
      const close = line.indexOf("]]", index + 2);
      if (close >= 0) index = close + 1;
    } else if (line[index] === "|") {
      cells.push(line.slice(start, index));
      start = index + 1;
    }
  }
  if (cells.length === 0) return null;
  cells.push(line.slice(start));
  if (!cells[0].trim()) cells.shift();
  if (cells.length && !cells[cells.length - 1].trim()) cells.pop();
  return cells.length ? cells : null;
}
