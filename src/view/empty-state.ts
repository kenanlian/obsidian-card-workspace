import type { UiStrings } from "../i18n";

/**
 * Card-stream empty-state copy (C10). Property-filter empty wins only when the
 * base source still has cards, no tag filter is active, and the visible
 * projection is empty while property clauses are active; an empty base source
 * keeps the source copy and query/tag messages stay unchanged.
 */
export function resolveEmptyStateMessage(input: {
  strings: UiStrings;
  query: string;
  activeTagCount: number;
  baseCardCount: number;
  visibleCardCount: number;
  propertyClauseCount: number;
}): string {
  const { strings, query } = input;
  if (query.length === 0) {
    if (
      input.propertyClauseCount > 0 && input.activeTagCount === 0
      && input.baseCardCount > 0 && input.visibleCardCount === 0
    ) {
      return strings.property.emptyPropertyFilter;
    }
    return strings.view.emptyFolder;
  }
  return input.activeTagCount > 0
    ? strings.view.emptySearchCurrentFolderWithTags(query)
    : strings.view.emptySearchCurrentFolder(query);
}
