<script lang="ts">
  import { setIcon } from "obsidian";
  import type { GroupDimension, GroupOrderBy, GroupSpec } from "../card-grouping-settings";
  import type { SortGroupStrings } from "../i18n";
  import type { SortDirection, SortField } from "../settings";

  interface SortGroupPopoverProps {
    strings: SortGroupStrings;
    sortField: SortField;
    sortDirection: SortDirection;
    group: GroupSpec;
    availableGroupDimensions: GroupDimension[];
    hasSegments: boolean;
    onSelectSort: (field: SortField) => void;
    onSelectDirection: (direction: SortDirection) => void;
    onSelectDimension: (dimension: GroupDimension) => void;
    onSelectOrderBy: (orderBy: GroupOrderBy) => void;
    onSelectOrderDirection: (direction: SortDirection) => void;
    onCollapseAll: () => void;
    onExpandAll: () => void;
  }

  interface ChoiceRow<Value extends string> {
    value: Value;
    label: string;
  }

  let {
    strings,
    sortField,
    sortDirection,
    group,
    availableGroupDimensions,
    hasSegments,
    onSelectSort,
    onSelectDirection,
    onSelectDimension,
    onSelectOrderBy,
    onSelectOrderDirection,
    onCollapseAll,
    onExpandAll,
  }: SortGroupPopoverProps = $props();

  const sortFieldRows = $derived<ChoiceRow<SortField>[]>([
    { value: "mtime", label: strings.fieldMtime },
    { value: "ctime", label: strings.fieldCtime },
    { value: "name", label: strings.fieldName },
  ]);

  const directionRows = $derived<ChoiceRow<SortDirection>[]>([
    { value: "asc", label: strings.directionAsc },
    { value: "desc", label: strings.directionDesc },
  ]);

  const dimensionRows = $derived<ChoiceRow<GroupDimension>[]>([
    { value: "none", label: strings.dimensionNone },
    { value: "folder", label: strings.dimensionFolder },
    { value: "tag", label: strings.dimensionTag },
    { value: "box-rule", label: strings.dimensionBoxRule },
    { value: "task", label: strings.dimensionTask },
  ]);

  const orderByRows = $derived<ChoiceRow<GroupOrderBy>[]>([
    { value: "default", label: strings.orderDefault },
    { value: "name", label: strings.orderName },
    { value: "count", label: strings.orderCount },
  ]);

  const groupOrderDisabled = $derived(group.dimension === "none");

  function applyIcon(node: HTMLElement, iconName: string): void {
    setIcon(node, iconName);
  }
</script>

{#snippet radioRow(
  id: string,
  label: string,
  checked: boolean,
  rowDisabled: boolean,
  hint: string,
  select: () => void,
)}
  <button
    type="button"
    class="fce-popup-row fce-sort-menu-item"
    role="menuitemradio"
    data-sort-group-row={id}
    aria-checked={checked}
    aria-disabled={rowDisabled ? "true" : undefined}
    disabled={rowDisabled}
    onclick={() => {
      if (!rowDisabled) {
        select();
      }
    }}
  >
    <span class="fce-popup-row-content">
      <span class="fce-sort-menu-item-label">{label}</span>
      {#if hint.length > 0}
        <span class="fce-sort-menu-item-hint">{hint}</span>
      {/if}
    </span>
    <span class="fce-popup-row-trailing" aria-hidden={!checked}>
      {#if checked}
        <span class="fce-popup-row-selected-indicator fce-sort-menu-item-check" use:applyIcon={"check"}></span>
      {/if}
    </span>
  </button>
{/snippet}

{#snippet commandRow(id: string, label: string, rowDisabled: boolean, select: () => void)}
  <button
    type="button"
    class="fce-popup-row fce-sort-menu-item"
    role="menuitem"
    data-sort-group-row={id}
    aria-disabled={rowDisabled ? "true" : undefined}
    disabled={rowDisabled}
    onclick={() => {
      if (!rowDisabled) {
        select();
      }
    }}
  >
    <span class="fce-popup-row-content">
      <span class="fce-sort-menu-item-label">{label}</span>
    </span>
  </button>
{/snippet}

<div class="fce-sort-menu-section" role="group" aria-label={strings.sortFieldHeading}>
  {#each sortFieldRows as row (row.value)}
    {@render radioRow(`field-${row.value}`, row.label, sortField === row.value, false, "", () => onSelectSort(row.value))}
  {/each}
</div>

<div class="fce-sort-menu-separator" role="separator" aria-hidden="true"></div>

<div class="fce-sort-menu-section" role="group" aria-label={strings.sortDirectionHeading}>
  {#each directionRows as row (row.value)}
    {@render radioRow(`direction-${row.value}`, row.label, sortDirection === row.value, false, "", () => onSelectDirection(row.value))}
  {/each}
</div>

<div class="fce-sort-menu-separator" role="separator" aria-hidden="true"></div>

<div class="fce-sort-menu-section" role="group" aria-label={strings.groupHeading}>
  {#each dimensionRows as row (row.value)}
    {@const unavailable = !availableGroupDimensions.includes(row.value)}
    {@render radioRow(
      `dimension-${row.value}`,
      row.label,
      group.dimension === row.value,
      unavailable,
      unavailable ? strings.dimensionBoxRuleUnavailable : "",
      () => onSelectDimension(row.value),
    )}
  {/each}
</div>

<div class="fce-sort-menu-separator" role="separator" aria-hidden="true"></div>

<div class="fce-sort-menu-section" role="group" aria-label={strings.groupOrderHeading}>
  {#each orderByRows as row (row.value)}
    {@render radioRow(`order-by-${row.value}`, row.label, group.orderBy === row.value, groupOrderDisabled, "", () => onSelectOrderBy(row.value))}
  {/each}
  <div class="fce-sort-menu-separator" role="separator" aria-hidden="true"></div>
  {#each directionRows as row (row.value)}
    {@render radioRow(
      `order-direction-${row.value}`,
      row.label,
      group.orderDirection === row.value,
      groupOrderDisabled,
      "",
      () => onSelectOrderDirection(row.value),
    )}
  {/each}
</div>

<div class="fce-sort-menu-separator" role="separator" aria-hidden="true"></div>

{@render commandRow("collapse-all", strings.collapseAll, !hasSegments, onCollapseAll)}
{@render commandRow("expand-all", strings.expandAll, !hasSegments, onExpandAll)}
