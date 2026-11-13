export const formattedSource = [
  "# A needle heading", "continued ordinary text", "", "- [ ] Open needle task", "", "2) [x] Done needle task",
  "", "  - [?] Custom needle task", "", "7. Ordered needle item",
  "", "Use `needle_code` with [[Target|needle alias]] and [needle label](https://example.com).",
  "", "```ts", "  const needle = 1;", "    return needle;", "```",
].join("\n");

export const denseSource = Array.from({ length: 12 }, () => "- needle `needle_code` [[Target|needle alias]] [needle label](url)").join("\n\n");

// Independent paragraphs deliberately produce hundreds of merged windows.
// Both browser lifecycle and extraction paging use the production window rules.
export const hundredsSource = Array.from({length: 340}, (_, index) =>
  `Paragraph ${index}: needle context ${"readable words ".repeat(6)}`).join("\n\n");

export function lifecycleFixtures(count = 240) {
  return Array.from({length: count}, (_, index) => ({path: `lifecycle/${index}.md`,
    title: `Note ${index}`, markdown: hundredsSource, mtime: 2, ctime: 1}));
}

export function previewFixtures(kind) {
  return Array.from({ length: 36 }, (_, i) => ({ path: `fixture/${i}.md`, title: `Note ${i}`,
    markdown: Array.from({ length: 320 }, (_, line) => `context ${i} line ${line} ordinary prose`).join("\n")
      + "\n\n" + (kind === "formatted" ? formattedSource : Array.from({ length: 5 }, (_, hit) => `first needle context ${hit}`).join("\n\n")),
    mtime: 2, ctime: 1 }));
}

export const extractionFixtures = [
  ["formatted", formattedSource, "need"],
  ["long-line", "longword".repeat(60000) + " needle", "need"],
  ["malformed-wiki-line", "[".repeat(480000) + "#|alias]] needle", "need"],
  ["term-budget", "word ".repeat(49998) + "needle", "need"],
  ["han-run", "中".repeat(100000) + "中文", "中"],
  ["fenced-separators", "```js\n" + "long_word ".repeat(49000) + "needle\n```", "need"],
  ["dense-format", Array.from({ length: 8000 }, () => "- needle `code` [[Target|alias]]\n").join(""), "need"],
];
