import { describe, expect, it } from "vitest";
import {
  collectPreviewSource,
  type PreviewTextSource,
} from "./preview-source-collector";

class GuardedPreviewTextSource implements PreviewTextSource {
  readonly length: number;
  readonly touchedIndexes: number[] = [];

  constructor(
    private readonly value: string,
    private readonly forbiddenFrom: number,
  ) {
    this.length = value.length;
  }

  readCodeUnit(index: number): string {
    if (index >= this.forbiddenFrom) {
      throw new Error(`forbidden preview tail access at ${index}`);
    }
    this.touchedIndexes.push(index);
    return this.value[index] ?? "";
  }
}

function lines(count: number, prefix: string): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`);
}

function sourceGuardedAfterPrefix(permitted: string, forbiddenTail: string): GuardedPreviewTextSource {
  return new GuardedPreviewTextSource(permitted + forbiddenTail, permitted.length);
}

describe("collectPreviewSource", () => {
  it("collects no more than 400 ordinary body lines or their code units", () => {
    const permitted = `${lines(400, "body").join("\n")}\n`;
    const source = sourceGuardedAfterPrefix(permitted, `${lines(20, "forbidden").join("\n")}\n`);

    const result = collectPreviewSource(source);

    expect(result.lines).toHaveLength(400);
    expect(result.lines.at(-1)).toBe("body-400");
    expect(result.evidence).toEqual({ inspectedLines: 400, inspectedCodeUnits: permitted.length });
    expect(source.touchedIndexes).toHaveLength(permitted.length);
  });

  it("collects 400 body lines after frontmatter closed on line 400", () => {
    const frontmatter = ["---", ...lines(398, "field"), "---"];
    const body = lines(400, "body");
    const permitted = `${[...frontmatter, ...body].join("\n")}\n`;
    const source = sourceGuardedAfterPrefix(permitted, "forbidden-tail\n");

    const result = collectPreviewSource(source);

    expect(result.frontmatterClosed).toBe(true);
    expect(result.lines).toEqual(body);
    expect(result.evidence).toEqual({ inspectedLines: 800, inspectedCodeUnits: permitted.length });
  });

  it.each([
    ["a close after line 400", ["---", ...lines(399, "field"), "---", "forbidden"]],
    ["unclosed frontmatter", ["---", ...lines(500, "field")]],
  ])("falls back to the first 400 body lines for %s", (_label, allLines) => {
    const permitted = `${allLines.slice(0, 400).join("\n")}\n`;
    const forbiddenTail = `${allLines.slice(400).join("\n")}\n`;
    const source = sourceGuardedAfterPrefix(permitted, forbiddenTail);

    const result = collectPreviewSource(source);

    expect(result.frontmatterClosed).toBe(false);
    expect(result.lines).toEqual(allLines.slice(0, 400));
    expect(result.evidence).toEqual({ inspectedLines: 400, inspectedCodeUnits: permitted.length });
  });

  it("normalizes CRLF only on the lines it collects", () => {
    const collectedLines = lines(400, "windows-body");
    const permitted = `${collectedLines.join("\r\n")}\r\n`;
    const source = sourceGuardedAfterPrefix(permitted, "forbidden\r\ntail\r\n");

    const result = collectPreviewSource(source);

    expect(result.lines).toEqual(collectedLines);
    expect(result.evidence).toEqual({ inspectedLines: 400, inspectedCodeUnits: permitted.length });
  });

  it("does not inspect a multi-megabyte unseen tail", () => {
    const permitted = `${lines(400, "visible").join("\n")}\n`;
    const source = sourceGuardedAfterPrefix(permitted, "x".repeat(2_000_000));

    const result = collectPreviewSource(source);

    expect(result.evidence.inspectedCodeUnits).toBe(permitted.length);
    expect(source.touchedIndexes.at(-1)).toBe(permitted.length - 1);
  });
});
