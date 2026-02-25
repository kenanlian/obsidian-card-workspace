# Folder Card Explorer — Obsidian Plugin

## Purpose
An Obsidian plugin that listens for folder clicks in File Explorer and renders notes from that folder as a card stream in the right sidebar.

## Tech Stack
- **Language**: TypeScript (strict mode)
- **UI**: Svelte 4 (`.svelte` components)
- **Bundler**: esbuild + esbuild-svelte
- **Platform**: Obsidian plugin (uses `obsidian` API)
- **Target**: ES2020 (tsconfig), es2018 (esbuild output)
- **Module**: ESNext / Bundler resolution, output CJS

## Structure
```
src/
  main.ts                       — Plugin entry: FolderCardExplorerPlugin (extends Plugin)
  view/
    FolderCardView.ts           — ItemView subclass, manages card state & hydration
    FolderCardPanel.svelte      — Svelte component for virtualized card list
    markdown-utils.ts           — Utility functions for markdown stripping, image extraction
    types.ts                    — NoteCardRecord interface
styles.css                      — Global retro-paper aesthetic CSS
esbuild.config.mjs              — Build config (CJS output to main.js)
manifest.json                   — Obsidian plugin manifest
```

## Key Design Patterns
- Generation-based staleness checks for async operations
- Lazy hydration of card content (excerpt + cover) via viewport-driven range requests
- Virtualized scrolling in Svelte with OVERSCAN
- Debounced vault observers for create/modify/delete/rename
- `void` prefix on fire-and-forget async calls
