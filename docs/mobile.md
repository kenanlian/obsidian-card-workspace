# Mobile usage and validation

Card Workspace 1.4.9 supports desktop, Android and iOS/iPadOS with Obsidian 1.11.4 or later.
Mobile support is enabled in the manifest. Real-device acceptance of this candidate is
pending; synthetic host tests establish implementation contracts, not device results.

Open Card Workspace from its ribbon or command. Enabling the plugin does not create a
page. Desktop continues to use the left sidebar; mobile uses a main workspace tab and
reuses that page on later opens. Startup restores only the saved folder, including vault
root, and clears the active box without changing shared settings.

Phones show one card column. Navigation opens in an Obsidian Modal; selecting a scope
closes it. Tablets use two panes only when the container is at least 640px and fits the
saved navigation width plus 320px for cards. Rotation, split view and keyboard resizing
update layout without loading the scope again. Cards remain virtualized and hydrate on
demand. Menus have tap buttons and a 500ms long press, canceled by more than 8px movement,
scroll, release, cancellation or another pointer. Desktop right-click and drag remain.

The mobile card menu includes insertion and copying for links, embeds, content and title
plus content, with the same file-kind restrictions and heading sections as desktop drops.
Before opening cards, visit a Markdown editor. Insertion uses the primary cursor saved
when leaving that editor and does not replace its selection. The menu names the target.
Editing, closing, switching or renaming that target invalidates insertion; return to the
note and reopen cards to select it again. With no target, copying remains available;
clipboard failure opens selectable text. Pin, bulk selection, pinned-order and navigation
ordering controls use the existing host actions and sorting rules.

Quick input opens one host Modal per plugin instance, filling the available phone viewport
or centered on a tablet. Native Markdown/Properties editing is reused when available;
otherwise the full Markdown document remains editable in a source textarea. Explicit
opening requests focus. IME composition blocks sending. Submission flushes active property
input and freezes the request; pending and failed retries stay read-only and reuse the
same submission identity. Closing a changed nonempty draft requires confirmation; closing
a pending submission waits. Drafts live only in memory and are never sent in the background.

Scope navigation participates in Obsidian's view history. Committed folder, box and links
switches record history; refreshes, preview updates, failures, superseded requests and
links-follow do not. History loads through the same scope controller and pipeline. Reading
anchors are runtime-only, bounded per leaf, and do not enter plugin settings. The Back
button calls an optional checked host history bridge; if unavailable, use Obsidian's own
back control. The plugin does not intercept Android's global Back event. Host keyboard,
menu and Modal dismissal retain their normal precedence.

## Device settings and cache identity

All workspace settings are vault-local device overrides. Local preferences include sort,
links sort, grouping, subfolders, view type, backlink snippet count, card radius/font/density/
style, preview and search snippet counts, image mode/fit, navigation counts/order/visibility,
visible property keys, hover preview size and quick-input size/color/global shortcut.
The local record is versioned separately from the shared schema-2 document. Initial values
come from existing shared settings; startup does not rewrite them. A real device change
writes only the local record, and shared saves retain the shared document's initial device
values. Other preferences and all user data remain shared: boxes, favorites, pins,
templates, manual sorting and search history. Local failures retain session memory, show
a notice and remain visible in runtime diagnostics; they never redirect writes to shared
storage. Future shared or local schemas are protected from writes.

Mobile cache identity is a random UUID in Obsidian's vault-specific local storage. Search
and thumbnails reuse the same resolved identity; equal display names and vault renames
cannot cross caches. Local storage failure disables persistent caches for the session and
uses an isolated runtime identity. Desktop retains path namespaces. IndexedDB failure
retains the indexed-only nonempty-search blocking behavior.

Policy is chosen once by device class and deeply frozen. Phone/tablet preview concurrency
is 2/3, prewarm 3/4, preview entries 128/256 and diagram capacity 4/8 MiB; search-preview
entries 24/32 and capacity 4/8 MiB. Search readers are 2/4, batches 100/150 and ingest term
budgets 10,000/15,000. Thumbnail memory is 16/32 entries and 4/8 MiB, disk 500/1,000 entries
and 64/128 MiB. Images accept up to 20/30 million bytes, 16/24 million pixels and output
edges 768/1,024. Cold image tasks remain one; the late-prewarm marker remains 120ms.
Desktop values, search-content limits and tokenizer caps are unchanged. Hidden work still
uses the existing work gates; incremental consistency and writes do not wait on them.

## Candidate installation and real-device acceptance

Copy the candidate `main.js`, `manifest.json` and `styles.css` into a test vault's
`.obsidian/plugins/card-workspace/` directory, enable community plugins, then enable
Card Workspace. Do not install into another working vault without its owner's choice.
Use command palette → **Card Workspace: Open Card Workspace view** (or the ribbon) and
**Card Workspace: Open quick input**. Retain the exact candidate commit/tree with the results.

Record device model, OS, Obsidian version, orientation, input method, result and exact
failure steps independently for Android phone, iPhone and iPad. Android tablet remains
unverified until separately tested.

1. Enable/disable, open repeatedly, restart, and browse Markdown/Base/Canvas/Excalidraw.
   Confirm a single reused page, folder-only restart restore and no eager image reads.
2. Long press and tap menus, scroll during a press, use bulk operations and manual order.
   Test valid insertion, source sections, copy fallback, selected text preservation,
   one-step undo and refusal after target edit/close/switch/rename.
3. Use Chinese IME in search and quick input. Check keyboard-safe search results, cursor
   and Send, unchanged focus during preview publication, discard confirmation, blocked
   pending dismissal, failed retries and no duplicate note writes.
4. Test Android system Back and iOS host Back with keyboard, menus, navigation and quick
   input open. Then test folder → box → links history and restored reading position;
   history exhaustion must return control to Obsidian.
5. Rotate, split iPad view and use an external keyboard at widths down to 320px. Check
   safe areas, 44px main controls, dialog scrolling and background/resume with no deadlock
   or stale card publication.
6. Create two equal-name vaults, restart and rename display names; verify cache isolation.
   On multiple devices, change appearance/workspace state and confirm it stays local,
   while boxes/favorites/pins/templates continue to sync.

Automated validation is the complete lint/type/Svelte/production-bundle/Vitest chain.
Node diagnostics compare the fixed baseline and candidate with the same dependencies,
fixtures and seeds, serially. Browser and image diagnostics use loopback HTTP and require
separate task permission. Existing XL serialization over 750ms and image/text-ready p95
gaps remain explicit performance concerns; previous branch evidence cannot certify this
candidate. No mobile-device performance or subjective UX acceptance is implied by a
successful synthetic run.
