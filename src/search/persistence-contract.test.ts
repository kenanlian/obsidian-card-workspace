import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SearchIndexManager, type SearchIndexDocumentSource } from "./SearchIndexManager";
import type {
  IndexStoreClearResult,
  IndexStoreNamespaceMetadata,
  IndexStoreRestoreResult,
  IndexStoreSerializedPayload,
  IndexStoreWriteResult,
} from "./IndexStore";
import type { SearchableDocument } from "./types";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../..");
const searchRoot = path.join(repoRoot, "src/search");

const ANALYSED_EXTENSIONS = [".ts"];

/**
 * Exact `file:line` call sites that may stringify a small, non-index payload.
 * A whole-file exemption is not allowed (C7). Add a site only with a comment
 * naming why the payload cannot be a MiniSearch snapshot or `toJSON()` derivative.
 */
const ALLOWED_JSON_STRINGIFY_SITES: readonly string[] = [
  // Example: "src/search/IndexStore.ts:123", // build-attempt marker, not a MiniSearch snapshot
];

function toRepoRelative(absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function listSearchSourceFiles(): string[] {
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
  walk(searchRoot);
  return found.sort();
}

function parseTypeScript(source: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function isJsonStringifyCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  const expression = node.expression;
  if (!ts.isPropertyAccessExpression(expression)) {
    return false;
  }
  return (
    ts.isIdentifier(expression.expression)
    && expression.expression.text === "JSON"
    && ts.isIdentifier(expression.name)
    && expression.name.text === "stringify"
  );
}

function collectJsonStringifySites(repoRelativeFile: string): string[] {
  const absolute = path.join(repoRoot, repoRelativeFile);
  const sourceFile = parseTypeScript(fs.readFileSync(absolute, "utf8"), repoRelativeFile);
  const sites: string[] = [];
  const visit = (node: ts.Node): void => {
    if (isJsonStringifyCall(node)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      sites.push(`${repoRelativeFile}:${line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sites;
}

interface FakeStore {
  restore: ReturnType<typeof vi.fn<() => Promise<IndexStoreRestoreResult>>>;
  write: ReturnType<typeof vi.fn<() => Promise<IndexStoreWriteResult>>>;
  clear: ReturnType<typeof vi.fn<() => Promise<IndexStoreClearResult>>>;
  isAvailable: ReturnType<typeof vi.fn<() => boolean>>;
}

function createMetadata(overrides: Partial<IndexStoreNamespaceMetadata> = {}): IndexStoreNamespaceMetadata {
  return {
    vaultNamespace: "vault-a",
    schemaVersion: "schema-v1",
    tokenizerVersion: "tokenizer-v1",
    pluginVersion: "plugin-v1",
    documentCount: 0,
    lastIndexedAt: 0,
    ...overrides,
  };
}

function createDocument(pathValue: string, title = pathValue): SearchableDocument {
  return {
    path: pathValue,
    title,
    normalizedTitle: title.toLowerCase(),
    content: `content for ${title}`,
    excerpt: `excerpt for ${title}`,
    folderPath: pathValue.includes("/") ? pathValue.slice(0, pathValue.lastIndexOf("/")) : "",
    mtime: 10,
    ctime: 5,
  };
}

function createStoreMock(
  result: IndexStoreRestoreResult = {
    outcome: "rebuild-required",
    reason: "missing",
    cleared: false,
    detail: null,
  },
): FakeStore {
  return {
    restore: vi.fn(async () => result),
    write: vi.fn(async () => ({ outcome: "written" })),
    clear: vi.fn(async () => ({ outcome: "cleared" })),
    isAvailable: vi.fn(() => true),
  };
}

function createDocumentSource(initial: SearchableDocument[] = []): {
  source: SearchIndexDocumentSource;
  byPath: Map<string, SearchableDocument>;
  readAllDocuments: ReturnType<typeof vi.fn<() => Promise<SearchableDocument[]>>>;
  readDocument: ReturnType<typeof vi.fn<(path: string) => Promise<SearchableDocument | null>>>;
} {
  const byPath = new Map<string, SearchableDocument>();
  for (const document of initial) {
    byPath.set(document.path, document);
  }

  const readAllDocuments = vi.fn(async () => [...byPath.values()]);
  const readDocument = vi.fn(async (pathValue: string) => byPath.get(pathValue) ?? null);
  const readCatalogSnapshot = vi.fn(() =>
    Object.fromEntries([...byPath.values()].map((document) => [document.path, document.mtime])),
  );

  const streamDocuments = async function* (): AsyncGenerator<SearchableDocument[]> {
    const documents = await readAllDocuments();
    if (documents.length > 0) yield documents;
  };

  return {
    source: {
      streamDocuments,
      readAllDocuments,
      readDocument,
      readCatalogSnapshot,
    },
    byPath,
    readAllDocuments,
    readDocument,
  };
}

beforeEach(() => {
  vi.useRealTimers();
  vi.stubGlobal("window", globalThis);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("search persistence contracts", () => {
  it("finds no JSON.stringify calls in non-test src/search modules", () => {
    const allowed = new Set(ALLOWED_JSON_STRINGIFY_SITES);
    const offenders: string[] = [];
    for (const file of listSearchSourceFiles()) {
      for (const site of collectJsonStringifySites(file)) {
        if (!allowed.has(site)) {
          offenders.push(site);
        }
      }
    }
    expect(offenders, `C7 forbids JSON.stringify of index payloads; offending call sites: ${offenders.join(", ")}`).toEqual([]);
  });

  it("persists serializedIndex as a non-string object", async () => {
    const docs = [createDocument("notes/a.md", "Roadmap")];
    const store = createStoreMock();
    const { source } = createDocumentSource(docs);
    const manager = new SearchIndexManager({
      store,
      documentSource: source,
    });

    await manager.restore(createMetadata());
    await manager.rebuildFromSource("Initial build");

    const writes = store.write.mock.calls as unknown as Array<[IndexStoreNamespaceMetadata, IndexStoreSerializedPayload]>;
    const payload = writes.at(-1)?.[1];
    expect(payload).toBeDefined();
    expect(typeof payload!.serializedIndex).toBe("object");
    expect(payload!.serializedIndex).not.toBeNull();
    expect(typeof payload!.serializedIndex).not.toBe("string");
  });
});
