import type { Options, SearchOptions } from "minisearch";
import {
  shouldUsePrefixSearch,
  tokenizeSearchIndexText,
  tokenizeSearchQuery,
} from "../search-tokenization";
import { PHASE3_MINISEARCH_CONTRACT, type SearchableDocument } from "./types";

export const MINISEARCH_SEARCH_OPTIONS: SearchOptions = {
  tokenize: tokenizeSearchQuery,
  prefix: shouldUsePrefixSearch,
  fuzzy: PHASE3_MINISEARCH_CONTRACT.query.fuzzy,
  combineWith: PHASE3_MINISEARCH_CONTRACT.query.combineWith,
  boost: {
    title: PHASE3_MINISEARCH_CONTRACT.boost.title,
    content: PHASE3_MINISEARCH_CONTRACT.boost.content,
  },
};

export function createMiniSearchOptions(): Options<SearchableDocument> {
  return {
    idField: "path",
    fields: [...PHASE3_MINISEARCH_CONTRACT.indexFields],
    storeFields: [...PHASE3_MINISEARCH_CONTRACT.storeFields],
    tokenize: tokenizeSearchIndexText,
    processTerm: (term: string): string => term.toLowerCase(),
  };
}
