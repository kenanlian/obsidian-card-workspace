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

## Releasing

This repo now supports draft GitHub Releases through `.github/workflows/release.yml`.

1. Ensure GitHub Actions has **Read and write permissions** under **Settings -> Actions -> General -> Workflow permissions**.
2. Prepare the version metadata together:

   ```bash
   npm run release:prepare -- 0.1.1
   ```

   If you also need to raise the minimum supported Obsidian version, pass it as the second argument:

   ```bash
   npm run release:prepare -- 0.1.1 1.6.0
   ```

3. Validate the release metadata and the normal repo checks:

   ```bash
   npm run release:check -- 0.1.1
   npm run check:svelte
   npm run check
   npm run build
   npm test
   ```

4. Commit the version bump, then create and push an annotated bare semver tag that exactly matches `manifest.json.version` (for example `0.1.1`, not `v0.1.1`):

   ```bash
   git tag -a 0.1.1 -m "0.1.1"
   git push origin main
   git push origin 0.1.1
   ```

5. The release workflow will create a draft GitHub Release with these assets:
   - `main.js`
   - `manifest.json`
   - `styles.css`

6. Add release notes on GitHub and publish the draft release.
