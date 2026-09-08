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

function analyzedSource(repoRelativeFile: string, raw: string): string {
  return repoRelativeFile.endsWith(".svelte") ? extractSvelteScripts(raw) : raw;
}

function parseTypeScript(source: string, fileName = "fixture.ts"): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function readImportSpecifiersFromSource(source: string): string[] {
  return ts.preProcessFile(source, true, true).importedFiles.map((file) => file.fileName);
}

function readImportSpecifiers(repoRelativeFile: string): string[] {
  const raw = fs.readFileSync(path.join(repoRoot, repoRelativeFile), "utf8");
  return readImportSpecifiersFromSource(analyzedSource(repoRelativeFile, raw));
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

type RuntimeEdgeKind =
  | "side-effect"
  | "default"
  | "named"
  | "namespace"
  | "value-reexport"
  | "dynamic-literal";

interface RuntimeSourceEdge {
  readonly kind: RuntimeEdgeKind;
  readonly specifier: string;
}

interface RuntimeExtraction {
  readonly edges: readonly RuntimeSourceEdge[];
  readonly nonLiteralDynamic: number;
}

interface RuntimeFileDependencies {
  readonly bare: readonly string[];
  readonly local: readonly string[];
  readonly unresolved: readonly string[];
  readonly nonLiteralDynamic: number;
}

function stringLiteralText(node: ts.Expression | undefined): string | null {
  if (!node) {
    return null;
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return null;
}

function namedBindingsHaveValue(bindings: ts.NamedImportBindings): boolean {
  if (ts.isNamespaceImport(bindings)) {
    return true;
  }
  return bindings.elements.some((element) => !element.isTypeOnly);
}

function namedExportsHaveValue(clause: ts.NamedExports): boolean {
  if (clause.elements.length === 0) {
    return true;
  }
  return clause.elements.some((element) => !element.isTypeOnly);
}

function extractRuntimeDependenciesFromSource(source: string): RuntimeExtraction {
  const sourceFile = parseTypeScript(source);
  const edges: RuntimeSourceEdge[] = [];
  let nonLiteralDynamic = 0;

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const specifier = stringLiteralText(node.moduleSpecifier);
      if (specifier !== null) {
        if (!node.importClause) {
          edges.push({ kind: "side-effect", specifier });
        } else if (!node.importClause.isTypeOnly) {
          if (node.importClause.name) {
            edges.push({ kind: "default", specifier });
          }
          const bindings = node.importClause.namedBindings;
          if (bindings) {
            if (ts.isNamespaceImport(bindings)) {
              edges.push({ kind: "namespace", specifier });
            } else if (namedBindingsHaveValue(bindings)) {
              edges.push({ kind: "named", specifier });
            }
          }
        }
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const specifier = stringLiteralText(node.moduleSpecifier);
      if (specifier !== null && !node.isTypeOnly) {
        const clause = node.exportClause;
        if (!clause || ts.isNamespaceExport(clause) || (ts.isNamedExports(clause) && namedExportsHaveValue(clause))) {
          edges.push({ kind: "value-reexport", specifier });
        }
      }
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = stringLiteralText(node.arguments[0]);
      if (specifier === null) {
        nonLiteralDynamic += 1;
      } else {
        edges.push({ kind: "dynamic-literal", specifier });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { edges, nonLiteralDynamic };
}

function classifyRuntimeEdges(
  fromFile: string,
  extraction: RuntimeExtraction,
  resolve: (fromFile: string, specifier: string) => string | null,
): RuntimeFileDependencies {
  const bare: string[] = [];
  const local: string[] = [];
  const unresolved: string[] = [];
  for (const edge of extraction.edges) {
    if (!edge.specifier.startsWith(".")) {
      bare.push(edge.specifier);
      continue;
    }
    const resolved = resolve(fromFile, edge.specifier);
    if (resolved === null) {
      unresolved.push(edge.specifier);
      continue;
    }
    local.push(resolved);
  }
  return {
    bare: [...new Set(bare)],
    local: [...new Set(local)],
    unresolved: [...new Set(unresolved)],
    nonLiteralDynamic: extraction.nonLiteralDynamic,
  };
}

function collectRuntimeDependencies(): Map<string, RuntimeFileDependencies> {
  const graph = new Map<string, RuntimeFileDependencies>();
  for (const file of listSourceFiles()) {
    const raw = fs.readFileSync(path.join(repoRoot, file), "utf8");
    const extraction = extractRuntimeDependenciesFromSource(analyzedSource(file, raw));
    graph.set(file, classifyRuntimeEdges(file, extraction, resolveLocalSpecifier));
  }
  return graph;
}

const runtimeDependencyGraph = collectRuntimeDependencies();

function resolveVirtualSpecifier(
  fromFile: string,
  specifier: string,
  files: Record<string, string>,
): string | null {
  const fromDir = path.posix.dirname(fromFile);
  const joined = path.posix.normalize(path.posix.join(fromDir, specifier));
  const candidates = [joined, `${joined}.ts`, `${joined}.svelte`, `${joined}/index.ts`];
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(files, candidate)) {
      return candidate;
    }
  }
  return null;
}

function assembleRuntimeGraphFromSources(
  files: Record<string, string>,
): Map<string, RuntimeFileDependencies> {
  const graph = new Map<string, RuntimeFileDependencies>();
  for (const [file, raw] of Object.entries(files)) {
    const extraction = extractRuntimeDependenciesFromSource(analyzedSource(file, raw));
    graph.set(
      file,
      classifyRuntimeEdges(file, extraction, (fromFile, specifier) =>
        resolveVirtualSpecifier(fromFile, specifier, files),
      ),
    );
  }
  return graph;
}

function stronglyConnectedComponents(graph: Map<string, RuntimeFileDependencies>): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const strongconnect = (vertex: string): void => {
    indices.set(vertex, index);
    lowlink.set(vertex, index);
    index += 1;
    stack.push(vertex);
    onStack.add(vertex);

    for (const successor of graph.get(vertex)?.local ?? []) {
      if (!graph.has(successor)) {
        continue;
      }
      if (!indices.has(successor)) {
        strongconnect(successor);
        lowlink.set(vertex, Math.min(lowlink.get(vertex) ?? 0, lowlink.get(successor) ?? 0));
      } else if (onStack.has(successor)) {
        lowlink.set(vertex, Math.min(lowlink.get(vertex) ?? 0, indices.get(successor) ?? 0));
      }
    }

    if (lowlink.get(vertex) === indices.get(vertex)) {
      const component: string[] = [];
      while (stack.length > 0) {
        const member = stack.pop();
        if (member === undefined) {
          break;
        }
        onStack.delete(member);
        component.push(member);
        if (member === vertex) {
          break;
        }
      }
      components.push(component);
    }
  };

  for (const vertex of graph.keys()) {
    if (!indices.has(vertex)) {
      strongconnect(vertex);
    }
  }
  return components;
}

function reconstructCycle(members: string[], graph: Map<string, RuntimeFileDependencies>): string {
  const allowed = new Set(members);
  const start = [...members].sort()[0] ?? members[0];
  if (!start) {
    return "";
  }
  const path: string[] = [];
  const indexOf = new Map<string, number>();
  let found: string[] | null = null;

  const dfs = (node: string): void => {
    if (found) {
      return;
    }
    indexOf.set(node, path.length);
    path.push(node);
    for (const next of graph.get(node)?.local ?? []) {
      if (!allowed.has(next) || found) {
        continue;
      }
      if (indexOf.has(next)) {
        found = [...path.slice(indexOf.get(next)), next];
        return;
      }
      dfs(next);
    }
    path.pop();
    indexOf.delete(node);
  };

  dfs(start);
  return (found ?? [...members, start]).join(" -> ");
}

function readableRuntimeCycles(graph: Map<string, RuntimeFileDependencies>): string[] {
  const cycles: string[] = [];
  for (const [file, deps] of graph) {
    if (deps.local.includes(file)) {
      cycles.push(`${file} -> ${file}`);
    }
  }
  for (const component of stronglyConnectedComponents(graph)) {
    if (component.length < 2) {
      continue;
    }
    cycles.push(reconstructCycle(component, graph));
  }
  return cycles.sort();
}

function reachableFrom(
  roots: readonly string[],
  graph: Map<string, RuntimeFileDependencies>,
): Set<string> {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) {
      continue;
    }
    seen.add(current);
    for (const next of graph.get(current)?.local ?? []) {
      stack.push(next);
    }
  }
  return seen;
}

