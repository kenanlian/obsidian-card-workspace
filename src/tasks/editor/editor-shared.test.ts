import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { excludedLines } from "./editor-shared";

function excludedOf(lines: string[], through = lines.length): number[] {
  const test = excludedLines(Text.of(lines), through);
  return lines.map((_, index) => index + 1).filter((line) => test(line));
}

describe("excludedLines", () => {
  it("excludes closed frontmatter only", () => {
    expect(excludedOf(["---", "- [ ] yaml", "---", "- [ ] body"])).toEqual([1, 2, 3]);
    expect(excludedOf(["---", "- [ ] not frontmatter"])).toEqual([]);
    expect(excludedOf(["text", "---", "- [ ] x", "---"])).toEqual([]);
  });

  it("excludes fenced code with matching or longer closers", () => {
    expect(excludedOf(["- [ ] a", "```js", "- [ ] b", "```", "- [ ] c"])).toEqual([2, 3, 4]);
    expect(excludedOf(["~~~~", "```", "- [ ] b", "~~~", "~~~~~", "- [ ] c"])).toEqual([1, 2, 3, 4, 5]);
    expect(excludedOf(["``` a`b", "- [ ] not a fence"])).toEqual([]);
  });

  it("keeps an unclosed fence open to the end and handles quoted or indented fences", () => {
    expect(excludedOf(["- [ ] a", "  ```", "- [ ] b", "- [ ] c"])).toEqual([2, 3, 4]);
    expect(excludedOf(["> ```", "> - [ ] b", "> ```", "- [ ] c"])).toEqual([1, 2, 3]);
  });

  it("excludes display math blocks and single-line math", () => {
    expect(excludedOf(["$$", "- [ ] x", "y $$", "- [ ] z"])).toEqual([1, 2, 3]);
    expect(excludedOf(["$$x$$", "- [ ] z"])).toEqual([1]);
  });

  it("extends a cached scan incrementally with the same result", () => {
    const lines = ["- [ ] a", "```", "- [ ] b", "- [ ] c", "```", "$$", "- [ ] d", "$$", "- [ ] e"];
    const doc = Text.of(lines);
    const partial = excludedLines(doc, 3);
    expect([1, 2, 3, 4].map((line) => partial(line))).toEqual([false, true, true, true]);
    const full = excludedLines(doc, lines.length);
    expect(lines.map((_, index) => full(index + 1))).toEqual([false, true, true, true, true, true, true, true, false]);
  });
});
