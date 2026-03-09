import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      obsidian: path.resolve(__dirname, "src/__mocks__/obsidian.ts"),
      "./FolderCardPanel.svelte": path.resolve(__dirname, "src/__mocks__/FolderCardPanel.svelte.ts"),
    },
  },
});
