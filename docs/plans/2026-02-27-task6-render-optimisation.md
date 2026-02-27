# Task 6: Large-List Render Optimisation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce unnecessary computation and improve perceived load speed for large note folders by removing image preview, eliminating array cloning, making height tracking incremental, and rendering card previews progressively.

**Architecture:** Four independent optimisations applied in dependency order. Tasks 1-2 are pure deletions (safest). Task 3 changes how `FolderCardView` pushes state to the Svelte component. Task 4 changes how `FolderCardPanel` tracks measured card heights. No new abstractions are introduced.

**Tech Stack:** TypeScript (strict), Svelte 4, esbuild. No test framework — validation is `npm run check && npm run build`.

---

## Validation command (run after every task)

```bash
npm run check && npm run build
```

Expected: zero TypeScript errors, `main.js` emitted successfully.

---

### Task 1: Remove image preview entirely

**Files:**
- Modify: `src/view/types.ts`
- Modify: `src/view/FolderCardView.ts`
- Modify: `src/view/FolderCardPanel.svelte`
- Modify: `styles.css`
- Modify: `src/view/markdown-utils.ts`

This is a pure deletion task. Remove every trace of cover image handling.

**Step 1: Remove `cover` from `NoteCardRecord`**

In `src/view/types.ts`, delete the `cover` field from the `NoteCardRecord` interface:

```ts
// DELETE this line:
cover: string | null;
```

**Step 2: Remove image imports and calls in `FolderCardView.ts`**

In `src/view/FolderCardView.ts`:

1. On the import line at the top, remove `extractFirstInlineImage`, `pickFrontmatterImage`, and `resolveImageSource` from the import of `./markdown-utils`. If that leaves the import empty, delete the whole import line.

2. In `loadFolder` (around line 301-318), remove the `pickFrontmatterImage` / `resolveImageSource` block and the `cover` field from each record literal:

```ts
// DELETE these lines inside records.map():
const frontmatterCover = pickFrontmatterImage(
  cache?.frontmatter as Record<string, unknown> | undefined,
);
// and:
cover: frontmatterCover ? resolveImageSource(this.app, frontmatterCover, file) : null,
```

3. In `hydrateCard` (around line 513-518), delete the inline-image extraction block:

```ts
// DELETE:
if (!card.cover) {
  const firstInlineImage = extractFirstInlineImage(markdown);
  if (firstInlineImage) {
    card.cover = resolveImageSource(this.app, firstInlineImage, card.file);
  }
}
```

**Step 3: Remove cover rendering from `FolderCardPanel.svelte`**

Delete the entire `{#if card.cover}` block in the card template:

```svelte
<!-- DELETE: -->
{#if card.cover}
  <img class="fce-cover" src={card.cover} alt={card.title} loading="lazy" />
{/if}
```

**Step 4: Remove `.fce-cover` CSS rule from `styles.css`**

Delete:

```css
.folder-card-view .fce-cover {
  width: 100%;
  height: 112px;
  object-fit: cover;
  border-bottom: 1px solid var(--fce-border);
}
```

**Step 5: Remove dead functions from `markdown-utils.ts`**

Delete the three exported functions that are now unused:
- `extractFirstInlineImage`
- `pickFrontmatterImage`
- `resolveImageSource`

Also delete the private helper `cleanupImageTarget` and `decodeURIComponentSafe` — they are only used by `resolveImageSource`. Confirm no other callers exist by searching for these names.

**Step 6: Validate**

```bash
npm run check && npm run build
```

Expected: zero errors.

**Step 7: Commit**

```bash
git add src/view/types.ts src/view/FolderCardView.ts src/view/FolderCardPanel.svelte styles.css src/view/markdown-utils.ts
git commit -m "feat: remove image preview from cards"
```

---

### Task 2: Remove `[...this.cards]` shallow clone in `pushState`

**Files:**
- Modify: `src/view/FolderCardView.ts`

