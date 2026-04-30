
- Added a shared `file-kind` contract in `src/view/file-kind.ts` that resolves kinds from paths case-insensitively and checks `.excalidraw.md` before plain `.md` so Excalidraw notes stay classified correctly.
- Shared card records now carry `fileKind: CardFileKind`, and preview mode now includes `"placeholder"` to support later non-Markdown file rendering without changing the core card shape again.
- Targeted helper tests passed with `npx vitest run src/view/file-kind.test.ts`.
- Added RED coverage in `src/view/note-ops.test.ts` for the future preference-respecting bulk delete helper path. The test shape mirrors existing batch helper coverage, asserts `fileManager.trashFile(...)` call order, and explicitly asserts `vault.delete(...)` is not used on the new path.

- Added `deleteFileUsingObsidianPreference(...)` and `batchDeleteFilesUsingObsidianPreference(...)` in `src/view/note-ops.ts`, mirroring the existing result-shape and partial-failure batch patterns while routing through `app.fileManager.trashFile(file)`.
- Confirmed the dedicated preference-respecting tests now pass with `npx vitest run src/view/note-ops.test.ts`, and the old `deleteFile(...)`, `batchDeleteFiles(...)`, and `batchTrashFiles(...)` paths kept their original semantics.
- Task 4 RED coverage now exists in `src/view/Toolbar.svelte.test.ts` and `src/view/card-context-actions.test.ts` with exact scenario names, requiring one destructive bulk action (`Delete selected`), six bulk controls total, and preference-aware delete confirmation wording.

- Task 6 RED coverage now includes explicit scenarios named `supports base canvas and excalidraw cards` (panel/runtime) and `non-markdown cards remain title-searchable only` (pipeline/card rendering), matching the plan QA hooks for targeted `-t` execution.
- Added RED assertions for supported-card inclusion (`.base`, `.canvas`, `.excalidraw`, `.excalidraw.md`), exact empty-state copy (`No supported files found in this folder.`), and search behavior that keeps placeholder text out of searchable content while preserving title matching.

- Task 5 consolidated bulk destructive UX to a single toolbar action (`bulk-delete-selected`), removing `canBulkTrashSelected` and `bulk-trash-selected` from Toolbar/Panel/runtime state propagation while keeping merge cleanup on `batchTrashFiles(...)` unchanged.
- `FolderCardView.bulkDeleteSelected()` now routes through `batchDeleteFilesUsingObsidianPreference(...)` with exact confirmation copy (`Delete selected notes?` / `Delete` / `Delete {count} selected note(s)? Obsidian will use your Files & Links delete preference.`), and preserves stale-selection reconciliation before confirm.

- Task 7 migrated FolderCardView to collectSupportedFiles(...) with shared file-kind helpers so .base, .canvas, .excalidraw, and .excalidraw.md are eligible cards while unsupported files stay excluded.
- Hydration now branches by fileKind: markdown keeps cachedRead(...) + buildLightPreview(...), while non-markdown cards hydrate as previewMode: "placeholder" with exact placeholder HTML and no file reads.
- Indexed-search projection now appends non-markdown cards only when their titles match an active query and preserves markdown indexed order; fallback body matching remains markdown-only.

- Task 7 empty-state contract hole is now closed: FolderCardPanel source and both panel tests use the exact copy "No supported files found in this folder." and the targeted Task 7 suite still passes.

### Task 8: File-type icon rendering
- `use:applyIcon` action in Svelte 5 runs asynchronously during tests in `jsdom`, so querying elements by attributes updated via Svelte actions requires `await tick()` in test environments.
- Using `card.previewMode === "placeholder"` helps override the HTML directly within Svelte to inject the static placeholder text and bypass the highlighting functionality completely, making placeholder test logic sound.

- Final-wave fix: search mutation forwarding in `src/main.ts` now marks rename events as markdown-relevant when either the new file kind is markdown **or** `oldPath` resolves to markdown (`resolveCardFileKindFromPath(oldPath) === "markdown"`), so markdown -> non-markdown renames still trigger index cleanup.
- Added explicit regression coverage for markdown -> non-markdown rename removal in `src/search/SearchIndexManager.test.ts` (`removes indexed markdown document when rename target is no longer markdown-indexable`).
- Added plugin-level forwarding coverage in `src/main.test.ts` (`treats markdown-to-non-markdown file renames as markdown search mutations`) to prevent regressions at the mutation seam.
