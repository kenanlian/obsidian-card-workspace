# Search preview optimization verification — 2026-11-13

Baseline: `0b94e63796c36c5f42824c578ed4f06c344f0aad`. Synthetic vault IO; no real vault or IndexedDB. Both runners retained 5 warmups and 20 alternating samples, legacy interleaved timings, and original thresholds. Performance comparisons ran serially.

Node: 34 gates passed. Chromium: 48 gates and 60 layout cases passed. No gate thresholds were relaxed.

| Case | Query-switch median ms, baseline → candidate | Cache-hit P95 ms, baseline → candidate | Query-switch reads |
|---|---:|---:|---:|
| plain/2 | 5.40 → 1.40 | 0.096 → 0.075 | 0 |
| plain/5 | 5.46 → 2.40 | 0.108 → 0.084 | 0 |
| formatted/2 | 5.53 → 1.94 | 0.092 → 0.143 | 0 |
| formatted/5 | 5.94 → 2.14 | 0.100 → 0.088 | 0 |

Reports: [Node](search-preview-node-20261113.json), [Chromium](search-preview-browser-20261113.json), [synchronous preparation microbenchmark](search-preview-preparation-20261113.json). The Node report also contains the reproducible production-scheduled preparation comparison; synchronous microbenchmark results are supplementary.

The Chromium `productionLifecycle` object records real controller/panel atomic commits, forced timeout skeletons (body and title-only), phone resource policy, measured forward/reverse scrolling, expanded-card anchors and hidden query/viewport gating. See raw metrics for preparation completion/wait, prefetch use/waste, read accounting, blocking slices, expansion steps and long tasks.

The first full comparison exposed viewport-promoted prefetch dropping prepared sources and speculative work competing with foreground demand. The implementation now retains demand-owned sources, starts lookahead after foreground settlement, cancels obsolete schedules, and fast-paths identical satisfied viewport demand while validating live fingerprints. A shared segment memo also reuses identical measured/rendered crop results, keyed by snippet, width and fonts, reducing duplicate canvas measurement. Final measurements use the original timing protocol.

Mapping parity was checked on seeded malformed markup, CRLF, long lines, fences, Unicode and capped source/term cases. Synchronous preparation improvements vary by fixture (roughly 19–31%); the 30% goal is not a universal guarantee.

Timeout skeletons deliberately shrink to actual snippet height. Explicit append-20 can produce giant cards; pagination bounds each operation rather than final DOM size. No Worker, enlarged cache, persistent setting or schema migration was introduced.

Real Obsidian desktop/phone manual acceptance remains outstanding; synthetic phone policy and Chromium are not a substitute for real device IO and interaction.

Full validation passed: `npm run lint && npm run check && npm run check:svelte && npm run build && npm test`. Vitest: 208 files passed, 4119 tests passed and one skipped. Production bundle checks passed desktop/tablet/phone native-free startup and real Svelte browse/input/menu/settings/blocked-search checks.

The production-scheduled preparation medians decreased by 30.7–57.9% across all seven benchmark fixtures (mapping plus cooperative scheduling); this differs from the supplementary synchronous microbenchmark, which isolates computation.
