import { describe, expect, it } from "vitest";
import { buildLightPreview } from "./markdown-utils";
import type { PreviewTextSource } from "./preview-source-collector";

describe("readable preview blocks", () => {
  it.each([
    "| Name | Value |\n| --- | :---: |\n| hidden | data |",
    "Name | Value\n--- | ---:\nhidden | data",
    "| Name |\n| --- |\n| hidden |",
    "| A \\| B | C |\n| --- | --- |\n| hidden | data |",
    "| `A|B` | [[Note|Alias]] |\n| --- | --- |\n| hidden | data |",
    "> | Name | Value |\n> | --- | --- |\n> | hidden | data |",
  ])("skips a complete table without spending the preview budget: %s", (table) => {
    expect(buildLightPreview(`${table}\nReadable body`, 13, 1))
      .toEqual({ html: "<p>Readable body</p>", mode: "text" });
  });

  it("finds tables and resumes prose even without surrounding blank lines", () => {
    expect(buildLightPreview("Before\nA | B\n--- | ---\nx | y\nAfter", 500, 2).html)
      .toBe("<p>Before</p><p>After</p>");
  });

  it("does not swallow a following structural block containing pipes", () => {
    const result = buildLightPreview("A | B\n--- | ---\nx | y\n# Keep | this\n- Also | this", 500, 2);
    expect(result.html).toContain("Keep | this");
    expect(result.html).toContain("Also | this");
    expect(result.html).not.toContain("x | y");
  });

  it.each([
    "left | right",
    "A | B\nnot | a delimiter",
    "A | B\n--- | --- | ---",
    "A \\| B\n--- | ---",
    "`A|B`\n--- | ---",
    "[[Note|Alias]]\n--- | ---",
  ])("retains ordinary pipe text and malformed tables: %s", (markdown) => {
    expect(buildLightPreview(`${markdown}\nAfter`, 500, 5).html).toContain("After");
    expect(buildLightPreview(markdown, 500, 5).mode).toBe("text");
    expect(buildLightPreview(markdown, 500, 5).html).not.toBe("");
  });

  it.each(["mermaid", "dataview", "dataviewjs", "query", "tasks", "base"])("skips %s blocks", (language) => {
    expect(buildLightPreview(`\`\`\`${language}\nhidden source\nmore source\n\`\`\`\nReadable body`, 13, 1))
      .toEqual({ html: "<p>Readable body</p>", mode: "text" });
  });

  it("honors fence marker, size, case and info-string boundaries", () => {
    const markdown = "~~~~MeRmAiD options\nhidden\n~~~\n```\nstill hidden\n~~~~~\nVisible";
    expect(buildLightPreview(markdown, 7, 1).html).toBe("<p>Visible</p>");
    expect(buildLightPreview("```mermaid-example\nordinary code\n```", 500, 2).mode).toBe("code");
  });

  it("keeps all ordinary code literal and preserves following text", () => {
    const code = ["A | B", "--- | ---", "<!-- literal -->", "%% literal %%", "> [!note] literal", "[ref]: literal"];
    const result = buildLightPreview(["```md", ...code, "```", "After"].join("\n"), 500, 7);
    expect(result.html).toContain("A | B\n--- | ---");
    expect(result.html).toContain("&lt;!-- literal --&gt;");
    expect(result.html).toContain("%% literal %%");
    expect(result.html).toContain("&gt; [!note] literal");
    expect(result.html).toContain("[ref]: literal");
    expect(result.html).toContain("<p>After</p>");
  });

  it("does not read fence info strings as comments", () => {
    expect(buildLightPreview("```html <!-- example\ncode\n```\nAfter", 500, 2).html)
      .toBe('<p class="fce-preview-code"><code>code</code></p><p>After</p>');
  });

  it("protects code fences exposed by removing an adjacent comment", () => {
    expect(buildLightPreview("<!-- hidden -->```md\n<!-- literal -->\n```\nAfter", 500, 2).html)
      .toBe('<p class="fce-preview-code"><code>&lt;!-- literal --&gt;</code></p><p>After</p>');
  });

  it.each([
    "<!-- hidden\nmore hidden\n-->",
    "%% hidden\nmore hidden\n%%",
    "<!-- %% still hidden -->\n%% <!-- still hidden %%",
  ])("skips comments without spending the preview budget: %s", (comment) => {
    expect(buildLightPreview(`${comment}\nReadable body`, 13, 1).html).toBe("<p>Readable body</p>");
  });

  it("keeps visible text around multiple inline and multiline comments", () => {
    expect(buildLightPreview("Before<!-- hidden -->after %% hidden %% end", 500, 1).html)
      .toBe("<p>Before after end</p>");
    expect(buildLightPreview("Before <!-- hidden\n# hidden\n--> After", 500, 2).html)
      .toBe("<p>Before</p><p>After</p>");
  });

  it("keeps comment syntax inside inline code visible", () => {
    const result = buildLightPreview("`<!-- literal -->` and `%% literal %%`", 500, 1);
    expect(result.html).toBe("<p><code>&lt;!-- literal --&gt;</code> and <code>%% literal %%</code></p>");
  });

  it("does not hide escaped comment delimiters", () => {
    expect(buildLightPreview("Before \\%% literal \\%% After", 500, 1).html)
      .toBe("<p>Before \\%% literal \\%% After</p>");
  });

  it("removes callout metadata and retains custom titles and body", () => {
    expect(buildLightPreview("> [!note]- **Custom title**\n> Body", 500, 2).html)
      .toBe("<p>Custom title</p><p>Body</p>");
    expect(buildLightPreview(">> [!tip]+\n>> Body\nAfter", 500, 2).html)
      .toBe("<p>Body</p><p>After</p>");
    expect(buildLightPreview("[!note] plain text").html).toBe("<p>[!note] plain text</p>");
  });

  it("skips rendered blocks inside callouts and preserves ordinary quoted code", () => {
    expect(buildLightPreview("> [!note]\n> ```mermaid\n> hidden\n> ```\n> Body", 500, 1).html)
      .toBe("<p>Body</p>");
    expect(buildLightPreview("> ```md\n> <!-- literal -->\n> ```\nAfter", 500, 2).html)
      .toBe('<p class="fce-preview-code"><code>&lt;!-- literal --&gt;</code></p><p>After</p>');
  });

  it.each(["---", "***", "___", "- - -", "* * *", "_ _ _"])("skips the thematic break %s", (divider) => {
    expect(buildLightPreview(`\n${divider}\nReadable body`, 13, 1).html).toBe("<p>Readable body</p>");
  });

  it.each(["---", "==="])("retains Setext heading text for %s", (underline) => {
    expect(buildLightPreview(`Heading\n${underline}\nAfter`, 500, 2).html)
      .toBe('<p class="fce-preview-heading">Heading</p><p>After</p>');
  });

  it("skips definitions and their indented continuations while retaining inline references", () => {
    const markdown = ["[^1]: Hidden footnote", "    continued", "", "    more hidden",
      "[ref]: https://example.com", '  "Hidden title"', "Body [^1] and [link][ref]."].join("\n");
    expect(buildLightPreview(markdown, 500, 1).html).toBe("<p>Body [^1] and [link][ref].</p>");
  });

  it("preserves ordinary text after a definition, including following list items", () => {
    const result = buildLightPreview("Before\n[^1]: Hidden\n    hidden\n- Visible\nAfter", 500, 3);
    expect(result.html).toContain("<p>Before</p>");
    expect(result.html).toContain("Visible");
    expect(result.html).toContain("<p>After</p>");
    expect(result.html).not.toContain("hidden");
    expect(result.html).not.toContain("Hidden");
  });

  it.each([
    "A | B\n--- | ---\nx | y", "```mermaid\nhidden\n```", "<!-- unclosed", "%% unclosed",
    "> [!note]", "***\n___", "[^1]: Hidden\n    continuation", "[ref]: https://example.com",
  ])("uses the existing empty result when nothing is previewable: %s", (markdown) => {
    expect(buildLightPreview(markdown)).toEqual({ html: "", mode: "empty" });
  });

  it("does not scan past the source bound to find text after skipped content", () => {
    const prefix = `${["A | B", "--- | ---", ...Array(398).fill("x | y")].join("\n")}\n`;
    const raw = `${prefix}Forbidden body`;
    const source: PreviewTextSource = { length: raw.length, readCodeUnit(index) {
      if (index >= prefix.length) throw new Error("unbounded preview scan");
      return raw[index];
    } };
    expect(buildLightPreview(source)).toEqual({ html: "", mode: "empty" });
  });

  it("keeps the existing math normalization", () => {
    expect(buildLightPreview("$E=mc^2$ $$a+b$$ \\(x+y\\) \\[z\\]", 500, 1).html)
      .toBe("<p>E=mc^2 a+b x+y z</p>");
  });
});
