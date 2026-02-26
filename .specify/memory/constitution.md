<!--
Sync Impact Report
- Version change: 0.0.0 (template) -> 1.0.0
- Modified principles:
  - Principle slot 1 -> I. 性能优先 (Performance First)
  - Principle slot 2 -> II. 本地优先与隐私 (Local-first & Privacy)
  - Principle slot 3 -> III. 无缝集成 (Native Feel)
  - Principle slot 4 -> IV. 高内聚低耦合 (Modular Design)
- Added sections:
  - Development Guidelines
  - Delivery Workflow & Quality Gates
- Removed sections:
  - Principle slot 5 placeholder section
- Templates requiring updates:
  - ✅ updated: .specify/templates/plan-template.md
  - ✅ updated: .specify/templates/spec-template.md
  - ✅ updated: .specify/templates/tasks-template.md
  - ✅ verified (no files present): .specify/templates/commands/*.md
  - ✅ updated: README.md
  - ✅ updated: AGENTS.md
- Follow-up TODOs:
  - None
-->
# Folder Card Explorer Constitution

## Core Principles

### I. 性能优先 (Performance First)
Obsidian is a note-taking app first; plugin features MUST NOT block UI responsiveness.
Any potentially expensive parsing, indexing, filtering, or rendering work MUST run
asynchronously or be chunked so user input and scrolling stay responsive. Every feature
spec and plan MUST declare expected runtime cost, main-thread impact, and mitigation.

Rationale: Performance regressions directly degrade core note-taking flow and make the
plugin feel unreliable even when functionality is correct.

### II. 本地优先与隐私 (Local-first & Privacy)
The plugin MUST prioritize local vault processing. External network requests MUST NOT be
introduced unless explicitly required by an approved feature spec, with documented user
value, data scope, consent mechanism, and failure fallback. Vault content MUST be handled
locally by default and MUST NOT be transmitted off-device without an explicit decision.

Rationale: This preserves Obsidian's local-first trust model and minimizes privacy risk.

### III. 无缝集成 (Native Feel)
UI and interaction behavior MUST align with Obsidian conventions. Styling MUST prefer
Obsidian theme variables and built-in class patterns before custom overrides. New UI
elements MUST behave consistently in light/dark themes and SHOULD use established control
patterns (`setting-item`, `mod-cta`, and related native semantics) when applicable.

Rationale: Native-feeling UX reduces user friction, avoids theme breakage, and lowers
long-term maintenance cost.

### IV. 高内聚低耦合 (Modular Design)
Business logic in TypeScript MUST be isolated from rendering and Obsidian-specific wiring.
Svelte components MUST focus on presentation/state orchestration, while pure data and
transformation logic MUST remain independently testable outside the Obsidian runtime.
New features MUST keep clear boundaries between view, domain logic, and platform adapters.

Rationale: Clear separation enables safer refactors, targeted tests, and easier debugging.

## Development Guidelines

- **TypeScript**: `strict` mode MUST stay enabled. `any` is prohibited except for bounded
  third-party compatibility edges with inline justification. Public or shared structures
  MUST be modeled via `interface` or `type`.
- **Svelte**: Cross-component state MUST use Svelte stores when state leaves a single
  component boundary. `onMount` and `onDestroy` lifecycle hooks MUST be used correctly for
  subscriptions and listeners to avoid memory leaks.
- **Obsidian API**: Access to `app.workspace`, `activeLeaf`, and similar nullable values
  MUST use defensive null checks (including optional chaining where appropriate). Commands,
  views, settings tabs, and event hooks MUST be registered through cleanup-safe APIs and
  MUST be released on unload.
- **Code quality**: AI-generated non-trivial logic MUST include concise JSDoc describing
  intent, inputs, outputs, and invariants. Naming MUST follow camelCase/PascalCase/
  UPPER_SNAKE_CASE conventions.
- **UI styling**: Obsidian native classes and CSS variables MUST be preferred before
  plugin-specific styles to preserve theme compatibility.

## Delivery Workflow & Quality Gates

- Every spec and plan MUST include a Constitution Check that demonstrates compliance with
  all four core principles before implementation begins.
- Task breakdowns MUST include explicit work items for performance validation, lifecycle
  cleanup, privacy/network impact checks, and modular boundary enforcement.
- Any feature that proposes external network access MUST include written approval in the
  spec, user-visible behavior, data boundaries, and offline fallback before coding starts.
- Pull requests MUST include validation evidence from `npm run check` and `npm run build`.
- Runtime guidance in `AGENTS.md` and user-facing guidance in `README.md` MUST stay aligned
  with this constitution whenever governance rules change.

## Governance

- This constitution overrides conflicting local process notes for architecture, quality
  gates, and delivery decisions.
- Amendment process: propose changes in a PR with (1) rationale, (2) impacted principles
  and templates/docs, (3) migration notes for in-flight work. At least one maintainer
  approval is required before merge.
- Versioning policy follows semantic versioning for governance:
  - MAJOR: backward-incompatible principle removals or redefinitions.
  - MINOR: new principle/section or materially expanded mandatory guidance.
  - PATCH: wording clarifications, typo fixes, or non-semantic refinements.
- Compliance review expectations:
  - Planning review: Constitution Check MUST pass before Phase 0/Phase 1 outputs finalize.
  - Implementation review: tasks and PR description MUST map changes to principles.
  - Release review: `npm run check` and `npm run build` results MUST be recorded.

**Version**: 1.0.0 | **Ratified**: 2026-02-26 | **Last Amended**: 2026-02-26
