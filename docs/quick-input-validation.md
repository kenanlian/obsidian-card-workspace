# Independent quick input validation

Implementation validation record, 2026-10-18. User behavior and setup are described in [note-input.md](note-input.md).

## Automated checks

Full validation chain **passed**:

```sh
npm run lint && npm run check && npm run check:svelte && npm run build && npm test
```

Vitest: **168 files passed; 3,436 tests passed, 1 skipped** (3,437 total). Svelte check: zero errors/warnings. Production artifact/external/sourcemap contract check passed. The final run includes closed-editor notifications, footer controls, native regions/zoom/reset ownership, persistent document markers and opacity preparation during delayed window initialization.

Coverage includes independent documents/handles, rapid opens, window-local composition and pinning, frozen submission retries, close/unload completion guards, mixed-content cleanup, invalid restored tokens, content dimensions, source/mouse screen selection and work-area clamping, shortcut registration/conflicts/clearing/save retries, per-vault ownership, settings migration/serialization, shared legacy/native settings controls, and lazy editor ownership. Existing NoteCreationService tests verify simultaneous writes to the same target and submission deduplication.

The Obsidian 1.11.4 and 1.14.4 distributions were inspected to verify the host's `titlebarStyle`, per-document `electronWindow`, Electron remote bridge, popout initialization and sizing. 1.11.4 shows popouts synchronously; 1.14.4 queues its show in a microtask. 1.11.4 replaces body classes during host state relays; 1.14.4 preserves added classes. Public APIs used for the new view/window lifecycle predate 1.11.4; minimum supported version remains unchanged.

## Real host acceptance

This Linux workspace has no Windows/macOS Obsidian host. All entries below are **not run** for the updated build. No Windows/macOS desktop compatibility pass is claimed.

| Platform | Obsidian version | Result |
| --- | --- | --- |
| Windows | 1.11.4 | Not run |
| Windows | 1.14.4 / installer 1.12.7 (user-reported environment) | Not run |
| Windows | Stable version at acceptance time (record exact version then) | Not run |
| macOS | 1.11.4 | Not run |
| macOS | Stable version at acceptance time (record exact version then) | Not run |

For every row, record OS/build, Obsidian/installer version, frame mode and result for:

- Obsidian/hidden frame appearance, drag region and native edge resizing; native frame rejection before opening. Change frame settings without restarting and confirm detection still follows the running frame; fully restart to apply.
- Multiple blank drafts, per-window pinning, source-screen and mouse-screen placement, negative-coordinate/mixed-DPI displays, and unaffected main/ordinary/mixed-content windows.
- Minimize the main window and continue Chinese IME input, Markdown editing, undo and sending. With another app focused, use the global shortcut and verify only the new quick-input window is shown/focused.
- Shortcut unset by default; explicit Apply/Clear, OS and multi-vault conflicts, startup failure status, failed settings persistence and retry.
- Send failure/retry, simultaneous same-target writes, system close during a pending send, and closing one draft without changing others or card scope.
- Close vault, unload/reload plugin, quit/restart Obsidian; no restored empty drafts, and closed editors/listeners/window references released.

macOS application hiding, Spaces/fullscreen coverage and Linux Wayland behavior are outside the promised pin/shortcut acceptance scope.

Reference contracts: [Obsidian API](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts), [Electron globalShortcut](https://www.electronjs.org/docs/latest/api/global-shortcut), [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window).

## Follow-up: outer frame and repeated opens

The dedicated marker now lives on `html`, keeping styling and window ownership checks independent of host body-class relays. The document clears outer app/horizontal/tab containers and host tab outlines as well as leaf chrome. The colored card fills the native contour without a second outer outline, shadow or scale/fade animation. On Windows the native drawing/hit-test region uses the Send button's computed radius and the target window's zoom factor; resize/focus updates changed regions, and mixed-content/close cleanup resets only applied regions. macOS retains its system contour. The pin remains before the destination at the bottom left, the top contains only the drag grip, and Cancel discards the draft.

Browser layout checks with Obsidian 1.11.4's stylesheet verified viewport coverage and footer layout at 320×200, 480×270 and 800×600 in custom/hidden frame modes. Region tests separately cover four-corner clipping, edge/center coverage, symmetry, radius clamping, zoom, an initially stale renderer size, cached updates and reset ownership.

Windows/macOS preparation now conceals only the new window with opacity, without calling native hide/show. This avoids reactivating the entry window when hiding the host's initially focused popout, including the newer queued-show flow. Existing drafts are raised before creation and during preparation; completion only raises/reveals/focuses the new draft. Linux retains the hide/show fallback because native opacity is unsupported there. Deferred-initialization tests verify that older windows never receive hide/show or opacity changes; body-class replacement does not remove their marker. Mixed-content windows and failures in older handles remain covered.

## Follow-up: transparent Windows window, resizing and repeated opens

User reports on Windows showed the system's own rounded border and shadow outside the clipped region, a white background flashing during edge resizing, and an earlier draft blanking until the next draft appeared. Window regions cannot remove the system frame, are not anti-aliased, and update after the renderer's resize event, so Windows drafts now request a transparent native window at creation instead.

- Obsidian 1.11.4 and 1.14.4 create popouts through `window.open("about:blank", "_blank", "popup,...")`. Their main process overrides only position, size and background; Electron 39 (installer 1.12.7) merges the remaining parsed features beneath those overrides. During the synchronous `openPopoutLeaf` call, the plugin rewrites only that popup request to `background=#00000000,transparent=yes` and restores `window.open` afterwards. If no such request is observed, the previous region/opacity path remains.
- Transparent drafts clear host container backgrounds, hide the host's initial empty tab by its `data-type` until the quick-input view replaces it, and draw the card contour with the Send button's radius in CSS. They use no native region and no opacity/hide concealment.
- Transparent Windows windows lack the native thick frame, so eight card-edge handles resize the window with pointer capture, Electron cursor coordinates and `setBounds`, both in DIPs, while preserving the 320×200 minimum.
- Every quick-input window disables background throttling while it exclusively hosts a draft, so covering it with the entry window does not stop its compositor. Mixed-content windows and cleanup restore throttling.

Automated tests cover the request rewrite and restoration, platform and URL exclusions, edge geometry, the transparent manager path, and throttling ownership. Windows host acceptance for these changes is **not run**.

## Isolated host diagnostics

Obsidian **1.11.4 and 1.14.4** both passed an isolated-vault/profile diagnostic using the official Linux **1.12.7 installer (Electron 39.8.3)** under Xvfb. The diagnostic selected the Windows branch only inside the test runtime, traced calls through the desktop adapter and subscribed to native show/hide/focus events. It held the second view's initialization pending for 120ms, allowing the host's queued show and focus/style relays to run, then completed it and disposed the manager.

For both versions:

- Main, first draft and second draft had distinct native handles. Adapter operations never targeted the main handle.
- Existing drafts stayed mapped/visible during the delay. Neither draft received plugin hide/show calls; the first draft received no repeated native show or hide event.
- X11's native stacking query placed the first draft above the main window during the delay, and the second above the first after completion.
- X11's native shape query returned the applied rounded regions (29 merged rectangles per default-size draft), with all four square corners excluded and a computed Send radius of 24px.
- Both document markers survived actual host focus/body relays, and disposal removed the owned leaves.

These diagnostics validate real Obsidian lifecycle/handles and native X11 regions/stacking requests. Linux opacity is a no-op, and Xvfb has no window manager; this does **not** verify the Windows compositor, visual activation transitions, native resize hit testing, macOS behavior or physical multi-screen/IME interactions. Those remain in the acceptance matrix above.
