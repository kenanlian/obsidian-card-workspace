import type { UiStrings } from "../i18n";

/** Source-empty and search copy stay distinct from browse-filter zero results. */
export function resolveEmptyStateMessage(input: {
  strings: UiStrings;
  query: string;
  activeTagCount: number;
  baseCardCount: number;
  visibleCardCount: number;
  propertyClauseCount: number;
  emptyBaseMessage?: string;
  emptySearchMessage?: (query: string) => string;
}): string {
  const { strings, query } = input;
  const hasFilters = input.activeTagCount > 0 || input.propertyClauseCount > 0;
  if (query.length > 0 && hasFilters) return strings.toolbar.emptySearchFilters(query);
  if (query.length === 0) {
    if (hasFilters && input.baseCardCount > 0 && input.visibleCardCount === 0
      && input.activeTagCount > 0) return strings.toolbar.emptyBrowseFilters;
    if (
      input.propertyClauseCount > 0 && input.activeTagCount === 0
      && input.baseCardCount > 0 && input.visibleCardCount === 0
    ) {
      return strings.property.emptyPropertyFilter;
    }
    return input.emptyBaseMessage ?? strings.view.emptyFolder;
  }
  return input.emptySearchMessage?.(query) ?? strings.view.emptySearchCurrentFolder(query);
}
