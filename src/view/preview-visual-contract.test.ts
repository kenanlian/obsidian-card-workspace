import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const styles = fs.readFileSync(path.resolve(testDir, "../../styles.css"), "utf8");

describe("preview visual contract", () => {
  it("rounds the excerpt clipping surface so truncated code keeps its bottom corners", () => {
    expect(styles).toMatch(
      /\.folder-card-view \.fce-excerpt \{[\s\S]*?max-block-size:[\s\S]*?border-radius: var\(--radius-s\);\s*overflow: hidden;/,
    );
    expect(styles).toMatch(
      /\.folder-card-view \.fce-excerpt \.fce-preview-code \{[\s\S]*?border-radius: var\(--radius-s\);/,
    );
  });
});
