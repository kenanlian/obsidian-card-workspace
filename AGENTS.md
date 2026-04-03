# AGENTS.md — Folder Card Explorer

## Purpose
Obsidian plugin that turns folder clicks in the File Explorer into a virtualized card stream in the right sidebar.

## Project Priorities
- **Performance first**: avoid full re-renders, blocking work, and unnecessary vault rescans.
- **Local-first**: keep vault processing local; do not add network behavior unless explicitly requested.
- **Native feel**: prefer Obsidian APIs, theme variables, and interaction patterns.
- **Modular design**: keep Obsidian runtime bindings, pure logic, and Svelte UI separated.

## Stack
- TypeScript with `strict: true`
- Svelte 5 runtime/compiler with `compatibility.componentApi = 4`
- Legacy/Svelte-4-style component syntax (`export let`, `$:`, `createEventDispatcher`)
- esbuild + esbuild-svelte bundling to `main.js` (CJS)
- Vitest for tests

## Repository Layout
```text
src/
  main.ts
  settings.ts / settings.test.ts
  FolderPickerModal.ts / FolderPickerModal.test.ts
  __mocks__/
    obsidian.ts
    FolderCardPanel.svelte.ts
  view/
    FolderCardView.ts
    FolderCardPanel.svelte / Toolbar.svelte / CardItem.svelte
    markdown-utils.ts / markdown-utils.test.ts
    metadata-utils.ts / note-ops.ts / pipeline.ts / pipeline.test.ts
    scroll-anchoring.ts / scroll-anchoring.test.ts
    card-context-actions.test.ts / types.ts
styles.css
esbuild.config.mjs
vitest.config.ts
manifest.json
```

## Agent / Editor Rule Files
Checked and not present:
- `.cursor/rules/`
- `.cursorrules`
- `.github/copilot-instructions.md`

No Cursor or Copilot rule files are active in this repo.

## Install / Build / Test
```bash
npm install
npm run dev        # esbuild watch mode
npm run build      # production bundle -> main.js
npm run check      # TypeScript type-check only
npm test           # run all tests once
npm run test:watch # vitest watch mode
```

### Single-test commands
```bash
npx vitest run src/view/markdown-utils.test.ts
npx vitest run src/view/markdown-utils.test.ts -t "buildLightPreview handles code fences"
```

### Lint / formatting status
- No ESLint configured
- No Prettier configured
- Do not add lint/format tooling unless explicitly requested

## Required Validation
After any code or docs change, run all three:
```bash
npm run check
npm run build
npm test
```
If any command fails, the task is incomplete.

## Code Style
### Formatting
- Use 2-space indentation in TS, Svelte, and CSS.
- Use double quotes in TS/JS.
- End TS/JS statements with semicolons.
- Keep trailing commas in multi-line objects, arrays, and argument lists.

### Types
- Keep strict typing; do not introduce implicit `any`.
- Add explicit return types to exported and public functions/methods.
- Prefer `interface` for object shapes.
- Prefer `type` for unions, aliases, and intersections.
- Use `null` for explicit empty state where the codebase already does so.
- Use `private` members, not `#private` fields.

### Imports
Order imports in this sequence:
1. Obsidian SDK imports from `"obsidian"`
2. Local runtime imports
3. Local `import type` imports

### Naming
- Classes, interfaces, Svelte components: `PascalCase`
- Functions, methods, locals: `camelCase`
- Module-level constants: `UPPER_SNAKE_CASE`
- Class/component files: `PascalCase.ts` / `PascalCase.svelte`; utility files: `kebab-case.ts`

### Async / errors
- Prefix fire-and-forget async work with `void`.
- Prefer `async`/`await` over raw promise chains.
- Use guard clauses before fallible operations.
- Keep `try/catch` at real failure boundaries.
- In this repo, graceful-degradation catches may return fallback values instead of surfacing UI noise.

## Svelte Guidance
- Treat this as **Svelte 5 in legacy compatibility mode**, not a runes-based codebase.
- Keep using `export let`, `$:` reactive declarations, and `createEventDispatcher()`.
- Do **not** introduce Svelte 5 runes (`$state`, `$derived`, `$effect`) unless the task explicitly migrates the component model.
- Preserve the host integration seam used by `FolderCardView.ts`: component instances are created with `new`, updated with `$set`, subscribed with `$on`, and cleaned up with `$destroy`.

## CSS Guidance
- Scope selectors under `.folder-card-view` where applicable.
- Prefix plugin-specific classes with `fce-`.
- Use Obsidian theme variables instead of hardcoded visual tokens when possible.
- Use `is-selected` for selected-state styling.
- Keep styles in `styles.css`; no preprocessors.

## Architecture Notes
- `src/main.ts` owns plugin lifecycle, Obsidian event wiring, settings I/O, and view activation.
- `src/view/FolderCardView.ts` is the runtime coordinator and state owner for cards, selection, refresh, hydration, and visible-card projection.
- Svelte components are presentation/event surfaces, not the source of truth.
- `src/view/pipeline.ts` owns visible-card projection steps such as filtering and pin reordering.

## Important Invariants
Do not casually break these patterns:
- Generation-based stale-result protection for async work
- Viewport-driven lazy hydration of card content
- Virtualized rendering assumptions in `FolderCardPanel.svelte`
- Debounced vault observers before refresh
- Pinning changes order only; it does not bypass filters

## Obsidian-Specific Rules
- Export a default class extending `Plugin`.
- Register events and DOM listeners with Obsidian cleanup helpers when possible.
- Prefer Vault and FileManager APIs over lower-level adapter access.
- Do not bundle runtime-provided externals.

## Runtime Externals
These are provided by Obsidian and must stay external in the bundle:
- `obsidian`
- `electron`
- `@codemirror/state`
- `@codemirror/view`
- `@codemirror/language`
