/** Serializable box-local configuration and shared non-repeating progress. */
export type BoxDrawMode = "random" | "cycle" | "daily";
export interface BoxDrawConfig { mode: BoxDrawMode; count: number }
export interface BoxDrawProgress {
  round: number;
  drawnPaths: string[];
  currentGroup?: { paths: string[]; date?: string };
}
export function normalizeBoxDraw(value: unknown): BoxDrawConfig {
  const v = value as Partial<BoxDrawConfig> | null;
  return { mode: v?.mode === "cycle" || v?.mode === "daily" ? v.mode : "random",
    count: typeof v?.count === "number" && Number.isFinite(v.count) ? Math.max(1, Math.min(100, Math.floor(v.count))) : 5 };
}
export function normalizeBoxDrawProgress(value: unknown): BoxDrawProgress | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Partial<BoxDrawProgress>;
  const paths = (x: unknown): string[] => Array.isArray(x) ? [...new Set(x.filter((p): p is string => typeof p === "string" && p.length > 0))] : [];
  if (!Number.isSafeInteger(v.round) || (v.round ?? 0) < 1) return undefined;
  const group = v.currentGroup;
  return { round: v.round!, drawnPaths: paths(v.drawnPaths), ...(group && Array.isArray(group.paths) ? {
    currentGroup: { paths: paths(group.paths), ...(typeof group.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(group.date) ? { date: group.date } : {}) },
  } : {}) };
}
export function localDrawDate(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function sampleBoxPaths(pool: readonly string[], count: number, random: () => number = Math.random): string[] {
  const paths = [...new Set(pool)];
  const size = Math.min(count, paths.length);
  for (let i = 0; i < size; i++) {
    const j = i + Math.floor(random() * (paths.length - i));
    [paths[i], paths[j]] = [paths[j], paths[i]];
  }
  return paths.slice(0, size);
}
export function advanceBoxDraw(pool: readonly string[], config: BoxDrawConfig, progress: BoxDrawProgress | undefined,
  next: boolean, now = new Date(), random: () => number = Math.random): BoxDrawProgress {
  const previous = progress ?? { round: 1, drawnPaths: [] };
  const date = localDrawDate(now);
  if ((!next || config.mode === "daily") && previous.currentGroup?.paths.length && (config.mode !== "daily" || previous.currentGroup.date === date)) return previous;
  if (pool.length === 0) return previous;
  let round = previous.round;
  let drawnPaths = previous.drawnPaths;
  let seen = new Set(drawnPaths);
  let remaining = pool.filter(path => !seen.has(path));
  if (remaining.length === 0) { round++; drawnPaths = []; seen = new Set(); remaining = [...pool]; }
  const paths = sampleBoxPaths(remaining, config.count, random);
  return { round, drawnPaths: [...drawnPaths, ...paths.filter(path => !seen.has(path))],
    currentGroup: { paths, ...(config.mode === "daily" ? { date } : {}) } };
}
export function mapBoxDrawProgress(progress: BoxDrawProgress | undefined, map: (path: string) => string | null): BoxDrawProgress | undefined {
  if (!progress) return undefined;
  const paths = (values: string[]) => [...new Set(values.map(map).filter((p): p is string => p !== null))];
  const result = { ...progress, drawnPaths: paths(progress.drawnPaths), ...(progress.currentGroup ? {
    currentGroup: { ...progress.currentGroup, paths: paths(progress.currentGroup.paths) },
  } : {}) };
  return JSON.stringify(result) === JSON.stringify(progress) ? progress : result;
}
