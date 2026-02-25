# AGENTS.md — Folder Card Explorer (Obsidian Plugin)

## Project Overview

An Obsidian plugin that renders notes from a clicked folder as a card stream
in the right sidebar. Built with TypeScript (strict) and Svelte 4, bundled
via esbuild.

## Repository Layout

```
src/
  main.ts                        # Plugin entry point (FolderCardExplorerPlugin)
  view/
    FolderCardView.ts            # ItemView subclass — card state & lazy hydration
    FolderCardPanel.svelte       # Svelte 4 component — virtualized card list
    markdown-utils.ts            # Pure functions: markdown stripping, image extraction
    types.ts                     # Shared interfaces (NoteCardRecord)
styles.css                       # Global CSS (warm retro-paper palette)
esbuild.config.mjs               # Build config — CJS output to main.js
manifest.json                    # Obsidian plugin manifest
```

## Shell / Terminal Requirements

**Always use PowerShell (`pwsh`) for all commands** — this is a Windows environment.
Do NOT use bash, sh, cmd, or Unix-style commands.

```powershell
# Correct — PowerShell syntax
pwsh -Command "npm run build"

# Or directly in a pwsh session
npm run build
Get-Content .\package.json
```

- Use `Get-Content` instead of `cat`
- Use `Get-ChildItem` / `ls` instead of `ls -la`
- Use `Remove-Item` instead of `rm -rf`
- Use `Copy-Item` instead of `cp`
- Use `$env:VAR` instead of `$VAR` or `export VAR=`
- Path separators: use `\` or PowerShell's `/` (both work in pwsh)

## Build / Check Commands

```powershell
npm install                # Install dependencies
npm run build              # Production build (esbuild, outputs main.js)
npm run dev                # Watch mode with live rebuild
npm run check              # TypeScript type-check only (tsc --noEmit)
```

### After Every Change

Run **both** of these and fix any errors before considering the task done:

```powershell
npm run check              # Must pass with zero errors
npm run build              # Must complete without build failures
```

### Testing

There is **no test framework** configured. No test runner, no test files.
If you add tests, use a framework compatible with esbuild (e.g., vitest).

### Linting / Formatting

There is **no ESLint or Prettier** configured. Follow the conventions below
manually. Do not add linter/formatter config unless explicitly asked.

## TypeScript Conventions

### Strict Mode

`tsconfig.json` has `"strict": true`. All code must satisfy strict checking:
- No implicit `any`
- Strict null checks enabled
- Strict function types

### Types & Interfaces

- Use `interface` for object shapes, `type` for unions/intersections/aliases.
- Use `type` imports (`import type { ... }`) for type-only imports.
- Use `null` (not `undefined`) for "no value" in data structures.
- Provide explicit return types on all exported/public methods:
  ```ts
  async onload(): Promise<void> { ... }
  getViewType(): string { ... }
  ```

### Naming

| Kind                  | Convention       | Example                       |
|-----------------------|------------------|-------------------------------|
| Classes               | PascalCase       | `FolderCardView`              |
| Interfaces            | PascalCase       | `NoteCardRecord`              |
| Methods / functions   | camelCase        | `stripMarkdownToText`         |
| Local variables       | camelCase        | `buildGeneration`             |
| Module-level constants| UPPER_SNAKE_CASE | `FOLDER_CARD_VIEW`, `CARD_HEIGHT` |
| Files (classes/components) | PascalCase  | `FolderCardView.ts`           |
| Files (utilities)     | kebab-case       | `markdown-utils.ts`           |

### Access Modifiers

- Use the `private` keyword for non-public members (not `#` private fields).
- Class fields are initialized at declaration when possible.

### Async Patterns

- Prefix fire-and-forget async calls with `void`:
  ```ts
  void this.refreshFolderCards();
  void view.setFolder(folder);
  ```
- Always use explicit `async` / `await` with `Promise<T>` return types.
- Use parameterless `catch` blocks for non-critical failures:
  ```ts
  } catch {
    card.excerpt = "";
  }
  ```

### Error Handling

- Guard with early returns and `instanceof` checks rather than try/catch:
  ```ts
  if (!(target instanceof TFile)) {
    return;
  }
  ```
- Use try/catch only around truly fallible operations (e.g., `decodeURIComponent`).
- Empty catch blocks are acceptable for graceful degradation.

## Import Order & Style

1. **Obsidian SDK** imports first (from `"obsidian"`), destructured.
2. **Local imports** second, using relative paths (`"./view/FolderCardView"`).
3. Group type-only imports with `import type { ... }`.

```ts
import { ItemView, TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import FolderCardPanel from "./FolderCardPanel.svelte";
import type { NoteCardRecord } from "./types";
```

## Svelte Conventions

- **Svelte 4** syntax (NOT Svelte 5 runes). Use `$:` reactive declarations.
- Use `createEventDispatcher()` for custom component events.
- Props are declared with `export let`.
- No TypeScript in `.svelte` files (plain `<script>`, not `<script lang="ts">`).

## CSS Conventions

- All selectors scoped under `.folder-card-view` to avoid Obsidian conflicts.
- Class prefix: `fce-` (Folder Card Explorer).
- Flat class structure (no deep BEM nesting).
- No CSS preprocessor — plain CSS in `styles.css`.
- Selection state class: `is-selected`.

## Architecture Notes

- **Generation tracking**: Async operations carry a `generation` counter to
  detect staleness after folder switches. Always check `generation` after
  awaiting.
- **Lazy hydration**: Card excerpts and inline cover images are loaded
  on-demand via viewport-driven `hydrate-range` events, not eagerly.
- **Virtualized scrolling**: Only visible cards (plus OVERSCAN) are rendered.
  The Svelte component manages a virtual window with padding divs.
- **Debounced vault observers**: File create/modify/delete/rename events are
  debounced (250ms) before refreshing cards.

## Obsidian Plugin API Patterns

- Extend `Plugin` for the entry point; extend `ItemView` for sidebar views.
- Register views with `this.registerView(VIEW_TYPE, factory)`.
- Use `this.registerEvent(...)` and `this.registerDomEvent(...)` for
  auto-cleanup on plugin unload.
- Access vault via `this.app.vault`, metadata via `this.app.metadataCache`.
- Use `this.app.vault.cachedRead(file)` for reading note content.

## External Dependencies (marked external in esbuild)

Do NOT import from these — they are provided by the Obsidian runtime:
`obsidian`, `electron`, `@codemirror/state`, `@codemirror/view`,
`@codemirror/language`.
