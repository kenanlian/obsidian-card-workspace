# Mobile adaptation

The mobile adaptation builds on fixed baseline `6aeaf3d32c126876116d09d0028a48fa0a7c8d9d`.
Its implementation and real-device procedure are documented in [Mobile usage and validation](../mobile.md).
The manifest now enables mobile; version **1.4.9**, minimum host **1.11.4**, settings schema 2,
search compatibility and tokenizer caps are unchanged.

The historical readiness evidence below describes the earlier desktop-only baseline.
It is retained verbatim as historical evidence, and is not evidence of the new candidate's
performance or mobile compatibility. Candidate checks and raw reports are delivered with
the task's exact commit and tree; loopback/browser diagnostics require separate permission.

---

# Mobile readiness execution evidence

Work is isolated on `refactor/mobile-readiness`, based on
`213f926d4ae7726ef23233f8488a1ad055d37470`, in
`/home/kenan/Secret-Projects/obsidian-card-workspace-mobile-readiness`.
The original workspace is not an installation or test target.

## WP-0 baseline

- Linux x64 Node 22.18.0, bundled npm 10.9.3; independent `npm ci`.
- Actual manifest/package version is **1.4.9** (the AGENTS.md overview is stale).
  Preserve that version, desktop-only declaration and minimum host 1.11.4.
- Full chain passed: lint, TypeScript, Svelte (zero warnings), production build,
  174 test files / 3653 passing tests / one skipped test.
- Search smoke and full: 9/9 correctness assertions in each profile.
- Detailed logs and diagnostic JSON are retained under the worktree's private
  `.dev/mobile-readiness/baseline/`. Browser diagnostics use synthetic vaults,
  temporary browser profiles and local fixtures. They do not measure real host
  disk IO, Electron peaks or mobile device compatibility.
- `.dev` is an independent copy, not the original companion symlink. Initial
  contents are archived in `.dev/mobile-readiness/docs-initial.tar.gz`.
- Desktop defaults to preserve: preview reads 5, prewarm 6, late marker 120ms;
  preview cache 512 entries / diagram Blobs 16MiB; source cache 64 / estimated
  16MiB; search readers 8, batches 200, ingest budget 20,000; thumbnails memory
  64 / 16MiB, persisted 2000 / 256MiB; images 50,000,000 bytes/pixels, edge 1024,
  one cold task. Per-view caches multiply with open views; none is a process
  memory ceiling. Search compatibility caps remain separate.

## Implemented boundaries

- Platform support is immutable and injected through `RuntimePlatformServices`.
  Shared actions/controllers consume the facade; only composition and desktop
  adapters reach the native implementations. Unsupported commands/settings/menu
  rows disappear, direct calls return unavailable, and a persisted window-open
  preference resolves to `smart` at runtime without a settings write.
- Budgets live in `src/runtime/resource-budget.ts`, outside settings. Resource
  owners receive the same policy, including the Worker message's image limits.
  Small-budget tests cover pools, batches/order, cache eviction and image bounds.
- `RuntimeActivity` combines main/popout document visibility and tracks each card
  region separately, with observer and layout/geometry fallback. Work gates are
  abortable and terminal on close. No blur or active-leaf inference is used.
- Automatic preview/thumbnail admission and full-source reads/ingest pause;
  incremental consistency, file writes, transactions and quick-input retries
  continue. Resume validates the latest demand and discards obsolete prewarm.
- Hidden source mutations cancel replacement work and release its journal. Retry
  coalesces with another successful rebuild. Marker cleanup completes before the
  next guarded build. Actual reconcile replacements are guarded lazily; an
  unchanged catalog read pass still never marks an attempt.
- Diagnostics expose counters/cache occupancy/paused state and six aggregate
  timing slots on demand. At most 16 views are expanded; totals cover all views.
  These counters do not estimate total renderer or native decoder memory.

## Source commits

| Package | Commit |
| --- | --- |
| WP-0 baseline | `bb3b890` |
| WP-1 platform isolation | `45be36f` |
| WP-2 resource budgets | `72d0638` |
| WP-3 cooperative scheduling | `4c74a76` |
| WP-4 bundle guard / diagnostics | `92ddc05` |
| Lifecycle audit follow-up | `500457c` |

## Ordinary verification

The final source candidate is `500457cbc3c13d663403622ec81d3811ef36289a`.
The full required chain passed using Linux Node 22.18.0 / npm 10.9.3:

