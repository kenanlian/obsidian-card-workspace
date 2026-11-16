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

The Node-only search benchmark lives in `scripts/search-benchmark/`, outside
plugin source scanning and the production bundle. Its sources remain included
in `npm run check`, and its tests run in the node Vitest project. Keep Node-only
tools under `scripts/` rather than adding plugin-source lint exceptions.

To save a machine-readable report:

```bash
npm run lint -- --format json --output-file /tmp/card-workspace-eslint.json
```

This runs the official ESLint plugin locally. The directory website can use a
different tool version and performs additional checks, including CSS browser
compatibility, manifest validation, and release-artifact checks. A clean local
source report does not replace those checks. Existing build and release checks
remain part of the repository's validation workflow.

## Electron IPC warning for independent quick input

The directory scanner may report **Electron IPC** for
`src/input/quick-input-desktop.ts`. This is an expected capability warning for
the desktop quick-input window, retained to preserve independent drafts.

On Obsidian 1.15.1 and later, the host requires a process token as the first
`window.open` feature and rejects requests without it. The adapter obtains that
token through one fixed request, `electron.ipcRenderer.sendSync("popup-token")`,
matching the host's own popup protocol. This request has no payload; the plugin
does not register an IPC handler or accept channel names from user input.

The adapter calls this channel only after its desktop/frame capability checks
and `requireApiVersion("1.15.1")`. Earlier versions use the legacy `popup`
prefix without this request. Missing, throwing or malformed token responses
stop creation before a window is opened. Valid tokens must be nonempty
hexadecimal strings. The adapter also checks the created window's native ID
and hidden, transparent, undecorated constructor options before returning it.
Regression coverage lives in `src/input/quick-input-desktop.test.ts`.

The public workspace popout APIs create workspace leaves and do not expose the
constructor options needed by independent quick input. They are not a replacement
for this protocol. Keeping independent windows therefore retains this IPC
warning; a clean local ESLint report does not mean the warning has been removed.
