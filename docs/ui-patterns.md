# UI Patterns

## Purpose

Use this file for the host/Svelte boundary, interaction contracts, virtualization, hydration, modal handling, and styling rules. For architecture-level ownership, read `docs/architecture.md`.

## UI Ownership Map

| Surface | Owns | Must not own |
| :--- | :--- | :--- |
| `src/view/FolderCardPanel.svelte` | root render tree, virtual list, row projection, event fanout to host callbacks | plugin lifecycle, canonical query/index state |
| `src/view/Toolbar.svelte` | controls for sort, tags, search, folder scope, bulk actions | durable settings truth or card collections |
| `src/view/CardItem.svelte` | single-card presentation, pin/bulk/open/context/hover intent surface | cross-card coordination, persistence |
| `styles.css` | design tokens, Obsidian theme integration, global plugin styling contract | runtime logic |

## Host-Driven UI Pattern

1. `FolderCardView.ts` builds the canonical render state.
2. `panel-model.ts` publishes snapshots with `subscribe()` / `mutate()`.
3. `FolderCardPanel.svelte` renders that snapshot and wires callbacks.
4. User intent travels back to the host via explicit callback props.
5. The host updates state, reprojects cards, and publishes the next snapshot.

Rule: Svelte components render and emit intent. They do not become the source of truth for cards, search readiness, or persisted behavior.

## Interaction Contracts

- **Open note** — card click/intention returns a path to the host; `main.ts` owns final open-target behavior.
- **Pin toggle** — event returns card path; host updates `pinnedPaths`; pipeline reapplies ordering.
- **Tag filter** — toolbar updates active tags; host reruns pipeline with AND semantics.
- **Search** — toolbar updates runtime `searchQuery`; host debounces query execution and projects blocked/ready states.
- **Bulk selection** — host owns selected paths, anchor path, and bulk action enablement.
- **Folder scope** — folder picker/tree emits folder intent; host owns scope normalization and reloads.
- **Context menu / hover preview** — UI exposes surface events; host integrates with Obsidian menus and hover-link APIs.

## Virtualization and Hydration Constraints

- `FolderCardPanel.svelte` is the virtualization boundary.
- Render rows from projected cards, not from raw vault order.
- Hydration must stay lazy and viewport-driven after startup prewarm.
- Startup prewarm only targets the first 6 visible candidates and waits at most 120ms.
- Do not couple preview hydration to scroll-unaware eager rendering.

## Component-Local State Rules

Allowed local state:

- focus/hover flags
- open/closed menu state
- transient input text before callback dispatch
- measured DOM values needed for rendering

Disallowed local truth:

- canonical card arrays
- persisted sort/filter settings
- search readiness or index health
- plugin-wide selection/bulk truth

## Modal and Confirmation Pattern

- Modal orchestration stays host-owned in `FolderCardView.ts` or `main.ts`.
- Svelte components should emit intent; they should not directly own destructive flows.
- Confirmation copy and buttons should map to typed outcomes already used by note operations.
- Deletion behavior must continue to respect Obsidian `Files & Links` preferences.

## Styling Conventions

- Keep styling in the flat `styles.css` file.
- Prefer existing `.fce-*` class patterns and design tokens.
- Map colors and surfaces to Obsidian theme variables instead of fixed app-specific colors.
- Treat iconography and placeholder text for non-markdown cards as part of the stable mixed-file UI contract.

## Common Failure Modes

- Putting host state into Svelte-local stores or runes.
- Updating UI order without going back through host projection.
- Breaking virtualization by assuming every card is mounted.
- Hydrating previews eagerly for off-screen cards.
- Letting component-local state drift from host truth after async updates.

## Change Checklist

- Does the host still own the canonical state and all durable decisions?
- Do callbacks carry intent back to `FolderCardView`/`main.ts` instead of mutating local truth?
- Does the change preserve virtualization and lazy hydration?
- Are destructive actions still host-mediated and preference-aware?
- Did styling reuse existing `styles.css` tokens and `.fce-*` patterns?
