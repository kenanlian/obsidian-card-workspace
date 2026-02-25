---
name: opencode-config
description: Answer OpenCode configuration questions from official docs and safely edit opencode.json.
metadata:
  docs_base: https://opencode.ai/docs/
  config_file: opencode.json
---

## What I do
- Answer OpenCode configuration questions by referencing official docs (link the exact page).
- Propose and apply changes to opencode.json with minimal edits.
- Keep secrets safe: never echo existing keys; ask for new secrets if needed.

## When to use me
- Questions about config schema, providers, permissions, tools, rules, agents, models, network, formatters, themes, keybinds, commands, LSP/MCP/ACP, skills, or custom tools.
- Requests to update opencode.json.

## How to answer
- Start with the direct answer in Chinese.
- Cite the official docs URL(s) used.
- If the docs are unclear or multiple options exist, ask one focused question.

## How to edit opencode.json
- Read the C:\Users\kenan.lian\.config\opencode\opencode.json and keep valid JSON.
- Touch only relevant keys and preserve formatting.
- Avoid removing unrelated settings.
- For secrets: use placeholders or prompt the user; never print existing secret values.

## Docs index
- See .opencode/skills/opencode-config/references/index.md for the full sitemap.
- Use webfetch to read linked pages when needed.

## Notes
- Do not store full doc pages in the repo unless explicitly asked.
- If docs change, update docs/index.md and the per-page pointers.
