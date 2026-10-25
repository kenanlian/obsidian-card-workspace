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
