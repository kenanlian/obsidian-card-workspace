import type MiniSearch from "minisearch";
import type { SearchDocumentCatalog } from "./document-catalog";
import { classifySearchMutation } from "./document-preparation";
import type { SearchIndexManagerMutationResult } from "./SearchIndexManager";
import type { SearchVaultMutation, SearchableDocument } from "./types";

/**
 * The mutable state one index owns. Threading it as a unit is what keeps the
 * catalog from drifting: there is no way to update documents without it.
 */
export interface IndexWorkingSet {
  index: MiniSearch<SearchableDocument>;
  documents: Map<string, SearchableDocument>;
  catalog: SearchDocumentCatalog;
}

/** The state edits and snapshot publication the dispatch delegates back. */
export interface MutationApplicationHost {
  discardIndexedPath(path: string, set: IndexWorkingSet): void;
  upsertDocument(path: string, set: IndexWorkingSet): Promise<void>;
  rewriteFolderPrefix(oldPrefix: string, newPrefix: string, set: IndexWorkingSet): boolean;
  markFolderRebuildRequired(detail: string): void;
}

/**
 * Resolves one vault mutation against a working set. `live` marks the set that
 * is serving queries, which is the only case allowed to publish health.
 */
export async function applyMutationToWorkingSet(
  event: SearchVaultMutation,
  set: IndexWorkingSet,
  live: boolean,
  host: MutationApplicationHost,
): Promise<SearchIndexManagerMutationResult> {
  const decision = classifySearchMutation(event);

  if (decision.action === "ignored") {
    return {
      action: "ignored",
      rebuildRequired: false,
    };
  }

  if (decision.action === "rebuild-required") {
    if (live) host.markFolderRebuildRequired("Folder rename cannot be safely rewritten; full rebuild required.");
    return {
      action: "rebuild-required",
      rebuildRequired: true,
    };
  }

  if (decision.action === "delete") {
    host.discardIndexedPath(event.path, set);
    return {
      action: "applied",
      rebuildRequired: false,
    };
  }

  if (decision.action === "create" || decision.action === "modify") {
    await host.upsertDocument(event.path, set);
    return {
      action: "applied",
      rebuildRequired: false,
    };
  }

  if (decision.action === "file-rename") {
    const oldPath = event.oldPath;
    if (!oldPath) {
      return {
        action: "rebuild-required",
        rebuildRequired: true,
      };
    }

    host.discardIndexedPath(oldPath, set);
    await host.upsertDocument(event.path, set);
    return {
      action: "applied",
      rebuildRequired: false,
    };
  }

  if (decision.action === "folder-rename") {
    const oldPrefix = event.oldPath;
    if (!oldPrefix) {
      return {
        action: "rebuild-required",
        rebuildRequired: true,
      };
    }

    const didRewrite = host.rewriteFolderPrefix(oldPrefix, event.path, set);
    if (!didRewrite) {
      if (live) host.markFolderRebuildRequired("Folder rename could not be safely rewritten from restored index metadata; full rebuild required.");
      return {
        action: "rebuild-required",
        rebuildRequired: true,
      };
    }

    return {
      action: "applied",
      rebuildRequired: false,
    };
  }

  return {
    action: "ignored",
    rebuildRequired: false,
  };
}

/**
 * A folder rename moves an unbounded set of indexed paths and a
 * rebuild-required event invalidates the premise outright, so neither can be
 * merged into a hydration-only reconcile pass.
 */
export function isUnmergeableMutation(event: SearchVaultMutation): boolean {
  const action = classifySearchMutation(event).action;
  return action === "folder-rename" || action === "rebuild-required";
}
