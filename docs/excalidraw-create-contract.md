# New drawing view contract

Investigated offline on 2026-10-17. This is source inspection and unit regression evidence, not host acceptance.

## Local references

- Installed Excalidraw build: `~/Obsidian/Card-Workspace-Hermes-Test/.obsidian/plugins/obsidian-excalidraw-plugin/main.js`, manifest version **2.29.0**, SHA-256 `86027c9f881d70069f40d1fdf63d38868c606c8000169d730cc68c62a6978a77`. This local build was not compared with an upstream release; no network source was fetched.
- Installed Obsidian **1.13.4**: `/Applications/Obsidian.app/Contents/Resources/obsidian.asar` → `app.js`, SHA-256 `8173a8631d7bf6096e32d303b13c80e2995076970ed8a77afb11d8b8c5d8e7d1`.
- Public Obsidian typings: `WorkspaceLeaf.setViewState`, `getViewState`, and `loadIfDeferred` (available since 1.7.2, below this plugin's minimum version).

The installed bundles can be inspected read-only by searching the following function names. No test vault files or plugin settings were changed during development.

## Findings

Excalidraw registers the `excalidraw` view in `onload`. Its factory returns `ExcalidrawLoading` until `isReady` becomes true. Obsidian's community-plugin manager `getPlugin(id)` returns a loaded registry instance or null; the component's `_loaded` flag and the host's `viewRegistry.getViewCreatorByType(type)` identify whether the instance and registered view are available. These registry/readiness fields are internal compatibility seams and are checked at runtime; an unsupported host or plugin fails closed with the localized install/enable notice.

Excalidraw's `patchWorkspaceLeafExcalidrawDefault` intercepts a requested `markdown` view only when `fileShouldDefaultAsExcalidraw` sees cached frontmatter containing `excalidraw-plugin`. A new `.excalidraw.md` filename alone does not satisfy it. The old Card Workspace flow wrote the Markdown container and immediately used its ordinary card opener, so it could remain in Markdown before metadata indexing finished.

The local plugin's `createDrawing(filename, folder, initialData)` writes a file, then polls `isExcalidrawFile` with bounded sleeps. Its `createAndOpenDrawing` calls `openDrawing`, whose `PluginFileManager` implementation delegates to `openLeaf`/`leaf.openFile`. `openDrawing` does not return the opening promise. Merely awaiting that wrapper would not prove the requested view opened, and metadata-dependent takeover remains involved.

The plugin's own `setExcalidrawView(leaf, options)` instead awaits `leaf.setViewState` with type `excalidraw` and the file's view state. Card Workspace now uses that same registered type with `{file: created.path, active: true}` on a fresh tab, awaits deferred loading and validates the resulting type and file. It retains the existing valid empty Markdown drawing container and collision resolver. No polling, metadata subscription, extension-only detection, plugin settings mutation or invented creation API is used.

Availability is checked before leaving a box/links scope, again after that awaited transition, and after writing before opening. If the plugin unloads during the write, the completed valid file remains and the user receives an opening-failure notice; no tab is allocated. Write failures create no tab. View failures detach only the new tab, preserve the file and report the opening failure. Existing card opens and other file creation paths retain their existing behavior.

## Regression evidence and remaining host checks

Before implementation, the focused regression `opens the first view as a drawing even before metadata recognizes the file` failed with actual `['markdown']` versus expected `['excalidraw']` (exit 1). The regression harness deliberately keeps metadata absent and simulates ordinary Markdown opening; it does not invent an Excalidraw creation/opening method. After implementation the folder-action and menu tests pass, including unavailable/disabled/loading/unregistered capability, localized notices, root/nested paths, collisions, source transitions, write and view failures, and Canvas/Base/note independence.

Hermes independently reproduced the baseline defect in the isolated test vault with installed Card Workspace 1.4.3, Excalidraw 2.29.0 and Obsidian 1.13.7. Invoking the folder create action initially opened the new drawing as `markdown` while frontmatter was absent. After metadata acquired `excalidraw-plugin: parsed` and Excalidraw recognized the file, the view still remained Markdown. This confirms the creation/open-before-metadata race in the installed baseline; it is not a host test or acceptance of this fix candidate.

Real Obsidian create → draw → save → reopen, disabled/missing-plugin behavior and existing-file behavior remain for independent Hermes verification in an isolated vault. User UI/UX acceptance is separate. See the reproduction steps in [diagram-previews.md](diagram-previews.md).
