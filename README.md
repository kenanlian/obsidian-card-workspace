# Card Workspace

An Obsidian plugin that turns folder clicks in the File Explorer into a warm retro card stream in the right sidebar. Browse notes by folder, click a card to open it, and keep your context while exploring.

## How to use

1. Enable the plugin in Obsidian's **Community plugins** settings.
2. Open the **File Explorer** and click any folder.
3. A card stream appears in the **right sidebar**, showing notes from that folder.
4. Click a card to open the note.
5. Switching notes in the editor automatically selects the matching card.

Cards display the note title, a Markdown-stripped excerpt, and a cover image when available. Cover images are resolved from YAML frontmatter fields (`cover`, `image`, `banner`, `thumbnail`, `hero`, `cardImage`) or the first image found in the note body.

## Features

- Click any folder in File Explorer to load `FOLDER_CARD_VIEW` in the right sidebar.
- Cards show title, Markdown-stripped excerpt, and cover image.
- Cover image source order: YAML frontmatter (`cover`, `image`, `banner`, `thumbnail`, `hero`, `cardImage`) -> first image in note body.
- Virtualized scrolling keeps rendering smooth for large folders.
- Two-way sync:
  - Click card -> opens note using the configured default card-open behavior.
  - Switching note in editor -> corresponding card gets selected.
- Warm Retro Paper aesthetic using `styles.css`.

## Limitations

- All processing is local to your vault. No external network requests are made by default.
- The current release is desktop-only. Card Workspace relies on desktop File Explorer and right-sidebar workflows, and desktop shell actions stay unavailable outside desktop Obsidian.
- The card stream is driven by folder clicks in the File Explorer. There is no standalone browse mode outside of folder selection.
- Behavior and compatibility follow what is declared in `manifest.json` and the current Obsidian version.

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

This repo supports draft GitHub Releases through `.github/workflows/release.yml`.

1. Ensure GitHub Actions has **Read and write permissions** under **Settings -> Actions -> General -> Workflow permissions**.
2. Determine the target version from `manifest.json`:

   ```bash
   TAG=$(node -p "require('./manifest.json').version")
   ```

3. Prepare the version metadata together:

   ```bash
   npm run release:prepare -- "$TAG"
   ```

   This syncs `package.json`, `package-lock.json`, `manifest.json`, and `versions.json` for the target release.

   If you also need to raise the minimum supported Obsidian version, pass it as the second argument:

   ```bash
   npm run release:prepare -- "$TAG" 1.6.0
   ```

4. Validate the release metadata and run the normal repo checks:

   ```bash
   npm run check:svelte
   npm run check
   npm run build
   npm test
   npm run release:check -- "$TAG"
   ```

5. Commit the version bump, then create and push an annotated bare semver tag that exactly matches `manifest.json.version` (for example `<version>`, not `v<version>`):

   ```bash
   git tag -a "$TAG" -m "$TAG"
   git push origin main
   git push origin "$TAG"
   ```

6. The release workflow will create a draft GitHub Release with these assets:
   - `main.js`
   - `manifest.json`
   - `styles.css`

7. Add release notes on GitHub and publish the draft release.
