# Native properties in quick-input drafts

Implementation and validation record, 2026-10-20. User behavior is documented in [note-input.md](note-input.md).

## Behavior and ownership

Quick input shows Obsidian’s native Properties component for ordinary flat frontmatter. It edits the same complete CodeMirror document as the body; a direct state-field decoration displays the component in place of YAML. Properties and body share the native scroll area. **Edit YAML** reveals the complete source; **Show properties** restores the panel without changing text. Drafts have no note file or workspace leaf, and values stay in memory until the existing submission service runs.

`src/input/draft-frontmatter.ts` validates supported values and updates a YAML document tree using the bundled ISC-licensed `yaml` library. Changes preserve comments, scalar styles, list-item comments, ordering and body text. Untouched drafts are not serialized. Changed YAML whitespace may be normalized. Nested values, non-text lists, duplicate/unsupported keys, anchors/aliases and malformed YAML stay in source form. Missing/incompatible native component capabilities also retain the Markdown editor and source.

`src/input/native-properties-editor.ts` owns the optional native component, source toggle, display decorations, YAML synchronization and cleanup. A ResizeObserver requests native layout measurements when properties fold or change height. A YAML-only draft without a final newline retains an editable line; the first body input supplies the separator within that input transaction. Opening it alone does not modify its text.

`src/input/native-markdown-editor.ts` owns the editor and shared focus scope for the whole editor container. Modern host keymaps bind scopes to `activeWindow`, so activation establishes the owning document before pushing the scope. Per-app focus ownership avoids restoring a disposed sibling editor. The owner exposes its editor before initial non-empty `set()` emits selection events and supplies the native scroll callback.

Submission flushes a focused property control before capturing its immutable request. Ctrl/Cmd+Enter stays in the child document and reaches the draft root before a host completion scope can consume it. Properties become inert and the Markdown state, editable facet and content attributes become read-only during submission. Frozen retries preserve that lock. The explicit content attribute is necessary because native dynamic extensions otherwise force `contenteditable=true` even when the editable facet is false.

Native property types use Obsidian’s vault-wide metadata type manager. A draft has no file context, so links resolve from the vault root. Source rendering and native menus retain host behavior; physical IME, other-plugin interactions and native Windows/macOS focus still require platform acceptance.

## Reproduce

Build the current production bundle, then run against an isolated application:

```sh
npm run build
node scripts/run-quick-input-properties-obsidian.mjs \
  --executable /absolute/path/to/obsidian \
  --version 1.14.4 \
  --asar /absolute/path/to/obsidian-1.14.4.asar \
  --output /absolute/path/to/properties-report.json \
  --xvfb
```

The script copies the production `main.js` and styles into a generated temporary vault/profile. It applies no editor shims or runtime replacement property components. It exercises the installed implementation, writes a schema-v2 JSON report and `-preview.png`, then removes the temporary vault/profile. `--asar` is optional and installs an application package only in that profile; an older package cannot override a newer bundled application. Omit `--xvfb` on a real desktop.

## Real application coverage

The production harness verifies:

- Native properties mount in the owning child document with no file and no duplicate YAML display.
- Native folding/resizing, text, number, checkbox, date, tag and list editing, and child-window tag completion.
- Comment and quote retention, rename/add/delete, and property undo/redo independent of the preceding field edit.
- Switching to YAML, editing the actual native document, and returning to synchronized properties.
- Two independent drafts and zero vault mutation events before Send.
- Direct sibling-to-property focus, Ctrl+Enter with an uncommitted date, pending-request locks for properties and Markdown, exact saved text and an untouched sibling.
- Malformed/nested YAML source fallback and recovery without text loss.
- First body input into a YAML-only template without a trailing newline, while preserving untouched input.
- Disposal of native components, editor DOM and plugin-owned windows without page errors.

| Application | Runtime | Result |
| --- | --- | --- |
| Obsidian 1.11.4 | Linux, Electron 39.8.3, Xvfb/software rendering | Passed |
| Obsidian 1.14.4 | Linux, Electron 39.8.3, Xvfb/software rendering | Passed |

Both application checks use an extracted official 1.12.7 Linux installer. For 1.11.4, the temporary installation’s bundled `resources/obsidian.asar` is replaced with the official 1.11.4 application package. For 1.14.4, its application package is loaded from the temporary profile. The script asserts the actual API version. These are application compatibility checks on the stated Electron runtime, not historical-installer or Windows acceptance.

- [1.11.4 production report](../diagnostics/quick-input-properties-production-1.11.4-20261020.json), [preview](../diagnostics/quick-input-properties-production-1.11.4-20261020-preview.png)
- [1.14.4 production report](../diagnostics/quick-input-properties-production-1.14.4-20261020.json), [preview](../diagnostics/quick-input-properties-production-1.14.4-20261020-preview.png)

The existing independent-window acceptance harness also passes on 1.14.4, including ten drafts, untouched siblings, dragging, pinning, incremental theme changes, main-window hiding, shortcut registration, Ctrl+Enter submission and unload. Windows/macOS, physical IME and mixed-DPI behavior remain unverified.

## Automated checks and earlier evidence

The repository validation chain passes: lint, TypeScript, Svelte, production build and **172 test files, 3,562 passed, 1 skipped**. Tests include supported YAML round-tripping and source fallback, source/display switching, cross-document property-input flushing, frozen request ownership and local shortcut routing.

The earlier schema-v1 [1.11.4](../diagnostics/quick-input-properties-1.11.4-20261020.json) and [1.14.4](../diagnostics/quick-input-properties-1.14.4-20261020.json) reports record the feasibility prototype, which used diagnostic owner shims and displayed YAML beside the panel. They are retained as historical evidence; the schema-v2 production reports above use the actual implementation.
