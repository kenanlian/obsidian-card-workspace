<script lang="ts">
  import { setIcon, setTooltip } from "obsidian";
  import { getUiStrings, type UiStrings } from "../i18n";
  import type { PanelAppearanceState } from "./panel-model";
  import CardTaskFooter from "./CardTaskFooter.svelte";
  import {
    TASK_CHIP_KINDS,
    buildTaskPlainText,
    buildTaskTextSegments,
    countSubtasks,
    readTaskDateParts,
    resolveTaskDueState,
    taskItemId,
    type TaskChipKind,
  } from "./task-card-display";
  import type {
    TaskCardItem as TaskItem,
    TaskCardRecord,
    TaskContextMenuPayload,
    TaskDatePayload,
    TaskOpenPayload,
    TaskTogglePayload,
  } from "./types";

  interface TaskCardItemProps {
    task: TaskCardRecord;
    /** Local `YYYY-MM-DD`; drives due urgency and whether chip dates show a year. */
    today: string;
    strings?: UiStrings;
    appearance?: PanelAppearanceState;
    pendingIds?: ReadonlySet<string>;
    pendingStatuses?: Record<string, boolean>;
    /** Touch devices use larger date chips and hit areas. */
    touch?: boolean;
    searchQuery?: string;
    onTaskToggle?: (payload: TaskTogglePayload) => void;
    onTaskDate?: (payload: TaskDatePayload) => void;
    onTaskOpen?: (payload: TaskOpenPayload) => void;
    onTaskContextMenu?: (payload: TaskContextMenuPayload) => void;
  }

  /** Mirrors the stored ➕ ✅ 📅 markers; the editor date buttons use the same icons. */
  const CHIP_ICONS: Record<TaskChipKind, string> = {
    created: "plus",
    done: "check",
    due: "calendar",
  };
  const NO_PENDING: ReadonlySet<string> = new Set();

  let {
    task,
    today,
    strings = getUiStrings("en"),
    appearance = { cardCornerRadius: "compact", previewLines: 5, searchPreviewSnippetCount: 2 },
    pendingIds = NO_PENDING,
    pendingStatuses = {},
    touch = false,
    searchQuery = "",
    onTaskToggle,
    onTaskDate,
    onTaskOpen,
    onTaskContextMenu,
  }: TaskCardItemProps = $props();

  const viewStrings = $derived(strings.tasks.view);
  const pickerStrings = $derived(strings.tasks.datePicker);
  const progress = $derived(countSubtasks(task));
  const showFile = $derived(appearance.taskCardShowFile === true);
  const currentYear = $derived(today.slice(0, 4));
  const backgroundColor = $derived(appearance.cardBackgroundOverrides?.[task.filePath] ?? appearance.cardBackgroundColor ?? "theme");

  /**
   * The checkbox shows the requested state while the host write is pending;
   * an entry is dropped as soon as its id is no longer pending, whatever the outcome.
   */
  let optimistic = $state<Record<number, boolean>>({});
  $effect(() => {
    const lines = Object.keys(optimistic);
    if (lines.length === 0) return;
    const stale = lines.filter((line) => !pendingIds.has(taskItemId(task.filePath, Number(line))));
    if (stale.length === 0) return;
    const next = { ...optimistic };
    for (const line of stale) delete next[Number(line)];
    optimistic = next;
  });

  function isPending(item: TaskItem): boolean {
    return pendingIds.has(taskItemId(task.filePath, item.line));
  }

  function shownCompleted(item: TaskItem): boolean {
    const shared = pendingStatuses[taskItemId(task.filePath, item.line)];
    return isPending(item) ? shared ?? optimistic[item.line] ?? item.completed : item.completed;
  }

  function formatChipDate(value: string): string {
    const parts = readTaskDateParts(value);
    return parts ? viewStrings.chipDate(parts.year, parts.month, parts.day, String(parts.year) !== currentYear) : value;
  }

  function chipLabel(kind: TaskChipKind, value: string | null, completed: boolean): string {
    const parts = value === null ? null : readTaskDateParts(value);
    const shown = value === null ? pickerStrings.notSet : parts ? viewStrings.fullDate(parts.year, parts.month, parts.day) : value;
    const due = kind === "due" ? resolveTaskDueState(value, completed, today) : null;
    const status = due === "overdue" ? viewStrings.dueOverdue : due === "today" ? viewStrings.dueToday : undefined;
    return viewStrings.chipLabel(pickerStrings.kinds[kind], shown, status);
  }

  function opensNewTab(event: MouseEvent | KeyboardEvent): boolean {
    return event.metaKey || event.ctrlKey || ("button" in event && event.button === 1);
  }

  function openItem(event: MouseEvent | KeyboardEvent, item: TaskItem): void {
    onTaskOpen?.({
      filePath: task.filePath,
      line: item.line,
      lineText: item.lineText,
      ...(opensNewTab(event) ? { destination: "new-tab" as const } : {}),
    });
  }

  function openFile(event: MouseEvent): void {
    onTaskOpen?.({ filePath: task.filePath, ...(opensNewTab(event) ? { destination: "new-tab" as const } : {}) });
  }

  function handleAuxClick(event: MouseEvent, open: () => void): void {
    if (event.button !== 1) return;
    event.preventDefault();
    open();
  }

  function handleTextKeydown(event: KeyboardEvent, item: TaskItem): void {
    if (event.isComposing) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!event.repeat) openItem(event, item);
      return;
    }
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      emitContextMenu(item, { position: { x: rect.left, y: rect.bottom } });
    }
  }

  function emitContextMenu(item: TaskItem, trigger: { mouseEvent?: MouseEvent; position?: { x: number; y: number } }): void {
    onTaskContextMenu?.({ filePath: task.filePath, line: item.line, lineText: item.lineText, text: item.text, ...trigger });
  }

  function handleContextMenu(event: MouseEvent, item: TaskItem): void {
    if (!onTaskContextMenu) return;
    event.preventDefault();
    emitContextMenu(item, { mouseEvent: event });
  }

  function toggle(item: TaskItem): void {
    if (isPending(item)) return;
    const completed = shownCompleted(item);
    optimistic = { ...optimistic, [item.line]: !completed };
    onTaskToggle?.({
      id: taskItemId(task.filePath, item.line),
      filePath: task.filePath,
      line: item.line,
      lineText: item.lineText,
      completed,
    });
  }

  function editDate(event: MouseEvent, item: TaskItem, kind: TaskChipKind): void {
    if (isPending(item)) return;
    onTaskDate?.({
      id: taskItemId(task.filePath, item.line),
      filePath: task.filePath,
      line: item.line,
      lineText: item.lineText,
      kind,
      value: item.dates[kind],
      anchor: event.currentTarget as HTMLElement,
    });
  }

  function applyIcon(node: HTMLElement, iconName: string): { update: (next: string) => void } {
    setIcon(node, iconName);
    return { update: (next) => setIcon(node, next) };
  }

  function applyTooltip(node: HTMLElement, text: string): { update: (next: string) => void } {
    setTooltip(node, text, { placement: "top" });
    return { update: (next) => setTooltip(node, next, { placement: "top" }) };
  }
