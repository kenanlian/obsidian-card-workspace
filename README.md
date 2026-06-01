# Card Workspace

[简体中文](README.zh-CN.md)

An Obsidian plugin that shows folder notes as beautiful card stream in the sidebar or main editor leaf. Open Card Workspace manually, browse notes by folder, filter notes by tags, search notes by builtin function, click a card to open it, and optionally link File Explorer folder clicks into the view.

## Table of contents

- [Why Card Workspace](#why-card-workspace)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Features](#features)
- [Previews](#previews)
- [Compatibility and limitations](#compatibility-and-limitations)
- [Privacy](#privacy)
- [Development](#development)
- [Releasing](#releasing)
- [Support and license](#support-and-license)

## Why Card Workspace

Card Workspace gives you a visual, scannable way to browse and organize the notes inside any folder. Instead of reading a plain file list, you see cards with titles and excerpts. Click a folder, glance at the cards, and open the note you want without losing your place.

## Installation

Card Workspace is installed manually from GitHub releases.

1. Download the latest release from the [Releases](https://github.com/kenanlian/obsidian-card-workspace/releases) page.
2. Extract the archive and copy `main.js`, `manifest.json`, and `styles.css` into your vault's `.obsidian/plugins/card-workspace/` folder.
3. Open Obsidian's **Settings -> Community plugins**.
4. Turn off **Safe mode** if it is on.
5. Find **Card Workspace** in the plugin list and enable it.

## Quick start

1. Run **Open Card Workspace view** from Obsidian's command palette to open the panel in the **left sidebar**.
2. Browse notes in Card Workspace and click a card to open it.
3. If you want File Explorer folder clicks to jump into Card Workspace too, enable **Link File Explorer folder clicks to Card Workspace** in the plugin settings.

## Features

- **Left-sidebar folder browsing.** Open Card Workspace in the left sidebar and browse a folder as a card stream.
- **Optional File Explorer linkage.** When enabled, clicking a folder in the File Explorer also opens that folder in Card Workspace.
- **Card previews.** Each card shows the note title and a Markdown-stripped excerpt.
- **Virtualized scrolling.** Large folders stay smooth because only visible cards are rendered.
- **Two-way sync.** Click a card to open its note. Switch notes in the editor and the corresponding card is selected automatically.
- **Local search.** Full-text search across the current folder's cards.
- **Tag filtering.** Filter cards by tags extracted from frontmatter and note content.
- **Pin reordering.** Pin cards to keep them at the top of the stream.
- **Bulk actions.** Select multiple cards to move, delete, or merge notes in batches.

## Previews

Cards display the note title and a Markdown-stripped excerpt. The excerpt is generated from the note body with images and formatting stripped for readability.

![Card Workspace demo](screenshots/card_workspace_demo.gif)

## Compatibility and limitations

- **Desktop only.** Card Workspace relies on desktop File Explorer and left-sidebar workflows. It is unavailable on mobile.
- **Sidebar-first workflow.** Card Workspace remains available as a left-sidebar view, while File Explorer folder-click linkage is optional and disabled by default.
- **Obsidian version.** Requires Obsidian 1.5.0 or later. Behavior and compatibility follow what is declared in `manifest.json`.

## Privacy

All processing stays inside your vault. The plugin does not make external network requests. File operations go through Obsidian's local Vault and FileManager APIs. Search indexing uses the local `minisearch` library.

## Development

```bash
npm install
npm run build
```

For watch mode:

```bash
npm run dev
```

Run type checks and tests:

```bash
npm run check
npm test
```

## Releasing

This repo creates draft GitHub Releases from bare semver tags through `.github/workflows/release.yml`.

1. Determine the target version from `manifest.json`:

   ```bash
   TAG=$(node -p "require('./manifest.json').version")
   ```

2. Sync the release metadata:

   ```bash
   npm run release:prepare -- "$TAG"
   ```

   To also raise the minimum supported Obsidian version, pass it as the second argument:

   ```bash
   npm run release:prepare -- "$TAG" 1.6.0
   ```

3. Run the normal checks plus release validation:

   ```bash
   npm run check:svelte
   npm run check
   npm run build
   npm test
   npm run release:check -- "$TAG"
   ```

4. Commit the version bump, then create and push an annotated bare semver tag that exactly matches `manifest.json.version` (for example `<version>`, not `v<version>`):

   ```bash
   git tag -a "$TAG" -m "$TAG"
   git push origin main
   git push origin "$TAG"
   ```

5. The workflow creates a draft GitHub Release containing `main.js`, `manifest.json`, and `styles.css`.
6. Add release notes on GitHub and publish the draft release.

## Support and license

If you run into issues, please open a ticket on [GitHub Issues](https://github.com/kenanlian/obsidian-card-workspace/issues).

Card Workspace is released under the MIT License.
