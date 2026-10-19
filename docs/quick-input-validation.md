# Custom desktop quick input validation

Implementation validation record, 2026-10-19. User behavior and setup are described in [note-input.md](note-input.md).

## Window and editor ownership

New drafts use same-origin `about:blank` desktop windows. They do not call `workspace.openPopoutLeaf`, construct workspace leaves, or participate in layout persistence. The old quick-input view remains registered only to discard restored layout entries.

The desktop adapter requests an initially hidden, transparent window with no system frame, thick frame, native rounded corners or shadow. It observes Electron's actual `did-create-window` constructor options and checks the target native window ID before allowing the document to become ready. Ignored options, missing capabilities and native-frame mode fail before any draft is revealed. Neither the host's `window.open` nor its main-process open handler is replaced.

Each document loads the installed host's local `enhance.js`, relays existing styles in cascade order, and incrementally synchronizes theme classes and font variables. CodeMirror owns its own generated styles. Host window-decoration classes are excluded. The existing native editor adapter still supplies Markdown editing and focus scopes; keyboard events reach the vault's keymap with cancellation reflected back to the originating document.

The manager mounts the complete card/editor, synchronously measures layout, then shows and focuses the new window. It deliberately does **not** wait for `requestAnimationFrame`: the isolated host demonstrated that an initially hidden Electron window can withhold frames even with background throttling disabled. Existing drafts are raised without focus, concealment, opacity changes or DOM/editor replacement. An older request that finishes late is shown without stealing focus from the newest draft.

Abort signals close documents still initializing. Cancel, native window close, resource failure, the 10-second initialization deadline and plugin unload release the owned editor, event routing, observers and native-window references. Submission/retry ownership remains with the existing note creation service.

## Automated checks

Run the repository validation chain:

```sh
npm run lint && npm run check && npm run check:svelte && npm run build && npm test
```

Tests cover independent drafts and pins, constructor-option verification, target-handle ownership, ignored options, source/mouse screen placement, negative work areas, unsupported frames, pending-resource cancellation/timeouts, late initialization, close during initial layout, editor focus scopes, incremental theme/cascade changes, keyboard cancellation, native editor failure, frozen retries and submitted writes completing after their window closes.

The full chain passes: **170 test files, 3,441 tests passed and 1 skipped**. Production externals and sourcemap checks pass. No settings schema/version migration is required.

## Isolated real-host diagnostics

The harness creates its own temporary vault and profile, copies the current production bundle and styles, and never opens an existing vault:

```sh
node scripts/run-quick-input-obsidian.mjs \
  --executable /absolute/path/to/obsidian \
  --version 1.14.4 \
  --asar /absolute/path/to/obsidian-1.14.4.asar \
  --output /absolute/path/to/report.json \
  --xvfb
```

`--asar` is optional and installs an **updated** host package only inside the generated profile. To check an older application version, provide an isolated executable installation containing that version. `--xvfb` is for Linux virtual-display runs; omit it on a real desktop. The harness writes a JSON report and a companion card screenshot.

| Environment | Version | Result |
| --- | --- | --- |
| Linux, official 1.12.7 installer / Electron 39.8.3, Xvfb/software rendering | Obsidian 1.11.4 | Passed |
| Linux, same installer and display setup | Obsidian 1.14.4 | Passed |
| Windows | 1.11.4 and 1.14.4 / installer 1.12.7 | Not run |
| macOS | Supported host versions | Not run |

Obsidian 1.14.4 also passed three consecutive complete runs. Both isolated application versions verify:

- Native Markdown input (including inserted Chinese text), undo and redo; child Ctrl+Enter saves once and closes only its own window.
- No workspace leaf/chrome in drafts; target native handles differ from the main handle; actual constructor options match the requested hidden, transparent, undecorated window.
- A previous draft remains visible with its text intact while the next document is held pending; it receives no native hide event.
- Independent pin state, incremental light-theme/font changes and transparent document/body backgrounds.
- Opening a draft while the main window is hidden does not restore the main window.
- Successful global-shortcut registration and release; ten independent visible draft windows.
- Native window close, cancellation during initialization, and plugin unload release every quick-input window and the shortcut while preserving existing host windows.

The harness leaves any first-run native Settings window open and records pre-existing native window IDs, so teardown assertions cover only plugin-owned windows. A diagnostic that closed Settings before opening the first draft intermittently produced three stackless `illegal access` errors before quick-input work began. Electron documents a shared Node-loop teardown defect for same-process child windows ([upstream fix](https://github.com/electron/electron/pull/52964)); the isolated test no longer tears down unrelated host UI as part of its setup. Runtime page errors during the quick-input scenarios remain failing assertions.

Renderer screenshots have transparent pixels at all four outer corners. This validates the document contour, **not Windows DWM compositing**. Xvfb has no window manager, so the run does not establish physical stacking, minimize animations, Windows resize rendering or macOS behavior. Programmatically inserting Chinese text does not validate physical IME composition; registering a shortcut does not validate activation from another application.

## Windows acceptance still required

Record OS/build, Obsidian application and installer versions, frame style, theme and display scaling for:

- Light/dark themes against light, dark and colored desktop backgrounds: no white corner areas or second outline, including while resizing.
- 100%, 125%, 150% and 200% scaling; mixed-DPI displays, negative screen coordinates and display changes.
- Ten successive opens through the navigation button, command and global shortcut: earlier drafts never blank or disappear during preparation; focus ends in the newest draft.
- Main window minimized, another application focused: physical global shortcut opens only the draft; Chinese IME, normal editor shortcuts, paste, undo/redo and sending continue to work.
- Per-window pinning, drag grip, all eight resize handles, minimum size and configured sizes for new drafts.
- Invalid destinations, failed send/retry, cancellation, system close during a send, plugin reload, vault close and application restart.

Use Obsidian or hidden frame mode and fully restart after changing the frame setting. Native frame mode remains explicitly unsupported. macOS Spaces/fullscreen/application hiding and Linux Wayland are outside the verified platform behavior.
