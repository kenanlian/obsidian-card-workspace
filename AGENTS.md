# AGENTS.md — Folder Card Explorer (Obsidian Plugin)
## Purpose
This repo is an Obsidian plugin.
It listens for folder clicks in File Explorer and renders notes from that folder
as a virtualized card stream in the right sidebar.

## Project Governing Principles
- Performance First: avoid blocking the main thread; keep UI interactions responsive.
- Local-first & Privacy: keep vault processing local; do not add network requests unless
  explicitly approved by the feature spec.
- Native Feel: prioritize Obsidian theme variables and native UI class patterns.
- Modular Design: separate TypeScript business logic from Svelte presentation and Obsidian
  runtime bindings so logic remains independently testable.

## Tech Stack
- TypeScript (`strict: true`)
- Svelte 4 (`.svelte` component UI)
- esbuild + esbuild-svelte (bundle output: `main.js`)

## Repository Layout
```text
src/
  main.ts                        # Plugin entry (extends Plugin)
  view/
    FolderCardView.ts            # ItemView + card state + hydration
    FolderCardPanel.svelte       # Virtualized list renderer
    markdown-utils.ts            # Preview/image helper functions
    types.ts                     # Shared interfaces
styles.css                       # Global styles (scoped under .folder-card-view)
esbuild.config.mjs               # Build config
manifest.json                    # Obsidian plugin manifest
```

## Cursor / Copilot Rule Files
Checked paths:
- `.cursor/rules/` -> not found
- `.cursorrules` -> not found
- `.github/copilot-instructions.md` -> not found
No Cursor/Copilot instruction files are currently active in this repo.

## Build / Lint / Test Commands
### Install
```shell
npm install
```
### Build & Dev
```shell
npm run dev      # watch mode
npm run build    # production bundle -> main.js
npm run check    # TypeScript check (tsc --noEmit)
```
### Lint / Format / Test Status
- Lint: no ESLint configured.
- Format: no Prettier configured.
- Tests: Vitest (`npm test` / `npx vitest run`).
Do not add lint/format tooling unless explicitly requested.

### Single-Test Command (Important)
Current state: no test runner, so a true single-test command does not exist.
If a runner is later added (recommended: Vitest), use:
```shell
# run one test file
npx vitest run src/view/markdown-utils.test.ts

# run one test case by name
npx vitest run src/view/markdown-utils.test.ts -t "buildLightPreview handles code fences"
```
Until then, the minimum validation is:
```shell
npm run check
npm run build
npm test
```

## Required Validation Before Completion
After any code or docs change, run all three and ensure they pass:
```shell
npm run check
npm run build
npm test
```
If any command fails, task is incomplete.

## Code Style Guidelines
### Formatting
- Use 2-space indentation in TS/Svelte/CSS.
- Use double quotes in TS/JS string literals.
- End TS/JS statements with semicolons.
- Prefer trailing commas in multi-line arrays/objects/args.

### Types
- Keep strict typing; avoid implicit `any`.
- Add explicit return types for exported/public methods.
- Prefer `interface` for object shapes.
- Use `type` for unions/intersections/type aliases.
- Prefer `null` (not `undefined`) for explicit "no value" state.

### Imports
Use import order:
1. Obsidian SDK imports from `obsidian`
2. Local runtime imports
3. Local type-only imports (`import type`)
Example:
```ts
import { ItemView, TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import FolderCardPanel from "./FolderCardPanel.svelte";
import type { NoteCardRecord } from "./types";
```

### Naming
- Classes/interfaces: `PascalCase`
- Functions/methods/locals: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Class/component files: `PascalCase.ts` / `PascalCase.svelte`
- Utility files: `kebab-case.ts`

### Async and Error Handling
- Prefix fire-and-forget async calls with `void`.
- Use `async`/`await` with explicit `Promise<T>` return types.
- Prefer guard clauses + `instanceof` checks before fallible operations.
- Use `try/catch` only around true failure boundaries.
- Parameterless `catch` is acceptable for non-critical degradation.

### Svelte Guidelines
- Use Svelte 4 syntax (`$:` reactive declarations), not Svelte 5 runes.
- Use `createEventDispatcher()` for component events.
- Declare props with `export let`.

### CSS Guidelines
- Scope selectors under `.folder-card-view`.
- Prefix plugin classes with `fce-`.
- Keep class structure flat and readable.
- Keep styling in plain `styles.css` (no preprocessors).
- Selected state class is `is-selected`.

## Obsidian Plugin Architecture Notes
- Entry point extends `Plugin`; right-side view extends `ItemView`.
- Register view via `registerView(VIEW_TYPE, factory)`.
- Use `registerEvent` and `registerDomEvent` for cleanup-safe listeners.
- Read note content through `this.app.vault.cachedRead(file)`.

## Performance and Behavior Invariants
- Preserve generation-based stale async result checks.
- Preserve viewport-driven lazy hydration (`hydrate-range`).
- Preserve virtualized rendering assumptions (fixed-height window math).
- Keep vault refresh listeners debounced (~250ms).

## Runtime-Provided Externals
Do not treat these as bundled/local runtime deps in plugin code:
`obsidian`, `electron`, `@codemirror/state`, `@codemirror/view`, `@codemirror/language`.
