import esbuild from "esbuild";
import { readFileSync } from "node:fs";
import sveltePlugin from "esbuild-svelte";

export const PLUGIN_LICENSE_BANNER = `/*!
Card Workspace
Copyright (c) 2026 kenanlian
SPDX-License-Identifier: GPL-3.0-only
Licensed under the GNU General Public License, version 3 only.
Distributed without any warranty; see LICENSE for the complete terms.
License: https://www.gnu.org/licenses/gpl-3.0.html
Source and build instructions: https://github.com/kenanlian/obsidian-card-workspace
See the matching release for its corresponding source archive.

${readFileSync(new URL("../THIRD_PARTY_NOTICES", import.meta.url), "utf8").trim()}
*/`;

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

export function thumbnailWorkerPlugin({ production }) {
  return {
    name: "inline-thumbnail-worker",
    setup(build) {
      build.onResolve({ filter: /thumbnail-worker-source$/ }, () => ({ path: "thumbnail-worker-source", namespace: "thumbnail-worker" }));
      build.onLoad({ filter: /.*/, namespace: "thumbnail-worker" }, async () => {
        const result = await esbuild.build({ entryPoints: ["src/images/thumbnail-worker.ts"], bundle: true,
          write: false, format: "iife", platform: "browser", target: "es2018", minify: production, sourcemap: false });
        return { contents: result.outputFiles[0].text, loader: "text", watchFiles: ["src/images/thumbnail-worker.ts", "src/images/image-header.ts", "src/images/thumbnail-render.ts", "src/images/types.ts"] };
      });
    },
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
    banner: { js: PLUGIN_LICENSE_BANNER },
    logLevel: "info",
    external: [...HOST_EXTERNALS],
    plugins: [
      thumbnailWorkerPlugin({ production }),
      sveltePlugin({
        compilerOptions: createSvelteCompilerOptions({ production }),
      }),
    ],
  };
}
