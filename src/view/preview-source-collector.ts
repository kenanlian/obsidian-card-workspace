export const MAX_PREVIEW_SOURCE_LINES = 400;

export interface PreviewTextSource {
  readonly length: number;
  readCodeUnit(index: number): string;
}

export interface PreviewSourceEvidence {
  inspectedLines: number;
  inspectedCodeUnits: number;
}

export interface CollectedPreviewSource {
  lines: string[];
  evidence: PreviewSourceEvidence;
  frontmatterClosed: boolean;
}

export function createStringPreviewTextSource(value: string): PreviewTextSource {
  return {
    length: value.length,
    readCodeUnit(index: number): string {
      return value[index] ?? "";
    },
  };
}

export function collectPreviewSource(source: PreviewTextSource): CollectedPreviewSource {
  let offset = 0;
  let inspectedLines = 0;
  let inspectedCodeUnits = 0;

  const readLine = (): string | null => {
    if (offset >= source.length) {
      return null;
    }

    const characters: string[] = [];
    while (offset < source.length) {
      const character = source.readCodeUnit(offset);
      offset += 1;
      inspectedCodeUnits += 1;
      if (character === "\n") {
        if (characters.at(-1) === "\r") {
          characters.pop();
        }
        break;
      }
      characters.push(character);
    }
    inspectedLines += 1;
    return characters.join("");
  };

  const firstLine = readLine();
  if (firstLine == null) {
    return {
      lines: [],
      evidence: { inspectedLines, inspectedCodeUnits },
      frontmatterClosed: false,
    };
  }

  if (firstLine !== "---") {
    const lines = [firstLine];
    collectLines(readLine, lines, MAX_PREVIEW_SOURCE_LINES);
    return {
      lines,
      evidence: { inspectedLines, inspectedCodeUnits },
      frontmatterClosed: false,
    };
  }

  const possibleFrontmatter = [firstLine];
  let frontmatterClosed = false;
  while (possibleFrontmatter.length < MAX_PREVIEW_SOURCE_LINES) {
    const line = readLine();
    if (line == null) {
      break;
    }
    possibleFrontmatter.push(line);
    if (line === "---") {
      frontmatterClosed = true;
      break;
    }
  }

  if (!frontmatterClosed) {
    return {
      lines: possibleFrontmatter,
      evidence: { inspectedLines, inspectedCodeUnits },
      frontmatterClosed: false,
    };
  }

  const lines: string[] = [];
  collectLines(readLine, lines, MAX_PREVIEW_SOURCE_LINES);
  return {
    lines,
    evidence: { inspectedLines, inspectedCodeUnits },
    frontmatterClosed: true,
  };
}

function collectLines(
  readLine: () => string | null,
  lines: string[],
  limit: number,
): void {
  while (lines.length < limit) {
    const line = readLine();
    if (line == null) {
      return;
    }
    lines.push(line);
  }
}
