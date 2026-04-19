# Card Workspace

An Obsidian plugin that listens for folder clicks in File Explorer and renders notes from that folder as a card stream in the right sidebar.

## Features

- Click any folder in File Explorer to load `FOLDER_CARD_VIEW` in the right sidebar.
- Cards show title, modified/created dates, Markdown-stripped excerpt, and cover image.
- Cover image source order: YAML frontmatter (`cover`, `image`, `banner`, `thumbnail`, `hero`, `cardImage`) -> first image in note body.
- Virtualized scrolling keeps rendering smooth for large folders.
- Two-way sync:
  - Click card -> opens note in main editor area.
  - Switching note in editor -> corresponding card gets selected.
- Warm Retro Paper aesthetic using `styles.css`.

## Governing Principles

- Performance First: avoid main-thread blocking; keep folder loads and scrolling responsive.
- Local-first & Privacy: process vault data locally; avoid external network requests by default.
- Native Feel: align with Obsidian interaction patterns and theme variables.
- Modular Design: keep TypeScript logic decoupled from Svelte rendering and Obsidian wiring.

## Development

```bash
npm install
npm run build
```

For watch mode:

```bash
npm run dev
```
