import esbuild from "esbuild";
import { createBuildOptions } from "./scripts/build-options.mjs";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

const buildOptions = createBuildOptions({ production });

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("[Card Workspace] watch mode started");
} else {
  await esbuild.build(buildOptions);
}
