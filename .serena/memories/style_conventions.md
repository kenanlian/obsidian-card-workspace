# Code Style & Conventions

## TypeScript
- **strict mode** enabled in tsconfig
- Explicit return types on all public/exported methods (e.g. `async onload(): Promise<void>`)
- Use `type` imports: `import type { ... }` for type-only imports
- Prefer `interface` over `type` for object shapes
- Use `null` (not `undefined`) for optional values in data structures
- Private members use `private` keyword, no `#` prefix
- Constants: UPPER_SNAKE_CASE for module-level constants
- Classes: PascalCase; methods/variables: camelCase
- Files: PascalCase for classes/components, kebab-case for utility modules

## Async
- `void` keyword before fire-and-forget async calls (e.g. `void this.refresh()`)
- Explicit `async`/`await` with `Promise<void>` return types
- Empty `catch` blocks (parameterless) for non-critical failures

## Imports
- Obsidian SDK imports first, then local imports
- Destructured imports from `obsidian` grouped in one statement
- Relative paths for local imports (e.g. `"./view/FolderCardView"`)

## Svelte
- Svelte 4 syntax (not Svelte 5 runes)
- `$:` reactive declarations
- `createEventDispatcher()` for component events
- CSS class prefix: `fce-` (Folder Card Explorer)

## CSS
- All selectors scoped under `.folder-card-view`
- BEM-like flat class names with `fce-` prefix
- Warm retro paper color palette
- No CSS preprocessor
