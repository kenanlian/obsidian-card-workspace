export interface IndexStoreNamespaceMetadata {
  vaultNamespace: string;
  schemaVersion: string;
  tokenizerVersion: string;
  pluginVersion: string;
  documentCount: number;
  lastIndexedAt: number;
}

/**
 * MiniSearch `toJSON()` output. Persisted as a structured-clone value rather
 * than a JSON string: stringifying a whole-vault index is a synchronous
 * main-thread block and can exceed the engine's maximum string length.
 */
export type IndexStoreSerializedIndex = Record<string, unknown>;

export type IndexStoreDocumentCatalog = Record<string, number>;

export interface IndexStoreSerializedPayload {
  serializedIndex: IndexStoreSerializedIndex;
  documentCount: number;
  lastIndexedAt: number;
  documentCatalog?: IndexStoreDocumentCatalog;
}

export interface IndexStoreRecord {
  metadata: IndexStoreNamespaceMetadata;
  serializedIndex: IndexStoreSerializedIndex;
  documentCatalog?: IndexStoreDocumentCatalog;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isValidRecord(value: unknown): value is IndexStoreRecord {
  if (!isRecord(value)) {
    return false;
  }

  if (!isRecord(value.metadata)) {
    return false;
  }

  if (!isRecord(value.serializedIndex)) {
    return false;
  }

  const metadata = value.metadata;
  return (
    typeof metadata.vaultNamespace === "string" &&
    typeof metadata.schemaVersion === "string" &&
    typeof metadata.tokenizerVersion === "string" &&
    typeof metadata.pluginVersion === "string" &&
    Number.isFinite(metadata.documentCount) &&
    Number.isFinite(metadata.lastIndexedAt)
  );
}

export function matchesExpectedMetadata(stored: IndexStoreNamespaceMetadata, expected: IndexStoreNamespaceMetadata): boolean {
  return (
    stored.vaultNamespace === expected.vaultNamespace &&
    stored.schemaVersion === expected.schemaVersion &&
    stored.tokenizerVersion === expected.tokenizerVersion
  );
}

export function createIndexRecord(
  vaultNamespace: string,
  metadata: IndexStoreNamespaceMetadata,
  payload: IndexStoreSerializedPayload,
): IndexStoreRecord {
  const normalizedMetadata: IndexStoreNamespaceMetadata = {
    ...metadata,
    vaultNamespace,
    documentCount: payload.documentCount,
    lastIndexedAt: payload.lastIndexedAt,
  };

  if (payload.documentCatalog !== undefined) {
    return {
      metadata: normalizedMetadata,
      serializedIndex: payload.serializedIndex,
      documentCatalog: payload.documentCatalog,
    };
  }

  return {
    metadata: normalizedMetadata,
    serializedIndex: payload.serializedIndex,
  };
}

export function readDocumentCatalog(value: unknown): IndexStoreDocumentCatalog | null {
  if (value === undefined || typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  try {
    const catalog: IndexStoreDocumentCatalog = {};
    for (const [path, mtime] of Object.entries(value)) {
      if (typeof mtime !== "number" || !Number.isFinite(mtime)) {
        return null;
      }
      catalog[path] = mtime;
    }
    return catalog;
  } catch {
    return null;
  }
}
