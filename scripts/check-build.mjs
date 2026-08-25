import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import {
  createBuildOptions,
  createSvelteCompilerOptions,
} from "./build-options.mjs";

const configOnly = process.argv.includes("--config-only");
const diagnostics = [];
const expectedHostExternals = [
  "obsidian",
  "electron",
  "@codemirror/state",
  "@codemirror/view",
  "@codemirror/language",
];

function assertContract(condition, message) {
  if (!condition) diagnostics.push(message);
}

function arraysEqual(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function checkOptions() {
  const production = createBuildOptions({ production: true });
  const development = createBuildOptions({ production: false });
  const productionSvelte = createSvelteCompilerOptions({ production: true });
  const developmentSvelte = createSvelteCompilerOptions({ production: false });

  assertContract(production.minify === true, "production minify must be true");
  assertContract(production.sourcemap === false, "production sourcemap must be false");
  assertContract(productionSvelte.dev === false, "production Svelte dev must be false");
  assertContract(productionSvelte.css === "injected", "production Svelte CSS mode must be injected");
  assertContract(development.minify === false, "development minify must be false");
  assertContract(development.sourcemap === "inline", "development sourcemap must be inline");
  assertContract(developmentSvelte.dev === true, "development Svelte dev must be true");
  assertContract(developmentSvelte.css === "injected", "development Svelte CSS mode must be injected");

  for (const [name, options] of [["production", production], ["development", development]]) {
    assertContract(options.entryPoints?.length === 1 && options.entryPoints[0] === "src/main.ts", `${name} entry point must be src/main.ts`);
    assertContract(options.bundle === true, `${name} bundle must be true`);
    assertContract(options.outfile === "main.js", `${name} output must be main.js`);
    assertContract(options.format === "cjs", `${name} format must be cjs`);
    assertContract(options.platform === "browser", `${name} platform must be browser`);
    assertContract(options.target === "es2018", `${name} target must be es2018`);
    assertContract(arraysEqual(options.external, expectedHostExternals), `${name} host externals must match the required ordered list`);
    assertContract(options.plugins?.length === 1 && options.plugins[0]?.name === "esbuild-svelte", `${name} must use exactly one Svelte plugin`);
  }
}

async function checkArtifact() {
  try {
    await access("main.js", fsConstants.R_OK);
  } catch {
    diagnostics.push("main.js must exist and be readable");
    return;
  }

  let contents;
  try {
    contents = await readFile("main.js", "utf8");
  } catch {
    diagnostics.push("main.js must be readable as text");
    return;
  }

  assertContract(!/sourceMappingURL\s*=/.test(contents), "main.js must not contain a sourceMappingURL reference");

  try {
    await access("main.js.map", fsConstants.F_OK);
    diagnostics.push("main.js.map must not exist");
  } catch {
    // Expected: production builds must not emit an external sourcemap.
  }
}

checkOptions();
if (!configOnly) await checkArtifact();

if (diagnostics.length > 0) {
  for (const diagnostic of diagnostics) console.error(`[build-check] ${diagnostic}`);
  process.exitCode = 1;
} else {
  console.log(`[build-check] ${configOnly ? "configuration" : "configuration and artifact"} contract passed`);
}
