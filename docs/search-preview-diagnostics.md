# Search preview verification

Markdown search results render readable hit contexts in source order. Each snippet reserves two display lines. The independent maximum snippet setting accepts 1–5 (default 2), without using the ordinary preview-line budget. Overlapping contexts merge; short hit lines can include following prose, stopping at blank lines and new Markdown block boundaries. Each snippet has a 200 UTF-16 character budget and at most 60 preceding characters. Width changes crop only presentation text, keeping the first highlight visible and its source location unchanged.

Search snippets reuse ordinary list markers, read-only task states, same-size heading emphasis, code styling and link-label cues. Nesting remains flat. Formatting is limited to selected contexts (4096 source code units and 32 syntax attempts/runs); over-budget or marker-only matches retain readable plain text and the original source location. No full Markdown renderer or additional vault read is introduced. Code and comment indexing rules are unchanged.

Title-only matches retain the ordinary opening preview. One runtime LRU entry per file holds that preview and the current query context. Search lookahead uses the same queue at lower priority (desktop/tablet/phone: 24/12/8 cards), retains previews without adding prepared sources, and pauses while hidden. Reads and cooperative extraction share the device-budgeted queue. Folder and box queries prepare the real visible window before atomically publishing results, bounded by 100ms/12 cards on desktop, 120ms/8 on tablets and 140ms/6 on phones. Old committed results stay mounted during preparation. Scope loads and Links do not add this wait. A timeout publishes measurable skeletons; completed snippets then use their actual height, so some shrinkage is expected. Query drafts, preview settings and file events invalidate stale work, including file mutations with unchanged timestamps.

Clicking or activating a snippet selects and scrolls its first merged source highlight in editing mode, or locates the source line in reading mode. Opening keeps the resulting mode. Position validation accepts a moved hit only when its text and bounded surrounding context match uniquely. Automatic links following may replace the original card stream without canceling accepted positioning; manual source selection, input, pane changes, newer opens, view closure and query/settings/file changes cancel it. Snippet location is independent of the ordinary link-card positioning setting.

Run the full validation chain:

```sh
npm run lint && npm run check && npm run check:svelte && npm run build && npm test
```

Run the isolated Node and Chromium performance comparisons:

```sh
node scripts/run-search-preview-benchmark.mjs --check --output /absolute/path/search-format-node.json
node scripts/run-search-preview-browser.mjs --check --output /absolute/path/search-format-browser.json
```

By default both runners freeze complete production source and CSS at `4064ce04c4534dc0f55e57d121ab4198819f29c7`. They share only installed dependencies and deterministic synthetic inputs. Use `--self-check` to compare two separately built baseline lanes, or `--baseline <commit>` to select another compatible baseline. Defaults are five warmups followed by 20 alternating measured samples; `--warmups` and `--samples` override them. Schema-v2 reports retain raw samples, medians, P95 and maxima. Timing gates run with `--check` or `--self-check`, outside ordinary CI; failed gates retain the report and return exit code 1.

Node verifies identical prepared index documents, ranking, hit counts, ordinary previews, original snippets/source locations, 12 reads and the five-job cap. GC and pending cooperative timers from the preceding sample are drained outside measurement. It compares default/maximum snippet counts, ordinary and formatted prose, near-cap input, dense formatting, long lines and malformed links. First-screen/scroll/extraction medians and P95 allow baseline + max(10%, 5ms); query/cache allow baseline + max(5%, 0.25ms). It reports formatting separately within extraction diagnostics. There is no vault, IndexedDB, real disk IO, DOM or editor opening in this runner.

Chromium mounts production cards and the virtualized panel. It verifies snippet counts 1–5, ordinary preview budgets 3/8, 280px and 220px cards, right images, styled/oversized prefixes, two-line height/clamp, contiguous snippets, native activation, bulk selection and scroll anchors. Paired timing covers ordinary, task/heading and dense code/link contexts, with two/five snippets and images off/right. Prepared results are published at the same animation-frame boundary in both lanes. First-frame, preview-update and scrolling-frame median/P95 gates allow 2ms; candidate long-task counts must not increase. `--profile` adds CDP layout/style/script measurements; `--case <kind>/<mode>/<snippet-count>` limits timing to one diagnostic case. Geometry and interaction checks still run. These measurements use synthetic host groups and local image assets, excluding real Obsidian and disk IO.

