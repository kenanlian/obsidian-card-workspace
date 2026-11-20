import { getSearchDisplayTerms } from "../search-tokenization";
import { countNonOverlappingLiteralOccurrences } from "./SearchReconciliationRunner";

export function buildMatchCountsByPath(
  query: string,
  orderedPaths: readonly string[],
  getSearchText: (path: string) => string | undefined,
): Record<string, number> | undefined {
  const uniqueTokens = getSearchDisplayTerms(query);
  if (uniqueTokens.length === 0) {
    return undefined;
  }

  const matchCountsByPath: Record<string, number> = {};
  for (const path of orderedPaths) {
    const searchText = getSearchText(path);
    if (searchText === undefined) continue;
    const count = countTokenMatches(searchText, uniqueTokens);
    if (count > 0) {
      matchCountsByPath[path] = count;
    }
  }

  return Object.keys(matchCountsByPath).length > 0 ? matchCountsByPath : undefined;
}

function countTokenMatches(searchBasis: string, tokens: string[]): number {
  const normalizedBasis = searchBasis.toLowerCase();
  let total = 0;
  for (const token of tokens) {
    total += countNonOverlappingLiteralOccurrences(normalizedBasis, token);
  }

  return total;
}
