
- Fixed the file-kind helper contract to match plan text exactly: `isMarkdownCardKind` now only accepts `"markdown"`, canvas uses `layout-dashboard`, and placeholder text is the full sentence form for `base`, `canvas`, and `excalidraw`.

- The RED coverage for the preference-respecting batch delete helper needed an import cleanup in `src/view/note-ops.test.ts`; once the stale `noteOps` import was removed, diagnostics stayed clean and the targeted vitest file passed.
- Task 4 targeted RED runs currently fail because runtime still exposes `bulk-trash-selected` and `canBulkTrashSelected`, and the toolbar still renders seven bulk controls; this is expected until Task 5 consolidates bulk delete behavior.

- Verified RED state with `npx vitest run src/view/FolderCardPanel.svelte.test.ts src/view/card-context-actions.test.ts -t "supports base canvas and excalidraw cards"`: runtime still returns markdown-only collection and panel still renders `No Markdown notes found in this folder.`
- Verified RED state with `npx vitest run src/view/pipeline.test.ts src/view/CardItem.svelte.test.ts -t "non-markdown cards remain title-searchable only"`: indexed ordered search does not append non-markdown title matches and CardItem still highlights placeholder preview text.

- Targeted Task 5 validation command `npx vitest run src/view/Toolbar.svelte.test.ts src/view/card-context-actions.test.ts` still has one unrelated pre-existing failure in `supports base canvas and excalidraw cards` (Phase 1 regression hardening), which expects non-markdown inclusion not yet implemented in runtime behavior.

- Final-wave review reject addressed: stale test-only references to `bulk-trash-selected` and `canBulkTrashSelected` were removed from `src/view/card-context-actions.test.ts` (no runtime symbol reintroduction).
- Validation after fix is green for targeted suites (`SearchIndexManager.test.ts`, `card-context-actions.test.ts`) and full required gates (`npm run check`, `npm run build`, `npm test`).
