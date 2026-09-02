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
    expect(styles).toContain("--fce-nav-row-height: 30px;");
    expect(styles).toContain("--fce-nav-section-height: 30px;");
    expect(styles).toContain("--fce-nav-indent-step: 12px;");
    expect(styles).toContain("margin-block-start: 10px;");
    expect(styles).toContain("margin-block-end: 3px;");
    expect(styles).not.toContain("--fce-nav-row-action-slot");
    expect(styles).not.toContain("--fce-nav-section-action-slot");
    expect(styles).not.toContain("--fce-nav-row-action-track");
    expect(styles).toMatch(
      /button\.fce-tree-item-disclosure::before \{[\s\S]*?inset-block: calc\(\(var\(--fce-nav-row-height\) - var\(--fce-nav-disclosure-target\)\) \/ -2\);/,
    );
  });

  it("separates sections with a hairline painted inside the existing section gap", () => {
    expect(styles).toMatch(
      /--fce-nav-section-divider: color-mix\(\s*in srgb,\s*var\(--background-modifier-border-hover,[\s\S]*?\) 35%,\s*transparent\s*\);/,
    );
    expect(styles).toMatch(
      /\.fce-tree-row\.is-section::before \{[\s\S]*?position: absolute;[\s\S]*?inset-inline: var\(--fce-nav-section-divider-inset\);[\s\S]*?top: calc\(-1 \* var\(--fce-nav-section-divider-offset\)\);[\s\S]*?height: 1px;[\s\S]*?background: var\(--fce-nav-section-divider\);/,
    );
    expect(styles).toContain("--fce-nav-section-divider-offset: 6px;");
    expect(styles).not.toMatch(/\.fce-tree-row\.is-section \{[^}]*border-block-start:/);
    expect(styles).not.toContain(".fce-tree-row.is-section:not(:first-child)::before");
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

  it("renders a two-column leading track with a permanent chevron and a state-invariant identity glyph", () => {
    expect(styles).toContain("--fce-nav-disclosure-slot: 12px;");
    expect(styles).toContain("--fce-nav-disclosure-gap: 6px;");
    expect(styles).toMatch(
      /--fce-nav-leading-track: calc\(var\(--fce-nav-disclosure-slot\) \+ var\(--fce-nav-disclosure-gap\) \+ var\(--fce-nav-leading-slot\)\);/,
    );
    expect(styles).toContain("--fce-nav-leading-slot: var(--icon-size, 16px);");
    expect(styles).toMatch(
      /\.fce-tree-row \{[\s\S]*?grid-template-columns: max-content minmax\(0, 1fr\) max-content;/,
    );
    expect(styles).toMatch(
      /\.fce-popup-row-leading \{[\s\S]*?gap: var\(--fce-nav-disclosure-gap\);[\s\S]*?width: max-content;/,
    );
    expect(styles).toContain("--fce-nav-disclosure-target: 16px;");
    expect(styles).toMatch(
      /\.fce-tree-item-disclosure \{[\s\S]*?width: var\(--fce-nav-disclosure-target\);\s*height: var\(--fce-nav-disclosure-target\);/,
    );
    expect(styles).toContain("--fce-nav-disclosure-nudge: 2px;");
    expect(styles).toMatch(
      /\.fce-tree-item-disclosure \{[\s\S]*?margin-inline-start: calc\(\s*\(var\(--fce-nav-disclosure-slot\) - var\(--fce-nav-disclosure-target\)\) \/ 2 - var\(--fce-nav-disclosure-nudge\)\s*\);/,
    );
    expect(styles).toMatch(
      /\.fce-tree-item-disclosure \{[\s\S]*?margin-inline-end: calc\(\s*\(var\(--fce-nav-disclosure-slot\) - var\(--fce-nav-disclosure-target\)\) \/ 2 \+ var\(--fce-nav-disclosure-nudge\)\s*\);/,
    );
    expect(styles).toMatch(
      /\.fce-tree-item-chevron \{[\s\S]*?width: var\(--fce-nav-disclosure-slot\);[\s\S]*?height: var\(--fce-nav-disclosure-slot\);/,
    );
    expect(styles).toMatch(
      /\.fce-tree-item-identity \{[\s\S]*?width: var\(--fce-nav-leading-slot\);[\s\S]*?pointer-events: none;/,
    );
    expect(styles).not.toMatch(/\.fce-tree-item-chevron \{[^}]*opacity:/);
    expect(styles).not.toContain("fce-tree-item-glyph");
    expect(styles).not.toMatch(/\.is-subtree-hovered[^{]*\.fce-tree-item-/);
    expect(styles).toMatch(
      /\.is-subtree-hovered \{\s*background: color-mix\(in srgb, var\(--fce-nav-row-hover\) 40%, transparent\);/,
    );
    expect(styles).toMatch(/\.is-synthetic \.fce-tree-label \{\s*color: var\(--text-faint,/);
  });

  it("indents empty-section copy with the section label, not the item leading track", () => {
    expect(styles).toMatch(
      /\.fce-nav-no-results,\s*\.folder-card-view \.fce-nav-section-empty \{[\s\S]*?padding-inline: calc\(4px \+ var\(--fce-nav-disclosure-slot\) \+ var\(--fce-nav-label-gap\)\) 8px;/,
    );
    expect(styles).not.toMatch(
      /\.fce-nav-section-empty \{[\s\S]*?--fce-nav-leading-track/,
    );
  });

  it("uses quiet native navigation states without stacked accent borders", () => {
    expect(styles).toContain("--fce-nav-row-selected-bg: var(--fce-nav-row-active-bg);");
    expect(styles).toContain("--fce-nav-checked-bg: var(--fce-nav-row-active-bg);");
    expect(styles).not.toContain("--fce-nav-checked-border");
    expect(styles).not.toContain("--fce-nav-active-file-border");
    expect(styles).not.toMatch(/\.fce-tree-row\.is-checked-filter \{[^}]*box-shadow:/);
    expect(styles).not.toMatch(/\.fce-tree-row\.is-active-file \{[^}]*border-inline-end:/);
  });

  it("keeps property rows inside the single scroller and tree without new slots", () => {
    // One nav scroller and one tree; property rows join the existing structure
    // rather than adding a second scroll surface or ARIA tree.
    expect(styles.match(/\.folder-card-view \.fce-nav-pane-sections \{/g)).toHaveLength(1);
    expect(styles.match(/\.folder-card-view \.fce-nav-tree \{/g)).toHaveLength(1);
    expect(styles).toMatch(/\.folder-card-view \.fce-nav-pane-sections \{[\s\S]*?overflow-y: auto;/);
    // Row density and indentation are shared: value rows at level 3 reuse the
    // same 30px row height and 12px indent step as every other row variant.
    expect(styles).toContain("--fce-nav-row-height: 30px;");
    expect(styles).toContain("--fce-nav-indent-step: 12px;");
    // No property-only action slot or second tree/scroller token is introduced;
    // the actions snippet contributes only the shared section action + more slot.
    expect(styles).not.toContain("--fce-nav-property-action-slot");
    expect(styles).not.toContain(".fce-nav-property-tree");
    expect(styles).not.toContain(".fce-nav-property-scroller");
    // The active property count reuses the tag summary style, and the property
    // check indicator shares the quiet checked color with folder/tag/favorites.
    expect(styles).toMatch(/\.fce-nav-active-tag-count,\s*\.folder-card-view \.fce-nav-active-property-count \{/);
    expect(styles).toMatch(/\.fce-property-menu \.fce-tree-row-check,/);
  });
});
