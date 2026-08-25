import sveltePlugin from "esbuild-svelte";

export const HOST_EXTERNALS = Object.freeze([
  "obsidian",
  "electron",
  "@codemirror/state",
  "@codemirror/view",
  "@codemirror/language",
]);

export function createSvelteCompilerOptions({ production }) {
  return {
    dev: !production,
    css: "injected",
  };
}

export function createBuildOptions({ production }) {
  return {
    entryPoints: ["src/main.ts"],
    bundle: true,
    outfile: "main.js",
    format: "cjs",
    platform: "browser",
    target: "es2018",
    minify: production,
    sourcemap: production ? false : "inline",
    logLevel: "info",
    external: [...HOST_EXTERNALS],
    plugins: [
      sveltePlugin({
        compilerOptions: createSvelteCompilerOptions({ production }),
      }),
    ],
  };
}