function edgeKeys(edges: readonly RuntimeSourceEdge[]): string[] {
  return edges.map((edge) => `${edge.kind}:${edge.specifier}`).sort();
}

function isMetadataCacheAccess(node: ts.Expression): boolean {
  if (ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain(node)) {
    return ts.isIdentifier(node.name) && node.name.text === "metadataCache";
  }
  return false;
}

function bindingLocalName(element: ts.BindingElement): { property: string; local: string } | null {
  if (!ts.isIdentifier(element.name)) {
    return null;
  }
  const local = element.name.text;
  if (element.propertyName && ts.isIdentifier(element.propertyName)) {
    return { property: element.propertyName.text, local };
  }
  return { property: local, local };
}

function collectMetadataCacheAliases(sourceFile: ts.SourceFile): Set<string> {
  const aliases = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      if (ts.isIdentifier(node.name) && node.initializer && isMetadataCacheAccess(node.initializer)) {
        aliases.add(node.name.text);
      } else if (
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isIdentifier(node.initializer) &&
        aliases.has(node.initializer.text)
      ) {
        aliases.add(node.name.text);
      } else if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          const names = bindingLocalName(element);
          if (names?.property === "metadataCache") {
            aliases.add(names.local);
          }
        }
      }
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      isMetadataCacheAccess(node.right)
    ) {
      aliases.add(node.left.text);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return aliases;
}

