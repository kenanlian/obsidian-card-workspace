---
name: obsidian-plugin-docs
description: Obsidian plugin developer documentation reference. Use when Codex needs official guidance for building or maintaining Obsidian plugins, including plugin anatomy, development workflow, editor APIs, UI components (commands/settings/views), vault/files, events, performance/security guides, and release/submission requirements.
---

# Obsidian Plugin Docs

## Overview

Use the bundled references to answer questions about Obsidian plugin development using the official developer docs.

## Quick start

- Open `references/index.md` to locate the right module.
- Load only the module file(s) needed for the task.
- If a question spans multiple areas, combine the relevant module files.

## Reference map

- `references/index.md`: module index and lookup guidance.
- `references/getting-started.md`: build a plugin, anatomy, workflow, mobile dev, React/Svelte usage.
- `references/editor.md`: editor APIs, extensions, decorations, markdown post processing, state, view plugins, viewport.
- `references/ui.md`: commands, settings, views, workspace, ribbon, status bar, icons, modals, RTL, HTML elements.
- `references/vault.md`: vault, file system, and adapter usage.
- `references/events.md`: event hooks and lifecycles.
- `references/guides.md`: performance, secrets, bases view, pop-out windows, deferred views.
- `references/releasing.md`: guidelines, submission requirements, release automation, beta testing.

## Usage notes

- Prefer the most relevant module file over broad loading.
- When unsure which module applies, start with `references/index.md`.
- If official docs change, refresh the references from the upstream developer docs repository.
