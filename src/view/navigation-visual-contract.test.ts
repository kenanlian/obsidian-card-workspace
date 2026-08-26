import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const styles = fs.readFileSync(path.resolve(testDir, "../../styles.css"), "utf8");

describe("navigation visual contract", () => {
  it("renders the persistent filter as a quiet fixed-slot navigation control", () => {
    expect(styles).toMatch(/\.fce-nav-filter \{[\s\S]*?grid-template-columns: var\(--fce-nav-leading-slot\) minmax\(0, 1fr\) 22px;/);
    expect(styles).toMatch(/\.fce-nav-filter \{[\s\S]*?height: 30px;[\s\S]*?border: 1px solid transparent;/);
    expect(styles).toMatch(/\.fce-nav-filter:focus-within \{\s*border-color: var\(--fce-nav-focus-ring\);/);
    expect(styles).toContain("color: var(--text-faint, var(--fce-text-muted));");
  });

  it("keeps the accepted navigation density with conservatively tightened section rhythm", () => {
    expect(styles).toContain("--fce-nav-row-height: 26px;");
    expect(styles).toContain("--fce-nav-section-height: 26px;");
    expect(styles).toContain("--fce-nav-indent-step: 16px;");
    expect(styles).toContain("margin-block-start: 10px;");
    expect(styles).toContain("margin-block-end: 3px;");
    expect(styles).not.toContain("--fce-nav-row-action-slot");
    expect(styles).not.toContain("--fce-nav-section-action-slot");
    expect(styles).not.toContain("--fce-nav-row-action-track");
    expect(styles).toMatch(/\.fce-tree-item-icon:not\(\.is-static\) \{\s*width: 22px;\s*height: 22px;\s*margin: -3px;/);
  });

  it("separates sections with a hairline painted inside the existing section gap", () => {
    expect(styles).toMatch(
      /--fce-nav-section-divider: color-mix\(\s*in srgb,\s*var\(--background-modifier-border-hover,[\s\S]*?\) 80%,\s*transparent\s*\);/,
    );
    expect(styles).toMatch(
      /\.fce-tree-row\.is-section:not\(:first-child\)::before \{[\s\S]*?position: absolute;[\s\S]*?inset-inline: var\(--fce-nav-section-divider-inset\);[\s\S]*?top: calc\(-1 \* var\(--fce-nav-section-divider-offset\)\);[\s\S]*?height: 1px;[\s\S]*?background: var\(--fce-nav-section-divider\);/,
    );
    expect(styles).toContain("--fce-nav-section-divider-offset: 6px;");
    expect(styles).not.toMatch(/\.fce-tree-row\.is-section \{[^}]*border-block-start:/);
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
    expect(styles).toMatch(/\.fce-tree-item-glyph,\s*\.folder-card-view [^{]*\.fce-tree-item-chevron \{[\s\S]*?grid-area: 1 \/ 1;/);
    expect(styles).toMatch(/\.is-subtree-hovered [^{]*\.fce-tree-item-glyph,[\s\S]*?:focus-visible [^{]*\.fce-tree-item-glyph \{\s*opacity: 0;/);
    expect(styles).toMatch(/\.is-subtree-hovered [^{]*\.fce-tree-item-chevron,[\s\S]*?:focus-visible [^{]*\.fce-tree-item-chevron \{\s*opacity: 1;/);
    expect(styles).toMatch(/\.is-subtree-hovered [^{]*\.fce-tree-item-icon:not\(\.is-static\),[\s\S]*?:focus-visible [^{]*\.fce-tree-item-icon:not\(\.is-static\) \{\s*color: var\(--text-normal\);/);
  });

  it("uses quiet native navigation states without stacked accent borders", () => {
    expect(styles).toContain("--fce-nav-row-selected-bg: var(--fce-nav-row-active-bg);");
    expect(styles).toContain("--fce-nav-checked-bg: var(--fce-nav-row-active-bg);");
    expect(styles).not.toContain("--fce-nav-checked-border");
    expect(styles).not.toContain("--fce-nav-active-file-border");
    expect(styles).not.toMatch(/\.fce-tree-row\.is-checked-filter \{[^}]*box-shadow:/);
    expect(styles).not.toMatch(/\.fce-tree-row\.is-active-file \{[^}]*border-inline-end:/);
  });
});
