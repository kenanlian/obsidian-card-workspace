# AGENTS.md — Folder Card Explorer (Obsidian Plugin)

## Purpose
An Obsidian plugin that listens for folder clicks in the File Explorer and renders
notes from that folder as a virtualized card stream in the right sidebar.

## Project Governing Principles
- **Performance First**: avoid blocking the main thread; keep UI interactions responsive.
- **Local-first & Privacy**: keep vault processing local; do not add network requests unless
  explicitly approved by a feature spec.
- **Native Feel**: prioritize Obsidian theme variables and native UI class patterns.
- **Modular Design**: separate TypeScript business logic from Svelte presentation and Obsidian
  runtime bindings so logic remains independently testable.

## Tech Stack
- TypeScript (`strict: true`), target ES2020 / ESNext modules
- Svelte 4 (`.svelte` component UI) — **not** Svelte 5
- esbuild + esbuild-svelte (CJS bundle output: `main.js`)
- Vitest for unit tests

## Repository Layout
```text
src/
  main.ts                        # Plugin entry — FolderCardExplorerPlugin (extends Plugin)
  settings.ts                    # PluginSettings interface + DEFAULT_SETTINGS + helpers
  FolderPickerModal.ts           # SuggestModal for picking a folder
  view/
    FolderCardView.ts            # ItemView subclass — card state, hydration, vault mutations
    FolderCardPanel.svelte       # Virtualized card list renderer (Svelte component)
    markdown-utils.ts            # stripMarkdownToText, buildLightPreview helpers
    markdown-utils.test.ts       # Vitest unit tests for markdown-utils
    types.ts                     # Shared interfaces and type aliases
styles.css                       # Global styles (scoped under .folder-card-view)
esbuild.config.mjs               # Build configuration
manifest.json                    # Obsidian plugin manifest
```

## Cursor / Copilot Rule Files
Checked paths:
- `.cursor/rules/` → not found
- `.cursorrules` → not found
- `.github/copilot-instructions.md` → not found

No Cursor/Copilot instruction files are active in this repo.

## Build / Lint / Test Commands

### Install
```shell
npm install
```

### Build & Dev
```shell
npm run dev        # watch mode (esbuild --watch)
npm run build      # production bundle → main.js
npm run check      # TypeScript type-check only (tsc --noEmit)
```

### Tests
```shell
npm test                          # run all tests once (vitest run)
npm run test:watch                # interactive watch mode (vitest)

# run a single test file
npx vitest run src/view/markdown-utils.test.ts

# run a single test case by name
npx vitest run src/view/markdown-utils.test.ts -t "buildLightPreview handles code fences"
```

### Lint / Format Status
- No ESLint configured. Do not add it unless explicitly requested.
- No Prettier configured. Do not add it unless explicitly requested.

## Required Validation Before Completion
After **any** code or docs change, run all three and confirm they pass:
```shell
npm run check
npm run build
npm test
```
If any command fails, the task is incomplete.

## Code Style Guidelines

### Formatting
- 2-space indentation in TS, Svelte, and CSS files.
- Double quotes for all TS/JS string literals.
- Semicolons at the end of every TS/JS statement.
- Trailing commas in multi-line arrays, objects, and function arguments.

### Types
- Strict typing throughout; never use implicit `any`.
- Explicit return types on all exported and public methods
  (e.g. `async onload(): Promise<void>`).
- Prefer `interface` for object shapes; use `type` for unions, intersections, and aliases.
- Use `null` (not `undefined`) for explicit "no value" state in data structures.
- Private class members use the `private` keyword — **not** the `#` prefix.

### Imports
Import order (one logical group per section, no blank lines within a group):
1. Obsidian SDK — all in one destructured statement from `"obsidian"`
2. Local runtime imports (relative paths)
3. Local type-only imports (`import type { ... }`)

```ts
import { ItemView, TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import FolderCardPanel from "./FolderCardPanel.svelte";
import type { NoteCardRecord } from "./types";
```

### Naming
| Construct | Convention |
|---|---|
| Classes, interfaces | `PascalCase` |
| Functions, methods, local variables | `camelCase` |
| Module-level constants | `UPPER_SNAKE_CASE` |
| Class/component files | `PascalCase.ts` / `PascalCase.svelte` |
| Utility/helper files | `kebab-case.ts` |

### Async and Error Handling
- Prefix fire-and-forget async calls with `void` (e.g. `void this.refresh()`).
- Always use `async`/`await` with explicit `Promise<T>` return types.
- Use guard clauses and `instanceof` checks before fallible operations.
- Restrict `try/catch` to true failure boundaries only.
- Parameterless (empty) `catch` blocks are acceptable for non-critical degradation.

### Svelte Guidelines
- Use Svelte 4 syntax: `$:` reactive declarations, `export let` for props.
- Use `createEventDispatcher()` for component-emitted events.
- Do **not** use Svelte 5 runes (`$state`, `$derived`, etc.).

### CSS Guidelines
- Scope all selectors under `.folder-card-view`.
- Prefix all plugin-specific classes with `fce-` (Folder Card Explorer).
- Keep class structure flat and readable; avoid deep nesting.
- Keep styling in plain `styles.css` — no preprocessors.
- Selected state class is `is-selected` (matches Obsidian convention).

## Obsidian Plugin Architecture Notes
- Plugin entry point: `FolderCardExplorerPlugin extends Plugin` in `src/main.ts`.
- Right-side view: `FolderCardView extends ItemView` in `src/view/FolderCardView.ts`.
- Register the view type via `this.registerView(VIEW_TYPE, factory)` in `onload`.
- Use `this.registerEvent(...)` and `this.registerDomEvent(...)` for all event listeners
  to ensure automatic cleanup on plugin unload.
- Read note content via `this.app.vault.cachedRead(file)`.
- Persist settings with `this.loadData()` / `this.saveData(...)`.

## Performance and Behavior Invariants
These patterns are intentional — do not remove or bypass them:
- **Generation-based staleness**: async results carry a generation counter; stale results
  are discarded before they reach the UI.
- **Viewport-driven lazy hydration**: card content (excerpt + cover image) is hydrated only
  when the card enters the visible range (`hydrate-range` logic).
- **Virtualized rendering**: `FolderCardPanel.svelte` uses fixed-height window math with
  an `OVERSCAN` buffer; preserve these assumptions when editing the component.
- **Debounced vault observers**: vault `create`/`modify`/`delete`/`rename` listeners are
  debounced at ~250 ms before triggering a card list refresh.

## Runtime-Provided Externals
Do **not** bundle these as local dependencies — Obsidian provides them at runtime:
`obsidian`, `electron`, `@codemirror/state`, `@codemirror/view`, `@codemirror/language`.