`pushState` currently accepts a `cloneCards` boolean (default `true`) and does `[...this.cards]` to force Svelte to detect array changes. This is unnecessary: Svelte `$set` always triggers a re-render for the given prop regardless of reference equality.

**Step 1: Simplify `pushState`**

Replace the current implementation:

```ts
private pushState(cloneCards = true): void {
  this.component?.$set({
    cards: cloneCards ? [...this.cards] : this.cards,
    folderPath: this.folderPath ?? "",
    selectedPath: this.selectedPath,
    loading: this.loading,
    generation: this.generation,
  });
}
```

With:

```ts
private pushState(): void {
  this.component?.$set({
    cards: this.cards,
    folderPath: this.folderPath ?? "",
    selectedPath: this.selectedPath,
    loading: this.loading,
    generation: this.generation,
  });
}
```

**Step 2: Fix all call sites**

Search for `pushState` calls in `FolderCardView.ts`. Any call that passes `false` (e.g. `this.pushState(false)`) should become `this.pushState()`. There should be approximately 3 call sites total.

**Step 3: Validate**

```bash
npm run check && npm run build
```

Expected: zero errors.

**Step 4: Commit**

```bash
git add src/view/FolderCardView.ts
git commit -m "perf: remove unnecessary cards array clone in pushState"
```

---

### Task 3: Progressive pushState — update UI per batch during hydration

**Files:**
- Modify: `src/view/FolderCardView.ts`

Currently `hydrateRange` waits for all cards to finish before calling `pushState` once. This means users see nothing until every visible card finishes loading. Splitting into batches of 5 shows the first previews faster.

**Step 1: Add `HYDRATION_BATCH_SIZE` constant**

Near the top of the `FolderCardView` class body (alongside other private fields), add:

```ts
private static readonly HYDRATION_BATCH_SIZE = 5;
```

**Step 2: Replace `hydrateRange` implementation**

Current implementation (around line 467-496):

```ts
private async hydrateRange(start: number, end: number): Promise<void> {
  if (this.cards.length === 0 || this.loading) {
    return;
  }

  const generation = this.generation;
  const targets: number[] = [];
  const safeStart = Math.max(0, start);
  const safeEnd = Math.min(this.cards.length, end);

  for (let index = safeStart; index < safeEnd; index += 1) {
    const card = this.cards[index];
    if (!card || card.hydrated || this.pendingHydration.has(index)) {
      continue;
    }
    this.pendingHydration.add(index);
    targets.push(index);
  }

  if (targets.length === 0) {
    return;
  }

  await Promise.all(targets.map((index) => this.hydrateCard(index, generation)));

  targets.forEach((index) => this.pendingHydration.delete(index));
  if (generation === this.generation) {
    this.pushState();
  }
}
```

Replace with:

```ts
private async hydrateRange(start: number, end: number): Promise<void> {
  if (this.cards.length === 0 || this.loading) {
    return;
  }

  const generation = this.generation;
  const targets: number[] = [];
  const safeStart = Math.max(0, start);
  const safeEnd = Math.min(this.cards.length, end);

  for (let index = safeStart; index < safeEnd; index += 1) {
    const card = this.cards[index];
    if (!card || card.hydrated || this.pendingHydration.has(index)) {
      continue;
    }
    this.pendingHydration.add(index);
    targets.push(index);
  }

  if (targets.length === 0) {
    return;
  }

  const batchSize = FolderCardView.HYDRATION_BATCH_SIZE;
  for (let batchStart = 0; batchStart < targets.length; batchStart += batchSize) {
    if (generation !== this.generation) {
      break;
    }

    const batch = targets.slice(batchStart, batchStart + batchSize);
    await Promise.all(batch.map((index) => this.hydrateCard(index, generation)));

    batch.forEach((index) => this.pendingHydration.delete(index));

    if (generation === this.generation) {
      this.pushState();
    }
  }
}
```

**Step 3: Validate**

```bash
npm run check && npm run build
```

Expected: zero errors.

**Step 4: Commit**

```bash
git add src/view/FolderCardView.ts
git commit -m "perf: progressive pushState per hydration batch"
```

