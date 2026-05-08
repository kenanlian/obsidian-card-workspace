export { IndexStore } from "./IndexStore";
export { SearchIndexManager } from "./SearchIndexManager";
export { IndexedSearchService } from "./IndexedSearchService";
export {
  classifySearchMutation,
  prepareSearchableDocument,
  prepareSearchableDocuments,
} from "./document-preparation";
export { PHASE3_MINISEARCH_CONTRACT } from "./types";
export type {
  SearchableDocument,
  SearchExecutionMode,
  SearchIndexHealthSnapshot,
  SearchIndexObservabilitySnapshot,
  SearchQueryExecutionState,
  SearchQueryRequest,
  SearchQueryResult,
  SearchRenameClassification,
  SearchRestoreOutcome,
  SearchScope,
  SearchService,
  SearchServiceSnapshot,
  SearchServiceStatus,
  SearchStatus,
  SearchVaultMutation,
  SearchVaultMutationType,
} from "./types";
export type {
  IndexStoreNamespaceMetadata,
  IndexStoreRestoreResult,
  IndexStoreSerializedPayload,
  IndexStoreStorageAdapter,
  IndexStoreWriteResult,
} from "./IndexStore";
export type {
  SearchIndexManagerMutationResult,
  SearchIndexManagerRestoreResult,
} from "./SearchIndexManager";
export type { IndexedSearchManagerAdapter, IndexedSearchServiceOptions } from "./IndexedSearchService";
export type {
  SearchMutationDecision,
  SearchMutationDecisionAction,
  SearchableDocumentInput,
} from "./document-preparation";
