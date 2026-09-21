import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for the search persistence contract.
 *
 * Card Workspace 1.2.3 locked Obsidian because the whole-vault MiniSearch
 * snapshot was `JSON.stringify`-ed synchronously (a main-thread block that can
 * also exceed the engine's maximum string length). Since 1.2.5 the persisted
 * index is a structured-clone object. These checks fail if anyone reintroduces
 * a whole-index stringify anywhere on the production persist path.
 *
 * The benchmark's labeled diagnostic stringify lives in `src/benchmark/` and
 * is deliberately outside the scanned production set.
 */

const searchDirectory = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

async function readProductionSearchSources(): Promise<Array<{ file: string; source: string }>> {
  const entries = await readdir(searchDirectory);
  const productionFiles = entries.filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"));
  const sources: Array<{ file: string; source: string }> = [];
  for (const entry of productionFiles) {
    sources.push({ file: `src/search/${entry}`, source: await readFile(join(searchDirectory, entry), "utf8") });
  }
  for (const servicesFile of ["SearchCoordinator.ts", "SearchDocumentSource.ts"]) {
    sources.push({
      file: `src/services/${servicesFile}`,
      source: await readFile(join(repositoryRoot, "src/services", servicesFile), "utf8"),
    });
  }
  return sources;
}

describe("production search persistence", () => {
  it("never JSON.stringifies on the search persist path", async () => {
    const sources = await readProductionSearchSources();
    expect(sources.length).toBeGreaterThanOrEqual(8);

    for (const { file, source } of sources) {
      expect(
        source,
        `${file} must not JSON.stringify on the production search path; persist uses structured-clone objects (benchmark-only stringify lives in src/benchmark/)`,
      ).not.toMatch(/JSON\.stringify/);
    }
  });

  it("persists the MiniSearch snapshot as a structured-clone object payload", async () => {
    const managerSource = await readFile(join(searchDirectory, "SearchIndexManager.ts"), "utf8");
    // The persist payload must keep `serializedIndex` as the toJSON() object,
    // never a JSON string of it.
    expect(managerSource).toMatch(/serializedIndex:\s*index\.toJSON\(\)/);

    const storeSource = await readFile(join(searchDirectory, "IndexStore.ts"), "utf8");
    expect(storeSource).toMatch(/IndexStoreSerializedIndex = Record<string, unknown>/);
  });
});