---

### Task 4: Incremental heights update in virtual scroll

**Files:**
- Modify: `src/view/FolderCardPanel.svelte`

Currently when any card's height changes, `heights = heights` triggers a full O(n) rebuild of the `positions` array via Svelte reactivity. Instead, update `positions` imperatively in `measureHeight` — only recompute from the changed index onwards.

**Step 1: Convert `positions` and `totalHeight` to non-reactive imperative variables**

Replace the current reactive block and declarations:

```svelte
let heights = [];
let positions = [];
let totalHeight = 0;

$: {
  let y = 0;
  let newPositions = new Array(cards.length);
  for (let i = 0; i < cards.length; i++) {
    newPositions[i] = y;
    y += heights[i] || ESTIMATED_CARD_HEIGHT;
  }
  positions = newPositions;
  totalHeight = y;
}
```

With:

```svelte
let heights: number[] = [];
let positions: number[] = [];
let totalHeight = 0;

function rebuildPositionsFrom(fromIndex: number): void {
  const start = Math.max(0, fromIndex);
  let y = start === 0 ? 0 : (positions[start] ?? 0);
  // Recompute start position from scratch if fromIndex is 0,
  // otherwise trust positions[start] is already correct.
  if (start === 0) {
    for (let i = 0; i < cards.length; i++) {
      positions[i] = y;
      y += heights[i] || ESTIMATED_CARD_HEIGHT;
    }
  } else {
    // Re-anchor y to the actual position of `start`
    y = positions[start] ?? 0;
    for (let i = start; i < cards.length; i++) {
      positions[i] = y;
      y += heights[i] || ESTIMATED_CARD_HEIGHT;
    }
  }
  totalHeight = y;
  positions = positions; // single reactive assignment to trigger viewport recalc
}
```

**Step 2: Trigger full rebuild when `cards` or `generation` changes**

Replace the reactive statement that currently clears `heights` on generation change:

```svelte
$: if (generation !== lastHydrateGeneration) {
  lastHydrateGeneration = generation;
  lastRangeStart = -1;
  lastRangeEnd = -1;
  heights = [];
}
```

With:

```svelte
$: if (generation !== lastHydrateGeneration) {
  lastHydrateGeneration = generation;
  lastRangeStart = -1;
  lastRangeEnd = -1;
  heights = [];
  positions = [];
  totalHeight = 0;
  rebuildPositionsFrom(0);
}
```

Also add a reactive statement to rebuild when `cards.length` changes (new folder loaded):

```svelte
$: if (cards.length !== positions.length) {
  rebuildPositionsFrom(0);
}
```

**Step 3: Update `measureHeight` to call `rebuildPositionsFrom`**

Replace the current `measureHeight` action body that does `heights = heights`:

```svelte
// REPLACE:
if (heights[index] !== roundedHeight) {
  heights[index] = roundedHeight;
  heights = heights; // trigger reactivity
}
```

With:

```svelte
if (heights[index] !== roundedHeight) {
  heights[index] = roundedHeight;
  rebuildPositionsFrom(index);
}
```

**Step 4: Remove the old reactive positions block**

The `$: { let y = 0; ... positions = newPositions; }` block from Step 1 has already been removed. Double-check there is no leftover reactive block referencing `heights`.

**Step 5: Validate**

```bash
npm run check && npm run build
```

Expected: zero errors.

**Step 6: Commit**

```bash
git add src/view/FolderCardPanel.svelte
git commit -m "perf: incremental positions rebuild in virtual scroll height tracking"
```

---

### Task 5: Mark Task 6 complete in dev_plan.md

**Step 1: Update dev_plan.md**

In `dev_plan.md`, change:

```
- [ ] Task 6. [P0] 优化大列表渲染路径...
```

to:

```
- [x] Task 6. [P0] 优化大列表渲染路径...
```

**Step 2: Commit**

```bash
git add dev_plan.md
git commit -m "docs: mark Task 6 as completed in dev_plan"
```
