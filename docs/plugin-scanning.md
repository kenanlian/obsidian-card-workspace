# Obsidian source scanning

`npm run lint` runs `eslint-plugin-obsidianmd` against `src` and `package.json`.
Both CI and release validation already run this command. ESLint and the official
plugin are pinned in `package.json` and `package-lock.json`; oxlint is no longer
used.

`eslint.config.mjs` follows the official plugin's
[public community-scanner configuration](https://github.com/obsidianmd/eslint-plugin/blob/master/docs/configuration.md#community-plugin-scanner-configuration).
It loads the complete recommended preset, preserves rule options and disabled
rules, and applies the scanner's severity policy:

- Errors: `no-eval`, `no-implied-eval`, `no-unsanitized/method`,
  `no-unsanitized/property`, `obsidianmd/regex-lookbehind`, and
  `obsidianmd/no-forbidden-elements`.
- Other enabled rules: warnings.
- Rules explicitly skipped by the scanner: disabled, including the noisy
  `@typescript-eslint/no-unsafe-*` checks listed in the public configuration.

The recommended rules also receive the project's mobile-enabled manifest and
minimum Obsidian version. For example, the lookbehind rule remains enabled at
error severity but checks guarded desktop adapters according to the official rule's
own policy.

The scan excludes tests, mocks, scripts, locale modules, build output, and other
paths listed by the public scanner configuration. The plugin bundle `main.js`
is also excluded because source files are scanned directly. Svelte components
continue to be checked with `npm run check:svelte`; this ESLint configuration
does not parse `.svelte` files.

To save a machine-readable report:

```bash
npm run lint -- --format json --output-file /tmp/card-workspace-eslint.json
```

This runs the official ESLint plugin locally. The directory website can use a
different tool version and performs additional checks, including CSS browser
compatibility, manifest validation, and release-artifact checks. A clean local
source report does not replace those checks. Existing build and release checks
remain part of the repository's validation workflow.
