export { IndexStore } from "./IndexStore";
export { IndexBuildGuard, MAX_CONSECUTIVE_INCOMPLETE_BUILDS } from "./IndexBuildGuard";
export { scheduleIdleTask } from "./idle-task";
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
  SearchService,
  SearchServiceSnapshot,
  SearchServiceStatus,
  SearchStatus,
  SearchVaultMutation,
  SearchVaultMutationType,
} from "./types";
export type {
  IndexStoreDocumentCatalog,
  IndexStoreNamespaceMetadata,
  IndexStoreRestoreResult,
  IndexStoreSerializedIndex,
  IndexStoreSerializedPayload,
  IndexStoreStorageAdapter,
  IndexStoreWriteResult,
} from "./IndexStore";
export type { IndexBuildGuardStore } from "./IndexBuildGuard";
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
