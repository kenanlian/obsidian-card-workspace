/** Vault-shared recent queries; independent of the index and host. */
export const SEARCH_HISTORY_LIMIT = 30;
export const SEARCH_SUGGESTION_LIMIT = 6;

export function normalizeSearchHistory(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const history: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const query = item.trim();
    const key = query.toLowerCase();
    if (!query || seen.has(key)) continue;
    seen.add(key);
    history.push(query);
    if (history.length === SEARCH_HISTORY_LIMIT) break;
  }
  return history;
}

export function recordSearchHistory(history: readonly string[], query: string): string[] {
  return normalizeSearchHistory([query, ...history]);
}

export function deleteSearchHistory(history: readonly string[], query: string): string[] {
  const key = query.trim().toLowerCase();
  return normalizeSearchHistory(history).filter((entry) => entry.toLowerCase() !== key);
}

export function suggestSearchHistory(history: readonly string[], query: string): string[] {
  const key = query.trim().toLowerCase();
  return history.filter((entry) => entry.toLowerCase().includes(key)).slice(0, SEARCH_SUGGESTION_LIMIT);
}
