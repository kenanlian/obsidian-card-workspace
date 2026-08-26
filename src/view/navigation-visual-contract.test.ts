import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const styles = fs.readFileSync(path.resolve(testDir, "../../styles.css"), "utf8");

describe("navigation visual contract", () => {
  it("keeps the accepted legacy rhythm tokens without fixed wide action tracks", () => {
    expect(styles).toContain("--fce-nav-row-height: 26px;");
    expect(styles).toContain("--fce-nav-section-height: 26px;");
    expect(styles).toContain("--fce-nav-indent-step: 16px;");
    expect(styles).toContain("margin-block-start: 12px;");
    expect(styles).toContain("margin-block-end: 4px;");
    expect(styles).not.toContain("--fce-nav-row-action-slot");
    expect(styles).not.toContain("--fce-nav-section-action-slot");
    expect(styles).not.toContain("--fce-nav-row-action-track");
    expect(styles).toMatch(/\.fce-tree-item-icon:not\(\.is-static\) \{\s*width: 22px;\s*height: 22px;\s*margin: -3px;/);
  });

  it("stacks summary and actions in the same trailing area and swaps them on interaction", () => {
    expect(styles).toMatch(
      /\.fce-nav-row-summary,\s*\.folder-card-view \.fce-nav-tree \.fce-nav-row-actions \{\s*grid-area: 1 \/ 1;/,
    );
    expect(styles).toMatch(/\.fce-nav-row-trailing \{[\s\S]*?width: auto;[\s\S]*?justify-items: end;/);
    expect(styles).toMatch(
      /\.fce-tree-row:hover \.fce-nav-row-actions,[\s\S]*?\.fce-tree-row:focus-within \.fce-nav-row-actions \{\s*visibility: visible;/,
    );
    expect(styles).toMatch(
      /\.fce-tree-row:hover \.fce-nav-row-trailing\.has-actions \.fce-nav-row-summary,[\s\S]*?\.fce-tree-row:focus-within \.fce-nav-row-trailing\.has-actions \.fce-nav-row-summary \{\s*visibility: hidden;/,
    );
  });

  it("uses subtree hover and keyboard focus to swap identity glyphs for chevrons", () => {
    expect(styles).toMatch(/\.is-subtree-hovered [^{]*\.fce-tree-item-glyph,[\s\S]*?:focus-visible [^{]*\.fce-tree-item-glyph \{\s*display: none;/);
    expect(styles).toMatch(/\.is-subtree-hovered [^{]*\.fce-tree-item-chevron,[\s\S]*?:focus-visible [^{]*\.fce-tree-item-chevron \{\s*display: flex;/);
  });
});
