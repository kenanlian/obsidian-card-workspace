# Draft: Card View Delete + File Types + Icons

## Requirements (confirmed)
- bulk delete button cleanup: merge the current trash and delete bulk-action buttons into a single delete action
- delete behavior: use Obsidian's built-in delete-file behavior so actual outcome follows the user's Obsidian “Files & Links” settings; do not add plugin settings
- file visibility: include `.base` and `.canvas` files in card display alongside current supported file types
- preview behavior: only `.md` files should have text previews; non-markdown file types should show a placeholder preview such as `This is a base/canvas/excalidraw file`
- card header affordance: add a document-type icon at the start of the card title area / top-right region, with different icons for `.md`, `.base`, `.canvas`, and `.excalidraw`

## Technical Decisions
- bulk delete path: use Obsidian `app.fileManager.trashFile(file)` as the single user-facing delete action so behavior follows the user's File & Links settings; do not add plugin settings
- supported-type seam: current card eligibility is md-only in `src/view/FolderCardView.ts`; plan should replace the hardcoded `"md"` gate with a supported-type predicate covering `.md`, `.base`, `.canvas`, and `.excalidraw`
- preview seam: current preview generation is markdown-derived via `src/view/markdown-utils.ts`; non-markdown card types should bypass text extraction and show a typed placeholder preview instead
- card header seam: current per-card UI in `src/view/CardItem.svelte` has title + pin icon only; file-type icon must be added there using the repo's existing `setIcon` pattern
- bulk action seam: current toolbar/runtime expose separate `bulk-trash-selected` and `bulk-delete-selected`; plan should consolidate to a single delete action path

## Research Findings
- `src/view/FolderCardView.ts` currently loads cards through a md-only path (`collectMarkdownFiles`) and routes destructive bulk actions through separate trash/delete handlers
- `src/view/Toolbar.svelte` currently renders separate bulk trash and bulk delete buttons; `src/view/CardItem.svelte` has no file-type icon today
- `src/view/markdown-utils.ts` currently generates markdown text/code previews only; current non-markdown card handling is not implemented
- tests already cover toolbar and bulk destructive flows (`src/view/Toolbar.svelte.test.ts`, `src/view/card-context-actions.test.ts`, `src/view/note-ops.test.ts`)
- there is no explicit test coverage yet for non-markdown card eligibility/display; `src/view/FolderCardPanel.svelte.test.ts` still asserts an md-only empty state

## Open Questions
- preferred test strategy: TDD / tests-after / no new automated tests
- icon choice policy: use native Obsidian/lucide-style file icons by default, unless a custom mapping is preferred
- placeholder copy: use a per-type placeholder string pattern by default unless fixed wording is required

## Scope Boundaries
- INCLUDE: bulk delete button consolidation, `.base`/`.canvas` visibility, non-markdown placeholder previews, per-file-type icon in card title area
- EXCLUDE: new plugin settings for delete behavior, unrelated card layout redesigns, broader file-type support beyond requested extensions unless required by existing architecture
