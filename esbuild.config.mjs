import esbuild from "esbuild";
import sveltePlugin from "esbuild-svelte";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

const buildOptions = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  format: "cjs",
  platform: "browser",
  target: "es2018",
  sourcemap: production ? false : "inline",
  logLevel: "info",
  external: ["obsidian", "electron", "@codemirror/state", "@codemirror/view", "@codemirror/language"],
  plugins: [
    sveltePlugin({
      compilerOptions: {
        dev: !production,
        css: "injected"
      }
    })
  ]
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("[Folder Card Explorer] watch mode started");
} else {
  await esbuild.build(buildOptions);
}