- ESLint: no errors or warnings.
- TypeScript: passed.
- Svelte: zero errors and warnings.
- Minified production build: externals/sourcemap checks passed.
- Production bundle admission: passed with native modules rejected, process and
  Buffer removed, and explicit Obsidian/CodeMirror host substitutes. Startup,
  actual Svelte cards, menus, legacy settings, unsupported calls, unavailable
  IndexedDB search blocking and bounded view diagnostics were exercised.
- Vitest: 179 files passed; **3696 tests passed, one existing skip**.

The manifest, versions map and lockfile remain byte-for-byte unchanged from the
base commit. Settings schema 2, index phase3-v2, token caps, indexed-only search,
source projection and supported card kinds retain their contracts.

## Performance diagnostics and acceptance gap

**Implementation and ordinary validation pass; strict performance acceptance is
not fully achieved.** The existing thresholds and report meanings are unchanged.
The final serial run uses the frozen source candidate above and baseline
`213f926`, synthetic fixtures, and the same Node/Chromium installation.

| Diagnostic | Final result | Baseline evidence / limits |
| --- | --- | --- |
| Search smoke / full | Pass, 9/9 content assertions each | Existing fixture and token contracts |
| Search XL content | Pass, 9/9 content assertions | Same 28,620 documents as baseline |
| XL budgeted ingest | Pass, 32.538ms | 300ms gate; baseline 32.163ms |
| XL `toJSON` slice | **Fail, 780.043ms** | 750ms gate; unchanged baseline also fails at 778.338ms |
| XL structured clone | Pass, 332.426ms | 750ms gate; baseline 332.814ms |
| Full image diagnostic | Resource/layout/format checks pass; **one timing gate fails** | 120 measurement/resource rows, 9 cache cases, 30 samples after 5 warmups |
| Node search preview | Pass, all 34 gates | 20 samples after 5 warmups |
| Browser search preview | Pass, all 48 gates and 60 layout checks; no browser errors | 20 samples after 5 warmups |

The image failure is `long/4/right` text readiness: p95 **25.00ms**, limit
**22.38ms**. A separate focused run uses only unchanged `213f926` source in both
lanes, preserving the harness's off-versus-images comparison. It reproduces the
same failure at **35.10ms / 22.16ms**, plus publication and byte-boundary timing
failures. Resource correctness still passes. These observations establish that
the failing scenarios also exist on the baseline; they do not establish a
universal absence of performance regressions. The XL serialization and image
latency gates remain explicit acceptance gaps. Index serialization, search
contracts and thresholds were not changed to make these diagnostics pass.

The original WP-0 image smoke and browser preview runs also had timing failures;
their default historical comparison refs differ, so they are retained as initial
evidence rather than treated as the final direct baseline comparison. The first
post-change diagnostic attempt is retained separately. The focused baseline
image run initially failed to load sources because `git archive` inherited the
nested snapshot directory prefix. Its corrected run sets `GIT_DIR` to this
worktree's git directory and `GIT_WORK_TREE` to the archived baseline root; the
load failure is retained as `baseline-images-focused-load-failure.*`.

A compact, tracked [validation record](mobile-readiness-validation.json) contains
exit codes, gate results, report hashes and artifact paths. Full-chain logs and
the serial diagnostic runner are retained under `.dev/mobile-readiness/`.

## Retained artifacts and limitations

Raw logs and JSON are in `.dev/mobile-readiness/baseline/` and
`.dev/mobile-readiness/final/`. The first diagnostic attempt is retained in
`.dev/mobile-readiness/diagnostic-attempt-1/`; failures are not removed or hidden.
Final comparisons freeze baseline `213f926` and use the existing thresholds.

The independent developer-doc copy is accompanied by
`.dev/mobile-readiness/docs-initial.tar.gz`,
`.dev/mobile-readiness/development-docs.patch`, and
`.dev/mobile-readiness/docs-snapshot-verification.json`. All 284 files in the
original companion snapshot were compared byte for byte and remain unchanged.
The patch applies only this task's changes to the four architecture/pattern docs.

Remaining mobile work includes touch entry points, soft keyboard behavior, back
navigation, stable vault identity, device settings isolation and device-specific
budgets. Real Obsidian disk IO, native memory peaks and mobile device acceptance
are outside these synthetic diagnostics. The desktop-only declaration and
minimum host 1.11.4 are unchanged. This branch is not merged, pushed or released.
