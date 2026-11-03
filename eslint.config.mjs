import { defineConfig, globalIgnores } from "eslint/config";
import { fileURLToPath } from "node:url";
import obsidianmd from "eslint-plugin-obsidianmd";

// Follow the public community-scanner configuration, including its severity
// adjustments: https://github.com/obsidianmd/eslint-plugin/blob/master/docs/configuration.md
const securityRules = new Set([
  "no-eval",
  "no-implied-eval",
  "no-unsanitized/method",
  "no-unsanitized/property",
  "obsidianmd/regex-lookbehind",
  "obsidianmd/no-forbidden-elements",
]);

const scannerConfig = obsidianmd.configs.recommended.map((config) => ({
  ...config,
  ...(config.rules ? {
    rules: Object.fromEntries(Object.entries(config.rules).map(([rule, setting]) => {
      const [severity, ...options] = Array.isArray(setting) ? setting : [setting];
      const level = severity === 0 || severity === "off" ? "off"
        : securityRules.has(rule) ? "error" : "warn";
      return [rule, [level, ...options]];
    })),
  } : {}),
}));

export default defineConfig([
  globalIgnores([
    "node_modules/**", "dist/**", "build/**", "pkg/**", "main.js",
    "test-vault/**", ".obsidian/**", "**/.obsidian/**",
    "**/*.test.*", "**/*.tests.*", "**/*.spec.*", "**/*.specs.*",
    "**/test/**", "**/tests/**", "**/__tests__/**",
    "**/mocks/**", "**/__mocks__/**", "**/testUtils**",
    "**/*.cjs", "**/*.mjs", "**/*.cts", "**/*.mts", "**/vite*",
    "**/scripts/**", "**/docs/**",
    "**/i18n/**", "**/i18next/**", "**/locale/**", "**/locales/**",
    "**/translations/**", "**/l10n/**",
    ".pnpm-store/**", "automation/**", "e2e-tests/**",
  ]),
  ...scannerConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.*", "manifest.json"] },
        tsconfigRootDir: fileURLToPath(new URL(".", import.meta.url)),
        extraFileExtensions: [".json"],
      },
    },
  },
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    rules: {
      // These are disabled by the community scanner, which checks manifest
      // metadata separately and avoids noisy or TypeScript-covered rules.
      "no-undef": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "import/no-unresolved": "off",
      "obsidianmd/validate-manifest": "off",
      "obsidianmd/validate-license": "off",
      "obsidianmd/commands/no-command-in-command-id": "off",
      "obsidianmd/commands/no-plugin-id-in-command-id": "off",
    },
  },
]);
