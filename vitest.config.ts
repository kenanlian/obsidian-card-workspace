import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "path";
import { defineConfig, defineProject } from "vitest/config";

const obsidianAlias = path.resolve(__dirname, "src/__mocks__/obsidian.ts");
const folderCardPanelMockAlias = path.resolve(__dirname, "src/__mocks__/FolderCardPanel.svelte.ts");
const electronAlias = path.resolve(__dirname, "src/__mocks__/electron.ts");

export default defineConfig({
  test: {
    passWithNoTests: true,
    pool: "threads",
    fileParallelism: false,
    projects: [
      defineProject({
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.svelte.test.ts", "src/view/FolderCardView.test.ts"],
        },
        resolve: {
          alias: {
            obsidian: obsidianAlias,
            "./FolderCardPanel.svelte": folderCardPanelMockAlias,
          },
        },
      }),
      defineProject({
        extends: true,
        plugins: [svelte()],
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["src/**/*.svelte.test.ts", "src/view/FolderCardView.test.ts"],
        },
        resolve: {
          conditions: ["browser"],
          alias: {
            obsidian: obsidianAlias,
            electron: electronAlias,
          },
        },
      }),
    ],
  },
});
