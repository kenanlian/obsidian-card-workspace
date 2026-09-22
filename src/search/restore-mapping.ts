import type { IndexStoreRestoreRebuildRequiredResult } from "./IndexStore";
import type { SearchIndexPersistenceHealth, SearchIndexRebuildReason } from "./types";

export function toRebuildDetail(restoreResult: IndexStoreRestoreRebuildRequiredResult): string {
  if (restoreResult.detail) {
    return restoreResult.detail;
  }

  switch (restoreResult.reason) {
    case "missing":
      return "No persisted index found; full build required.";
    case "version-drift":
      return "Persisted index version drift; full build required.";
    case "corrupt":
      return "Persisted index is corrupt; full build required.";
    case "unavailable":
      return "Persistent index storage unavailable; rebuild cannot restore persisted index.";
    case "read-failed":
    default:
      return "Persisted index read failed; full build required.";
  }
}

export function toRestorePersistence(reason: IndexStoreRestoreRebuildRequiredResult["reason"]): SearchIndexPersistenceHealth {
  switch (reason) {
    case "unavailable":
      return "storage-unavailable";
    case "read-failed":
      return "read-failed";
    case "missing":
    case "version-drift":
    case "corrupt":
    default:
      return "healthy";
  }
}

export function toRestoreRebuildReason(reason: IndexStoreRestoreRebuildRequiredResult["reason"]): SearchIndexRebuildReason {
  switch (reason) {
    case "missing":
    case "version-drift":
    case "corrupt":
    case "read-failed":
    case "unavailable":
      return reason === "unavailable" ? "storage-unavailable" : reason;
    default:
      return "read-failed";
  }
}