Saved format-enhancement artifacts:

- [Node comparison](../diagnostics/search-format-node-20261004.json): all 30 gates passed, with index/preview/location compatibility and the five-job cap verified.
- [Chromium comparison](../diagnostics/search-format-browser-20261004.json): 48 timing gates, 60 layout cases and 10 styled-prefix checks passed, with no additional long tasks.
- [Task/heading preview](../diagnostics/search-format-browser-20261004-formatted.png) and [dense code/link preview](../diagnostics/search-format-browser-20261004-dense.png).

The earlier implementation diagnostics remain available in [the 2026-10-03 Node report](../diagnostics/search-preview-20261003.json) and [Chromium report](../diagnostics/search-preview-browser-20261003.json); their schema-v1 timing protocol differs from these comparisons.

The integration suite also exercises production card opening, the `file-open` selection fanout, automatic links following and complete card replacement before first positioning. Editing/reading positioning and the 400ms correction survive replacement; cancellation cases cover active source selection, input, newer opens, closure, and query/settings/file changes. These are host-contract tests using Obsidian mocks, rather than a claim of testing every behavior in a live desktop vault.

## Atomic commit and expanded snippets

The optimization baseline is `0b94e63796c36c5f42824c578ed4f06c344f0aad`. Use an explicit baseline and enable gates in **both** runners; run performance comparisons serially:

```sh
node scripts/run-search-preview-benchmark.mjs --baseline 0b94e63 --check --output /absolute/path/search-preview-node.json
node scripts/run-search-preview-browser.mjs --baseline 0b94e63 --check --output /absolute/path/search-preview-browser.json
```

The existing 1–5 setting still controls the initial snippet count. Each explicit expand/more action appends up to 20 further merged snippet windows; collapse restores the configured count. Total windows use the same overlap rules as extraction, not the title/body occurrence badge. Only requested windows receive presentation formatting. Expansion is host-owned, survives viewport unmounting, and is independent of Links reference expansion. Query/source/snippet-setting changes reset it; deletion and rename clear affected paths. An ordinary edit retains the requested count but revalidates its contents. Appended cards can become large: pagination bounds each operation, not the final card height.

The searchable body limit is 512×1024 UTF-16 code units, followed by the existing 50,000-term field budget. “All” means all available merged windows inside those bounds. Synthetic sizes must report characters separately from encoded bytes; Node preparation timing is not a phone latency guarantee.

Ready-to-ready health notifications do not clear cards or cancel valid pending requests. Content changes refresh results without an empty intermediate projection; file mutations invalidate only affected previews. Runtime index generations distinguish whole-index replacement from ordinary incremental edits. Non-ready indexed states still block nonempty queries immediately.

Supplement existing rendering measurements with transaction/queue diagnostics and controller-connected browser scenarios. Real desktop and phone Obsidian checks remain necessary for IO, mobile drawer behavior, scrolling and very large explicitly expanded cards.

Current runners emit schema-v3 reports. Node adds `preparation`, `paging` and per-case scheduler/read accounting, including unused lookahead and the final queue drain. The original interleaved first-screen/cache/scroll/query-switch timings and thresholds remain unchanged. Lookahead starts on a later task after foreground settlement; promoting it to visible demand retains the prepared source normally. Chromium adds candidate-only `productionLifecycle` scenarios (fast desktop, forced source timeout, phone policy), using production query/projection/hydration controllers and the production panel with synthetic indexed membership and source IO. These verify body/title-only skeleton geometry, real visible ranges, measured forward/reverse scrolling, append/collapse anchoring, and hidden query/viewport work. These scenarios supplement rather than replace the paired rendering gates.

Final optimization artifacts: [verification report](../diagnostics/search-preview-optimization-20261113.md), [Node](../diagnostics/search-preview-node-20261113.json), and [Chromium](../diagnostics/search-preview-browser-20261113.json). Both complete performance comparisons passed the original gates against `0b94e63`.
