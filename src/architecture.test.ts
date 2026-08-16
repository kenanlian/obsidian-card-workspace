import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");
const srcRoot = path.join(repoRoot, "src");

/**
 * Files whose imports are analysed. Tests and mocks are excluded: they legitimately
 * reach across layer boundaries to assemble fixtures.
 */
const ANALYSED_EXTENSIONS = [".ts", ".svelte"];

function toRepoRelative(absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function listSourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__mocks__") {
          continue;
        }
        walk(absolute);
        continue;
      }
      if (!ANALYSED_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
        continue;
      }
      if (entry.name.endsWith(".test.ts")) {
        continue;
      }
      found.push(toRepoRelative(absolute));
    }
  };
  walk(srcRoot);
  return found.sort();
}

const SVELTE_SCRIPT_PATTERN = /<script[^>]*>([\s\S]*?)<\/script>/g;

function extractSvelteScripts(source: string): string {
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  SVELTE_SCRIPT_PATTERN.lastIndex = 0;
  while ((match = SVELTE_SCRIPT_PATTERN.exec(source)) !== null) {
    blocks.push(match[1] ?? "");
  }
  return blocks.join("\n");
}

function readImportSpecifiers(repoRelativeFile: string): string[] {
  const raw = fs.readFileSync(path.join(repoRoot, repoRelativeFile), "utf8");
  const source = repoRelativeFile.endsWith(".svelte") ? extractSvelteScripts(raw) : raw;
  const preprocessed = ts.preProcessFile(source, true, true);
  return preprocessed.importedFiles.map((file) => file.fileName);
}

interface FileDependencies {
  /** Package specifiers such as `obsidian`, `svelte`, `minisearch`. */
  readonly bare: string[];
  /** Repo-relative paths of resolved in-repo dependencies. */
  readonly local: string[];
  /** Relative specifiers that resolved to nothing — dead references. */
  readonly unresolved: string[];
}

function resolveLocalSpecifier(fromFile: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(path.join(repoRoot, fromFile)), specifier);
  const candidates = [base, `${base}.ts`, `${base}.svelte`, path.join(base, "index.ts")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return toRepoRelative(candidate);
    }
  }
  return null;
}

function collectDependencies(): Map<string, FileDependencies> {
  const graph = new Map<string, FileDependencies>();
  for (const file of listSourceFiles()) {
    const bare: string[] = [];
    const local: string[] = [];
    const unresolved: string[] = [];
    for (const specifier of readImportSpecifiers(file)) {
      if (!specifier.startsWith(".")) {
        bare.push(specifier);
        continue;
      }
      const resolved = resolveLocalSpecifier(file, specifier);
      if (resolved === null) {
        unresolved.push(specifier);
        continue;
      }
      local.push(resolved);
    }
    graph.set(file, { bare, local, unresolved });
  }
  return graph;
}

const dependencyGraph = collectDependencies();

function isUnder(file: string, prefix: string): boolean {
  return file === prefix || file.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
}

describe("dependency collection", () => {
  it("resolves every relative import to a real file", () => {
    const dead: string[] = [];
    for (const [file, deps] of dependencyGraph) {
      for (const specifier of deps.unresolved) {
        dead.push(`${file} -> ${specifier}`);
      }
    }
    expect(dead).toEqual([]);
  });

  it("sees dynamic and type-position imports", () => {
    expect(dependencyGraph.get("src/view/FolderCardView.ts")?.local).toContain(
      "src/view/FolderCardPanel.svelte",
    );
    expect(dependencyGraph.get("src/view/Toolbar.svelte")?.local).toContain("src/view/types.ts");
  });
});