</script>

{#snippet taskRow(item: TaskItem, depth: number)}
  {@const pending = isPending(item)}
  {@const completed = shownCompleted(item)}
  {@const plainText = buildTaskPlainText(item.text)}
  <div
    class="fce-task-row"
    class:is-root={depth === 0}
    class:is-subtask={depth > 0}
    class:is-completed={completed}
    class:is-pending={pending}
    aria-busy={pending ? true : undefined}
    data-task-line={item.line}
  >
    <button
      type="button"
      role="checkbox"
      class="fce-task-check"
      aria-checked={completed}
      aria-label={viewStrings.checkboxLabel(plainText)}
      aria-disabled={pending ? true : undefined}
      data-task={item.statusChar}
      onclick={() => toggle(item)}
    >
      <span class="fce-task-check-box" aria-hidden="true">
        {#if completed}<span class="fce-task-check-mark" use:applyIcon={"check"}></span>{/if}
      </span>
    </button>
    <div class="fce-task-main">
      <div
        class="fce-task-text"
        role="button"
        tabindex="0"
        aria-label={`${plainText} \u2014 ${viewStrings.openTask}`}
        onclick={(event) => openItem(event, item)}
        onauxclick={(event) => handleAuxClick(event, () => openItem(event, item))}
        onmousedown={(event) => { if (event.button === 1) event.preventDefault(); }}
        onkeydown={(event) => handleTextKeydown(event, item)}
        oncontextmenu={(event) => handleContextMenu(event, item)}
      >{#each buildTaskTextSegments(plainText, searchQuery) as segment, index (index)}{#if segment.highlighted}<mark class="fce-search-hit">{segment.text}</mark>{:else}{segment.text}{/if}{/each}</div>
      <div class="fce-task-chips">
        {#each TASK_CHIP_KINDS as kind (kind)}
          {@const value = item.dates[kind]}
          {@const due = kind === "due" ? resolveTaskDueState(value, completed, today) : null}
          {@const label = chipLabel(kind, value, completed)}
          <button
            type="button"
            class="fce-task-chip"
            class:is-set={value !== null}
            class:is-unset={value === null}
            class:is-overdue={due === "overdue"}
            class:is-due-today={due === "today"}
            data-kind={kind}
            aria-label={label}
            aria-disabled={pending ? true : undefined}
            onclick={(event) => editDate(event, item, kind)}
            use:applyTooltip={label}
          >
            <span class="fce-task-chip-icon" aria-hidden="true" use:applyIcon={CHIP_ICONS[kind]}></span>
            {#if value !== null}<span class="fce-task-chip-label">{formatChipDate(value)}</span>{/if}
          </button>
        {/each}
        {#if onTaskContextMenu}
          <button
            type="button"
            class="fce-task-chip is-unset fce-task-more"
            aria-label={strings.cardItem.moreActions}
            aria-haspopup="menu"
            onclick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              emitContextMenu(item, { mouseEvent: event, position: { x: rect.left, y: rect.bottom } });
            }}
            use:applyTooltip={strings.cardItem.moreActions}
          >
            <span class="fce-task-chip-icon" aria-hidden="true" use:applyIcon={"ellipsis"}></span>
          </button>
        {/if}
      </div>
    </div>
  </div>
  {#if item.children.length > 0}
    <div class="fce-task-children" role="group">
      {#each item.children as child (child.line)}
        {@render taskRow(child, depth + 1)}
      {/each}
    </div>
  {/if}
{/snippet}

<div
  class="fce-card fce-task-card fce-card-radius-{appearance.cardCornerRadius}"
  class:is-touch={touch}
  class:is-pending={isPending(task)}
  class:is-completed={shownCompleted(task)}
  data-fce-card-background={backgroundColor === "theme" ? undefined : backgroundColor}
  data-completed-style={appearance.taskCompletedStyle ?? "none"}
  data-task-id={task.path}
>
  <div class="fce-task-card-body">
    {@render taskRow(task, 0)}
  </div>
  {#if showFile || progress.total > 0}
    <div class="fce-task-card-footer">
      {#if showFile}
        <button
          type="button"
          class="fce-task-file"
          aria-label={viewStrings.openFile(task.fileTitle)}
          onclick={openFile}
          onauxclick={(event) => handleAuxClick(event, () => openFile(event))}
          onmousedown={(event) => { if (event.button === 1) event.preventDefault(); }}
        >
          <span class="fce-task-file-icon" aria-hidden="true" use:applyIcon={"file-text"}></span>
          <span class="fce-task-file-title">{task.fileTitle}</span>
        </button>
      {/if}
      {#if progress.total > 0}
        <CardTaskFooter
          summary={{ total: progress.total, incomplete: progress.total - progress.completed }}
          strings={strings.cardItem}
          label={viewStrings.subtaskProgress(progress.completed, progress.total)}
        />
      {/if}
    </div>
  {/if}
</div>
