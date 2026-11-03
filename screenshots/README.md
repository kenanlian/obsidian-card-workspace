# README appearance images

`card-looks-zh.png` and `card-looks-en.png` are 3840 × 5006 PNG exports arranged in two columns and four rows, adapted from the closing wall in `../card-workspace-promo/renders/19-looks.final.mp4`. They reuse the episode's `LOOKS` / `EXTRA_LOOKS` configurations, captured Obsidian theme, photos, and production Card Workspace Svelte components. The repeated compact flat `books` combination is omitted, preserving all five distinct card styles across eight windows.

Each window is rendered at 1040 × 680 instead of 1840 × 932. The navigation/card sidebar stays 640px wide, while the main editor becomes narrower. At the same overall display width, cards are about 2.8 times their size in the original nine-window image. Explanatory labels below individual windows are removed.

The source renderer is `../card-workspace-promo/src/stage/looks-scene.ts`; the original screenshot utility is `scripts/lab/looks-cover-crops.mjs` in that project. The still-image entry is `readme-looks.html` with `src/dev/readme-looks.ts`. Chinese uses `data/vault-looks.json`; English uses `data/vault-looks-en.json` and `data/looks-en-paths.json` for translated note content, filenames, folders, tags, properties, favorites, and boxes.

To regenerate both images with the promo project's dependencies and Chromium installed:

```bash
cd ../card-workspace-promo
node scripts/render-readme-looks.mjs ../obsidian-card-workspace/screenshots
```

The script starts its own local Vite server, waits for fonts, layout and image decoding, checks all eight windows contain cards and have no explanatory labels, rejects failed resource loads and untranslated English text, then captures both images. `HYPERFRAMES_BROWSER_PATH` can select a Chromium executable; otherwise it uses the local Playwright cache.

For a comparison export with three columns and nine windows, pass an output directory and `3`: `node scripts/render-readme-looks.mjs /tmp/card-looks-nine 3`. This keeps the narrower editor and removes labels, but cards are only about 1.8 times their original size at the same display width.
