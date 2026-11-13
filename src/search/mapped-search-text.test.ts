import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mapMarkdownSearchText } from "./mapped-search-text";

function finish<T>(generator: Generator<unknown, T>): T {
  let step = generator.next();
  while (!step.done) step = generator.next();
  return step.value;
}

describe("mapped search text compatibility", () => {
  it("preserves every mapped field from frozen baseline 0b94e63", () => {
    const fixtures = [
      "", "---\r\nsecret: hidden\r\n---\r\n# 中文😀𠮷\r\n[[dest|alias]] `flow_report`\r\n```ts\r\nx_y\r\n```",
      "a\rb\t c\u00a0d\ufeffe", "[a[b](c) [[[[broken|alias]] ]", "\ud800\udfff x",
      "~~~\n\n a \t b\n~~~\ntrailing", "prefix`code`post `中文` \\(x\\) \\[y\\] $z$",
      "---unterminated\n# still a title", "long **word** [[dest|Alias]] flow_report 😀 中文 \t ".repeat(3000),
    ];
    let seed = 337;
    const next = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const atoms = ["plain", "中文", "😀", "\ud800", "\r", "\n", " ", "\t", "[[a|b]]", "[abc](x)", "![a](x)",
      "`flow_report`", "~~~", "```", "**b**", "__", "==", "$eq$", "\\(x\\)", "[[[[", "/a/b", "---"];
    for (let index = 0; index < 256; index += 1) {
      let source = "";
      for (let part = 0; part < 100; part += 1) source += atoms[Math.floor(next() * atoms.length)];
      fixtures.push(source);
    }
    // Captured by running the identical fixtures through the frozen source.
    // Includes text, UTF-16 offsets, readable mapping, primary length and fences.
    const hash = createHash("sha256");
    for (const fixture of fixtures) hash.update(JSON.stringify(finish(mapMarkdownSearchText(fixture))));
    expect(hash.digest("hex")).toBe("e76c3bdcd52d6cb425418bd2e60f5451a86f560935c100259cd997a8877f7c96");
  });

  it("keeps character checkpoints inside a single long line", () => {
    const generator = mapMarkdownSearchText("a".repeat(100_000));
    let checkpoints = 0;
    let step = generator.next();
    while (!step.done) { checkpoints += 1; step = generator.next(); }
    expect(checkpoints).toBeGreaterThanOrEqual(90);
    expect(step.value.offsets).toHaveLength(100_000);
    expect(step.value.offsets[99_999]).toBe(99_999);
  });
});
