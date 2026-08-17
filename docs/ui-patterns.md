# UI Patterns

## Purpose

Use this file for the host/Svelte boundary, grouped panel publish, interaction contracts, virtualization, hydration, modal handling, and styling rules. For architecture-level ownership, read `docs/architecture.md`.

Do not catalog every `PanelModelState` field here. Group names and publish semantics are the load-bearing contract; field shapes live in `src/view/panel-model.ts`.

## UI Ownership Map

| Surface | Owns | Must not own |
| :--- | :--- | :--- |
| `src/view/FolderCardPanel.svelte` | root render tree, virtual list, row projection, event fanout to host callbacks, composing the navigation column | plugin lifecycle, canonical query/index state |
| `src/view/NavigationPane.svelte` | two-column nav: favorites, folder/tag/box trees, resize handle, section collapse | durable settings truth or card collections |
| `src/view/TreeSection.svelte` | one collapsible tree section inside the nav pane | cross-section layout or persistence |
| `src/view/Toolbar.svelte` | controls for sort, tags, search, scope label, bulk actions | durable settings truth or card collections |
| `src/view/CardItem.svelte` | single-card presentation, pin/bulk/open/context/hover intent surface | cross-card coordination, persistence |
| `src/view/modals/` | modal content and submit/close semantics (`FormModal` subclasses) | becoming the source of truth for cards or settings |
| `styles.css` | design tokens, Obsidian theme integration, global plugin styling contract | runtime logic |

## Host-Driven UI Pattern

1. `FolderCardView` (via controllers) builds the canonical render state.
2. `panel-model.ts` publishes **grouped** snapshots. `mutate` / `batch` replace assigned groups wholesale and notify listeners once; unpublished groups keep their object identity so Svelte can skip them.
3. `FolderCardPanel.svelte` renders that snapshot and wires callbacks, including `NavigationPane`.
4. User intent travels back to the host via explicit callback props.
5. The host updates state, reprojects cards if needed, and publishes the next groups.

Rule: Svelte components render and emit intent. They do not become the source of truth for cards, search readiness, or persisted behavior.

## Grouped panel publish

`PanelModelState` is a record of named groups. The host never patches a field inside a live group; it builds a replacement object for that group. Group shapes live in `src/view/panel-model.ts`.

Two publish entry points, two axes:

- **`publishGroups`** — runtime events name the groups to rebuild (hydration finished, search snapshot arrived, selection changed). Nested `batch` calls still notify once when the outermost batch exits.
- **`publishForIntent`** — translates a settings update grade into an explicit group set (`patch` refreshes chrome/scope; `reproject` / `rehydrate` refresh cards and projection; `reload` rebuilds every group).

Do not collapse those axes into a single `publish(intent)` that also handles runtime events. Runtime events have no settings intent.

## Interaction Contracts

- **Open note** — card click/intention returns a path to the host; `main.ts` owns final open-target behavior.
- **Pin toggle** — event returns card path; host updates pin state; pipeline reapplies ordering.
- **Tag filter** — toolbar updates active tags; host reruns pipeline with AND semantics on folder scope. Box scope does not apply the browse tag filter.
- **Search** — toolbar updates runtime `searchQuery`; host debounces query execution and projects blocked/ready states.
- **Bulk selection** — host owns selected paths, anchor path, and bulk action enablement.
- **Scope** — folder/box/tree intent returns a `CardScope`; the host loads it. Settings `lastFolderPath` / `activeBoxId` are written afterwards as session projections, not used to decide what to show.
- **Context menu / hover preview** — UI exposes surface events; host integrates with Obsidian menus and hover-link APIs.
- **Navigation chrome** — pane width and section collapse are presentation; they persist in workspace settings and publish as `patch`.

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
- runtime `CardScope`

## Modal and Confirmation Pattern

- Modal *implementations* live in `src/view/modals/` and share `FormModal`.
- Modal *orchestration* stays host-owned: actions/menus construct and open a modal; Svelte components emit intent and do not own destructive flows.
- Submit is single-flight: a second trigger while submit is in flight must not run `handleSubmit` again.
- If `handleSubmit` returns false or throws, the modal stays open. The caller shows a `Notice`; the base class does not swallow the error.
- Once the modal is closed (`contentEl.isConnected === false`), it must not render again.
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
- Mutating a panel group in place instead of replacing it.
- Notifying listeners once per group instead of once per batch.
- Breaking virtualization by assuming every card is mounted.
- Hydrating previews eagerly for off-screen cards.
- Letting component-local state drift from host truth after async updates.
- Opening a destructive flow from Svelte without going through host-routed modals.

## Change Checklist

- Does the host still own the canonical state and all durable decisions?
- Do callbacks carry intent back to `FolderCardView` / `main.ts` instead of mutating local truth?
- Are panel updates grouped, wholesale, and single-notify?
- Does the change preserve virtualization and lazy hydration?
- Are destructive actions still host-mediated through `src/view/modals/` and preference-aware?
- Did styling reuse existing `styles.css` tokens and `.fce-*` patterns?
