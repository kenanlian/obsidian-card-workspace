# Draft: Search Hit Count Badges

## Requirements (confirmed)
- User request: "当用户输入搜索关键词后，在每个卡片上标注该卡片内有几个 match/命中"
- User request: "评估并提出具体标注位置方案，参考 Obsidian Omnisearch 的命中数量展示体验"
- User request: "先阅读/理解当前搜索与卡片渲染相关代码，评估数据流、UI 位置、性能影响、边界情况，然后产出一个可执行方案"
- Scope constraint: "暂时不要修改代码"

## Technical Decisions
- Planning-only mode: produce a Prometheus execution plan under `.sisyphus/plans/`; do not modify source code.
- Initial classification: Standard feature planning, likely touching search pipeline/data model/card UI/styles/tests.
- Product decision confirmed: count semantics = full searchable text occurrence count, following the same searchable text basis as the current indexed search rather than preview-only or distinct-term count.
- Test strategy confirmed: tests-after. The implementation plan must add focused tests after code changes and still run `npm run check`, `npm run build`, and `npm test`.

## Research Findings
- Current query state is owned by `src/view/FolderCardView.ts` (`searchQuery`, `searchExecution`, `searchOrderedPaths`, `searchStatus` around lines 424-447) and updated via toolbar events around lines 2052-2088.
- Search projection runs through `FolderCardView.refreshSearchProjection()` around lines 2090-2144, then `pipeline.ts` filters/reorders by authoritative `orderedPaths` at lines 45-75.
- Search result contract already has an unused runtime-internal `scoresByPath?: Record<string, number>` in `src/search/types.ts` lines 158-164; `NoteCardRecord` explicitly says score details must not leak into render-facing card types via `PipelineSearchInput` comments in `src/view/types.ts` lines 33-46.
- Card UI currently receives `card` and `searchQuery` only (`FolderCardPanel.svelte` lines 607-612); `CardItem.svelte` highlights title/preview from the raw query at lines 54-167 and renders title group/actions at lines 292-326.
- CSS has a natural badge location near `.fce-card-title-group` / `.fce-card-actions` and existing `.fce-search-hit` styles in `styles.css` lines 498-546.
- Omnisearch precedent: vault result row shows a muted inline counter after title/file info using `.omnisearch-result__counter`; value is `note.matches.length` with `match/matches` wording and hidden when zero. Source: `obsidian-omnisearch` `ResultItemVault.svelte` lines 182-188 and `assets/styles.css` lines 43-46.
- Tests are available for pure pipeline helpers, search service/index behavior, FolderCardView host state/stale requests, and jsdom Svelte rendering. No performance benchmark harness exists; use unit regression tests plus command validation.

## Open Questions
- Confirmed: Use Omnisearch-style literal occurrence count over full indexed searchable document (`title + normalized markdown content`), hidden for empty/blocked search states, because it matches user expectation that the badge means file-level hit count rather than preview-only hits.
- UI recommendation: muted inline badge in the card title row, immediately after the title within `.fce-card-title-group`, before action buttons. Alternative placements considered: right action cluster (competes with pin/more buttons), preview footer (less discoverable and weaker Omnisearch analogy).
- No blocking product questions remain; UI placement will proceed with the recommended title-row inline badge unless user requests otherwise.

## Scope Boundaries
- INCLUDE: data-flow evaluation, UI placement recommendation, performance/edge-case analysis, executable implementation plan.
- EXCLUDE: source code edits, docs outside `.sisyphus/`, executing implementation.