function propertyAccess(node: ts.Expression): { object: ts.Expression; name: string } | null {
  if ((ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain(node)) && ts.isIdentifier(node.name)) {
    return { object: node.expression, name: node.name.text };
  }
  return null;
}

function sourceHasMetadataSubscription(source: string): boolean {
  const sourceFile = parseTypeScript(source);
  const aliases = collectMetadataCacheAliases(sourceFile);
  let found = false;

  const visit = (node: ts.Node): void => {
    if (found) {
      return;
    }
    if (ts.isCallExpression(node)) {
      const access = propertyAccess(node.expression);
      if (access && (access.name === "on" || access.name === "off")) {
        if (isMetadataCacheAccess(access.object)) {
          found = true;
          return;
        }
        if (ts.isIdentifier(access.object) && aliases.has(access.object.text)) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
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

describe("runtime AST extraction", () => {
  const cases: Array<{
    name: string;
    source: string;
    edges: string[];
    allImport: string[];
    nonLiteralDynamic?: number;
  }> = [
    {
      name: "side-effect import",
      source: `import "./dep";\n`,
      edges: ["side-effect:./dep"],
      allImport: ["./dep"],
    },
    {
      name: "default value import",
      source: `import Foo from "./dep";\n`,
      edges: ["default:./dep"],
      allImport: ["./dep"],
    },
    {
      name: "named value import",
      source: `import { foo } from "./dep";\n`,
      edges: ["named:./dep"],
      allImport: ["./dep"],
    },
    {
      name: "namespace value import",
      source: `import * as Foo from "./dep";\n`,
      edges: ["namespace:./dep"],
      allImport: ["./dep"],
    },
    {
      name: "declaration-level import type",
      source: `import type { Foo } from "./dep";\n`,
      edges: [],
      allImport: ["./dep"],
    },
    {
      name: "mixed named { type A, b }",
      source: `import { type A, b } from "./dep";\n`,
      edges: ["named:./dep"],
      allImport: ["./dep"],
    },
    {
      name: "specifier-only type imports",
      source: `import { type A } from "./dep";\n`,
      edges: [],
      allImport: ["./dep"],
    },
    {
      name: "value re-export",
      source: `export { x } from "./dep";\n`,
      edges: ["value-reexport:./dep"],
      allImport: ["./dep"],
    },
    {
      name: "export { type T }",
      source: `export { type T } from "./dep";\n`,
      edges: [],
      allImport: ["./dep"],
    },
    {
      name: "export type",
      source: `export type { T } from "./dep";\n`,
      edges: [],
      allImport: ["./dep"],
    },
    {
      name: "type-position ImportTypeNode",
      source: `type T = import("./dep").T;\n`,
      edges: [],
      allImport: ["./dep"],
    },
    {
      name: "type-position ImportTypeNode after Svelte script extraction",
      source: `<script lang="ts">\ntype T = import("./dep").T;\n</script>\n`,
      edges: [],
      allImport: ["./dep"],
    },
    {
      name: "string-literal dynamic-import call",
      source: `export const mod = import("./dep");\n`,
      edges: ["dynamic-literal:./dep"],
      allImport: ["./dep"],
    },
    {
      name: "unresolved relative import",
      source: `import "./missing";\n`,
      edges: ["side-effect:./missing"],
      allImport: ["./missing"],
    },
    {
      name: "non-literal dynamic-import call",
      source: `export const mod = import(specifier);\n`,
      edges: [],
      allImport: [],
      nonLiteralDynamic: 1,
    },
  ];

  it.each(cases)("$name", ({ source, edges, allImport, nonLiteralDynamic = 0 }) => {
    const analyzed = source.includes("<script") ? extractSvelteScripts(source) : source;
    const extracted = extractRuntimeDependenciesFromSource(analyzed);
    expect(edgeKeys(extracted.edges)).toEqual(edges);
    expect(extracted.nonLiteralDynamic).toBe(nonLiteralDynamic);
    expect(readImportSpecifiersFromSource(analyzed).sort()).toEqual([...allImport].sort());
  });

  it("keeps a type-position edge in the all-import graph but not the runtime graph", () => {
    const source = `
      type T = import("./types").T;
      export const loaded = import("./runtime");
    `;
    const extracted = extractRuntimeDependenciesFromSource(source);
    expect(edgeKeys(extracted.edges)).toEqual(["dynamic-literal:./runtime"]);
    expect(readImportSpecifiersFromSource(source).sort()).toEqual(["./runtime", "./types"]);
  });
});

describe("runtime graph assembly", () => {
  it("forms an SCC through a value re-export edge", () => {
    const graph = assembleRuntimeGraphFromSources({
      "src/a.ts": `export { x } from "./b";\n`,
      "src/b.ts": `export const x = 1;\nexport { y } from "./a";\n`,
    });
    expect(graph.get("src/a.ts")?.local).toEqual(["src/b.ts"]);
    expect(graph.get("src/b.ts")?.local).toEqual(["src/a.ts"]);
    expect(readableRuntimeCycles(graph)).toEqual(["src/a.ts -> src/b.ts -> src/a.ts"]);
  });

  it("detects a plain value import cycle", () => {
    const graph = assembleRuntimeGraphFromSources({
      "src/a.ts": `import { b } from "./b";\nexport const a = b;\n`,
      "src/b.ts": `import { a } from "./a";\nexport const b = a;\n`,
    });
    expect(readableRuntimeCycles(graph)).toEqual(["src/a.ts -> src/b.ts -> src/a.ts"]);
  });

  it("excludes a type-only cycle from the runtime SCC check", () => {
    const graph = assembleRuntimeGraphFromSources({
      "src/a.ts": `import type { B } from "./b";\nexport type A = B;\n`,
      "src/b.ts": `import type { A } from "./a";\nexport type B = A;\n`,
    });
    expect(graph.get("src/a.ts")?.local).toEqual([]);
    expect(graph.get("src/b.ts")?.local).toEqual([]);
    expect(readableRuntimeCycles(graph)).toEqual([]);
    expect(readImportSpecifiersFromSource(`import type { B } from "./b";\n`)).toEqual(["./b"]);
  });

  it("reaches a forbidden file through a dynamic-import edge", () => {
    const graph = assembleRuntimeGraphFromSources({
      "src/view/navigation-host.ts": `export async function load() { return import("./helper"); }\n`,
      "src/view/helper.ts": `import { run } from "./pipeline";\nexport const helper = run;\n`,
      "src/view/pipeline.ts": `export const run = 1;\n`,
    });
    const reachable = reachableFrom(["src/view/navigation-host.ts"], graph);
    expect(reachable.has("src/view/pipeline.ts")).toBe(true);
  });

  it("records a search-to-view runtime edge", () => {
    const graph = assembleRuntimeGraphFromSources({
      "src/search/index.ts": `import { title } from "../view/card";\nexport const search = title;\n`,
      "src/view/card.ts": `export const title = "card";\n`,
    });
    expect(graph.get("src/search/index.ts")?.local).toEqual(["src/view/card.ts"]);
  });

  it("records an unresolved local edge instead of dropping it", () => {
    const graph = assembleRuntimeGraphFromSources({
      "src/a.ts": `import { missing } from "./nope";\n`,
    });
    expect(graph.get("src/a.ts")?.unresolved).toEqual(["./nope"]);
    expect(graph.get("src/a.ts")?.local).toEqual([]);
  });

  it("treats a non-literal dynamic import as an unclassifiable runtime dependency", () => {
    const graph = assembleRuntimeGraphFromSources({
      "src/a.ts": `export const loaded = import(dynamicSpecifier);\n`,
    });
    expect(graph.get("src/a.ts")?.nonLiteralDynamic).toBe(1);
    expect(graph.get("src/a.ts")?.local).toEqual([]);
  });
});

describe("runtime production graph", () => {
  it("resolves every runtime relative import to a real file", () => {
    const dead: string[] = [];
    for (const [file, deps] of runtimeDependencyGraph) {
      for (const specifier of deps.unresolved) {
        dead.push(`${file} -> ${specifier}`);
      }
    }
    expect(dead).toEqual([]);
  });

  it("fails closed on unclassifiable non-literal dynamic imports", () => {
    const violations: string[] = [];
    for (const [file, deps] of runtimeDependencyGraph) {
      if (deps.nonLiteralDynamic > 0) {
        violations.push(`${file}: ${deps.nonLiteralDynamic} non-literal dynamic import(s)`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps dynamic panel loading as a runtime edge and drops Toolbar type-only locals", () => {
    expect(runtimeDependencyGraph.get("src/view/FolderCardView.ts")?.local).toContain(
      "src/view/FolderCardPanel.svelte",
    );
    expect(runtimeDependencyGraph.get("src/view/Toolbar.svelte")?.local).not.toContain("src/view/types.ts");
  });

  it("has no runtime SCC larger than one file and no runtime self-edge", () => {
    expect(readableRuntimeCycles(runtimeDependencyGraph)).toEqual([]);
  });

  it("keeps src/search from depending on src/view at runtime", () => {
    const violations: string[] = [];
    for (const [file, deps] of runtimeDependencyGraph) {
      if (!isUnder(file, "src/search")) {
        continue;
      }
      for (const dependency of deps.local) {
        if (isUnder(dependency, "src/view")) {
          violations.push(`${file} -> ${dependency}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("forbids controller or action imports of FolderCardView, including type-only", () => {
    const violations: string[] = [];
    for (const [file, deps] of dependencyGraph) {
      if (!isUnder(file, "src/view/controllers") && !isUnder(file, "src/view/actions")) {
        continue;
      }
      if (deps.local.includes("src/view/FolderCardView.ts")) {
        violations.push(`${file} -> src/view/FolderCardView.ts`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("R1 search subsystem is only reachable through its public entry points", () => {
  const ALLOWED_SEARCH_ENTRIES = ["src/search/index.ts", "src/search/types.ts"];
  const EXEMPT_FILES = ["src/services/SearchCoordinator.ts"];

  it("keeps SearchCoordinator as the unique direct search-layer exemption", () => {
    expect(EXEMPT_FILES).toEqual(["src/services/SearchCoordinator.ts"]);
  });

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
  const PIPELINE_CONSUMERS = ["src/view/controllers/ProjectionController.ts"];

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

describe("navigation projection is isolated from card search and projection", () => {
  const NAVIGATION_RUNTIME_ROOTS = [
    "src/view/NavigationPane.svelte",
    "src/view/navigation-host.ts",
    "src/view/navigation-projection.ts",
    "src/view/controllers/NavLayoutController.ts",
  ] as const;

  it("keeps the navigation runtime root set closed", () => {
    expect([...NAVIGATION_RUNTIME_ROOTS]).toEqual([
      "src/view/NavigationPane.svelte",
      "src/view/navigation-host.ts",
      "src/view/navigation-projection.ts",
      "src/view/controllers/NavLayoutController.ts",
    ]);
  });

  it("cannot transitively reach pipeline.ts or src/search at runtime", () => {
    for (const root of NAVIGATION_RUNTIME_ROOTS) {
      expect(runtimeDependencyGraph.has(root)).toBe(true);
    }
    const reachable = reachableFrom(NAVIGATION_RUNTIME_ROOTS, runtimeDependencyGraph);
    const violations = [...reachable].filter(
      (file) => file === "src/view/pipeline.ts" || isUnder(file, "src/search"),
    );
    expect(violations).toEqual([]);
  });
});

describe("R6 MetadataCache subscription ownership", () => {
  /**
   * Mirrors the vault-event ownership pattern: `main.ts` registers the Obsidian
   * events and `src/services/MetadataEventBus.ts` owns ordered fan-out to views.
   * Feature code consumes the fanned-out `{ path }` channel and re-reads live
   * cache; it must not hide subscriptions behind aliases of `metadataCache`.
   *
   * Detection is AST-based: direct `*.metadataCache.on/off`, local aliases
   * initialized from `*.metadataCache`, and object-destructured / renamed
   * `metadataCache` bindings before an `.on` / `.off` call. Read-only
   * `getFileCache` / `getAllTags` usage is allowed.
   */
  const METADATA_SUBSCRIPTION_OWNERS = ["src/main.ts", "src/services/MetadataEventBus.ts"];

  it("keeps the metadata subscription owner list closed", () => {
    expect(METADATA_SUBSCRIPTION_OWNERS).toEqual([
      "src/main.ts",
      "src/services/MetadataEventBus.ts",
    ]);
  });

  it("detects direct, aliased, destructured, and renamed-destructured subscriptions", () => {
    expect(sourceHasMetadataSubscription(`app.metadataCache.on("changed", () => {});`)).toBe(true);
    expect(sourceHasMetadataSubscription(`this.app.metadataCache.off("changed", cb);`)).toBe(true);
    expect(
      sourceHasMetadataSubscription(`
        const cache = app.metadataCache;
        cache.on("changed", () => {});
      `),
    ).toBe(true);
    expect(
      sourceHasMetadataSubscription(`
        const { metadataCache } = app;
        metadataCache.on("changed", () => {});
      `),
    ).toBe(true);
    expect(
      sourceHasMetadataSubscription(`
        const { metadataCache: events } = this.app;
        events.off("changed", cb);
      `),
    ).toBe(true);
  });

  it("allows read-only getFileCache and getAllTags through aliases", () => {
    expect(
      sourceHasMetadataSubscription(`
        const cache = app.metadataCache;
        cache.getFileCache(file);
        getAllTags(app.metadataCache, file);
      `),
    ).toBe(false);
  });

  it("allows metadataCache subscription only in owner modules", () => {
    const violations: string[] = [];
    for (const file of dependencyGraph.keys()) {
      if (METADATA_SUBSCRIPTION_OWNERS.includes(file)) {
        continue;
      }
      const raw = fs.readFileSync(path.join(repoRoot, file), "utf8");
      if (sourceHasMetadataSubscription(analyzedSource(file, raw))) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("R5 line-count ratchet", () => {
  /**
   * Explicit caps for files that are still oversized, set to the actual final
   * line count. The ratchet normally only falls: a cap may not be raised to
   * hide inlined behavior. New files stay under the default 400 unless they
   * already needed an explicit cap.
   */
  const LINE_LIMITS: Record<string, number> = {
    "src/view/FolderCardView.ts": 660,
    "src/main.ts": 684,
    "src/services/SearchCoordinator.ts": 572,
    "src/view/controllers/ScopeController.ts": 566,
    "src/view/actions/box-actions.ts": 575,
    "src/search/SearchIndexManager.ts": 1090,
    "src/view/note-ops.ts": 480,
    "src/view/note-tag-ops.ts": 580,
    "src/view/NavigationPane.svelte": 347,
    "src/view/FolderCardPanel.svelte": 832,
    "src/view/Toolbar.svelte": 610,
    "src/view/CardItem.svelte": 438,
    "src/view/nav-context-menu.ts": 535,
    "src/settings.ts": 566,
    "src/services/SettingsStore.ts": 462,
    "src/view/markdown-utils.ts": 432,
    "src/search/IndexStore.ts": 445,
    "src/view/card-boxes.ts": 369,
    "src/view/view-modules.ts": 424,
    "src/view/actions/folder-actions.ts": 418,
    "src/view/controllers/NavLayoutController.ts": 406,
    "src/view/controllers/ProjectionController.ts": 426,
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