describe("R1 search subsystem is only reachable through its public entry points", () => {
  const ALLOWED_SEARCH_ENTRIES = ["src/search/index.ts", "src/search/types.ts"];
  const EXEMPT_FILES: string[] = [];

  it("keeps view and service layers on the public search surface", () => {
    const violations: string[] = [];
    for (const [file, deps] of dependencyGraph) {
      if (!isUnder(file, "src/view") && !isUnder(file, "src/services")) {
        continue;
      }
      if (EXEMPT_FILES.includes(file)) {
        continue;
      }
      for (const dependency of deps.local) {
        if (!isUnder(dependency, "src/search")) {
          continue;
        }
        if (ALLOWED_SEARCH_ENTRIES.includes(dependency)) {
          continue;
        }
        violations.push(`${file} -> ${dependency}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("R2 Svelte components stay inside the presentation layer", () => {
  const FORBIDDEN_EXACT = [
    "src/main.ts",
    "src/view/FolderCardView.ts",
    "src/view/note-ops.ts",
    "src/view/card-boxes.ts",
    "src/view/card-box-membership.ts",
    "src/view/nav-context-menu.ts",
    "src/view/pipeline.ts",
    "src/view/favorites.ts",
    "src/view/metadata-utils.ts",
    "src/view/desktop-shell.ts",
  ];
  const FORBIDDEN_PREFIXES = [
    "src/search",
    "src/services",
    "src/view/modals",
    "src/view/actions",
    "src/view/controllers",
  ];

  /**
   * `tag-tree.ts`, `row-projection.ts` and `scroll-anchoring.ts` are deliberately absent
   * from the lists above: they are zero-import pure helpers that shape data a component
   * already holds, so importing them crosses no layer.
   */
  it("never reaches into host, search, service, or action modules", () => {
    const violations: string[] = [];
    for (const [file, deps] of dependencyGraph) {
      if (!file.endsWith(".svelte")) {
        continue;
      }
      for (const dependency of deps.local) {
        const forbidden =
          FORBIDDEN_EXACT.includes(dependency) ||
          FORBIDDEN_PREFIXES.some((prefix) => isUnder(dependency, prefix));
        if (forbidden) {
          violations.push(`${file} -> ${dependency}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("R3 the visible-card projection has exactly one caller", () => {
  const PIPELINE_CONSUMERS = ["src/view/FolderCardView.ts"];

  it("keeps pipeline.ts behind the single projection owner", () => {
    const consumers: string[] = [];
    for (const [file, deps] of dependencyGraph) {
      if (deps.local.includes("src/view/pipeline.ts")) {
        consumers.push(file);
      }
    }
    expect(consumers.sort()).toEqual([...PIPELINE_CONSUMERS].sort());
  });
});

describe("R4 i18n is a leaf module", () => {
  it("depends on nothing but obsidian and its own domain files", () => {
    const violations: string[] = [];
    for (const [file, deps] of dependencyGraph) {
      if (file !== "src/i18n.ts" && !isUnder(file, "src/i18n")) {
        continue;
      }
      for (const bare of deps.bare) {
        if (bare !== "obsidian") {
          violations.push(`${file} -> ${bare}`);
        }
      }
      for (const dependency of deps.local) {
        if (!isUnder(dependency, "src/i18n")) {
          violations.push(`${file} -> ${dependency}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("R5 line-count ratchet", () => {
  /**
   * Explicit caps for files that are still oversized. The ratchet may only be
   * lowered: every refactor step that shrinks a file must lower its cap to the
   * new real line count.
   */
  const LINE_LIMITS: Record<string, number> = {
    "src/view/FolderCardView.ts": 5663,
    "src/main.ts": 1605,
    "src/i18n.ts": 1439,
    "src/search/SearchIndexManager.ts": 1103,
    "src/view/note-ops.ts": 877,
    "src/view/NavigationPane.svelte": 808,
    "src/view/FolderCardPanel.svelte": 781,
    "src/view/Toolbar.svelte": 732,
    "src/view/CardItem.svelte": 548,
    "src/view/nav-context-menu.ts": 543,
    "src/settings.ts": 521,
    "src/view/markdown-utils.ts": 466,
    "src/search/IndexStore.ts": 446,
    "src/view/card-boxes.ts": 394,
  };
  const DEFAULT_LINE_LIMIT = 400;

  /** Newline count, matching `wc -l` so the table can be refreshed from the shell. */
  function countLines(repoRelativeFile: string): number {
    return fs.readFileSync(path.join(repoRoot, repoRelativeFile), "utf8").split("\n").length - 1;
  }

  it("keeps every source file under its cap", () => {
    const violations: string[] = [];
    for (const file of dependencyGraph.keys()) {
      const limit = LINE_LIMITS[file] ?? DEFAULT_LINE_LIMIT;
      const actual = countLines(file);
      if (actual > limit) {
        violations.push(`${file}: ${actual} > ${limit}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("has no stale entries that could silently raise a cap", () => {
    const stale: string[] = [];
    for (const [file, limit] of Object.entries(LINE_LIMITS)) {
      if (!dependencyGraph.has(file)) {
        stale.push(`${file} (no longer exists)`);
        continue;
      }
      const actual = countLines(file);
      if (actual < limit) {
        stale.push(`${file}: cap ${limit} but file is ${actual} lines — lower the cap`);
      }
    }
    expect(stale).toEqual([]);
  });
});
