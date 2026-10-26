# Image verification

Run the normal validation chain:

```sh
npm run lint && npm run check && npm run check:svelte && npm run build && npm test
```

The image tests enforce byte/pixel checks before read/decode, one cold task, shared generation and display URLs, stale-result rejection, memory and persistent LRU limits, metadata retries, outside-folder attachment invalidation, isolated image publication, mode/fit settings, and cleanup. The Chromium smoke run in CI enforces browser resource/read contracts and records machine-dependent timings without blocking CI on speed.

Install Chromium once with `npx playwright install chromium`. Run the full same-machine diagnostic:

```sh
npm run benchmark:images -- --output /absolute/path/card-images.json
```

The runner freezes baseline `60724aceb4cfebffad3e4d26d8f7043271f6749d` using `git archive`, builds baseline and candidate real Svelte panels, and generates local Markdown and PNG fixtures. Defaults are five warmups and 30 measured samples. It covers no images, mixed and dense images, 8K, long screenshots, repeated attachments, inclusive byte/pixel boundaries and rejected over-budget inputs, with 1/2/4 columns and off/right/inline layouts. Measurements include lightweight record preparation, the production projection, Svelte card publication, visible text hydration and ready-search-result rendering; first image completion is outside the text metric. Before each sample it restores the browse membership and waits for browser work to settle; search is measured separately. Markdown is loaded from a local File into the synthetic Vault cache before measurement. Text timings therefore cover production preview preparation/rendering, rather than Obsidian disk latency, and add no artificial timer delays.

Off card-publish/search P95 gates are baseline × 1.05 + 2 ms. Enabled card-publish/visible-text P95 gates are baseline × 1.10 + 5 ms. Timing violations exit nonzero unless `--diagnostic-only` is passed. Deterministic resource/read failures always fail. `--smoke --samples 3 --warmups 1` is a smaller contract check, not the delivery timing run.

Use `--scenarios pixel-boundary,byte-boundary --columns 4` for a focused rerun. `--trace /absolute/path/chromium-trace.json` additionally records a Chrome trace for diagnosing long tasks; tracing changes timings, so use an untraced run for the delivery gates.

Each baseline/candidate mode uses a separate browser context and renderer, so preceding mode scroll/decoder teardown cannot enter its samples. Each renderer still runs all five warmups and 30 consecutive measurements. Repeated lifecycle and cache transitions are checked separately.

The 50 ms image-task gate measures viewport/source resolution, Worker construction/dispatch and image-only panel publication through Svelte's DOM flush. Global browser long tasks are retained separately: repeated text/search rendering can trigger V8 collector pauses, and those are not automatically attributed to an image task. Use a trace to investigate them; passing the image-task gate does not mean the browser had no global long tasks.

The report also verifies cold, memory and fresh-service persistent hits; only cold reads the repeated original. Visible-text completion is observed once per animation frame, without adding DOM measurements to production hydration callbacks. Scroll diagnostics track main-thread long tasks, original-read peak, live display URLs, Blob limits and cleanup. An isolated synthetic Vault uses native `File.arrayBuffer()` reads of local fixtures in place of `vault.readBinary`; this does not measure disk behavior in Obsidian. Search supplies ready indexed membership to the production pipeline and does not measure MiniSearch query/indexing time. Run in a quiet environment and retain the report, including any failures.

For the actual desktop host, use a Linux Obsidian executable and Xvfb:

```sh
npm run benchmark:images:obsidian -- --executable /absolute/path/obsidian --output /absolute/path/desktop-images.json
```

This creates its own temporary vault/profile, copies the built plugin, instruments only that copy, and launches a real Obsidian window. It checks default-off image reads, cold 8K/long/regular fixtures, both embed syntaxes, output and CSS dimensions, scroll down/back, a forced cached-scope refresh, layout switching, a second view, a fresh thumbnail service reading persistent storage, ten toggle cycles, object-URL release and post-GC heap snapshots. It writes a screenshot beside the report and removes the temporary vault/profile afterward. Renderer RSS is sampled every 10 ms around cold generation; it includes the decoder, UI and browser caches. Chromium's internal decoder allocation is not separately exposed. Coded pixels, one original read/generation, and resized bitmap output are checked separately. Native renderer RSS and scroll experience on the user's display remain useful checks when releasing.

Saved delivery artifacts: [Chromium report](../diagnostics/card-images-20261002.json), [Obsidian desktop report](../diagnostics/card-images-obsidian-20261002.json), and [desktop screenshot](../diagnostics/card-images-obsidian-20261002-inline.png). The saved desktop report's `default-off` phase reflects the default before the 1.3.4 release; 1.3.4 defaults to **Right thumbnail** with **Crop to fill**. The desktop run uses Obsidian 1.13.7 under Xvfb; its persistent-hit phase recreates the thumbnail service in the same host, rather than restarting the whole application.

The saved Chromium run contains 120 baseline/candidate rows and nine cache rows, with five warmups and 30 measured samples each. All P95 and instrumented image-task gates pass. Maximum image timings are 0.9 ms for viewport resolution, 3 ms for image-only publication, 6 ms for Worker availability/construction and 0.3 ms for dispatch. Cold repeated-attachment samples read one original; memory and fresh-service persistent samples read zero. A 55 ms **global** task remains recorded in the dense/four-column/right case; this run does not claim zero global long tasks or establish that task's cause. Scroll diagnostics report no global long tasks. The real desktop report passes its read, concurrency, layout, refresh, scrolling and cleanup assertions, with no long tasks in its image phases.


For the mobile-adaptation fixed baseline, retain the ordinary off-versus-images report
and additionally compare identical modes:

```sh
npm run benchmark:images -- --baseline 6aeaf3d32c126876116d09d0028a48fa0a7c8d9d --output /absolute/path/off-versus-images.json
npm run benchmark:images -- --baseline 6aeaf3d32c126876116d09d0028a48fa0a7c8d9d --same-image-modes --output /absolute/path/same-image-modes.json
```

`--same-image-modes` freezes the baseline image implementation as well as its panel,
then runs off/right/inline in both lanes. It preserves sample counts and thresholds;
its separate `comparison` report field distinguishes it from the original report.
Both commands start a loopback HTTP server. Do not run them without the task's explicit
network authorization. Neither substitutes for Android/iOS/iPadOS validation.
