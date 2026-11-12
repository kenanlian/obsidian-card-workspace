import type { TimeGroupGranularity } from "../card-grouping-settings";
import type { SortGroupStrings } from "../i18n";
import type { GroupBucket } from "./card-grouping";

const DAY_MS = 86_400_000;
/** A civil-day ordinal, independent of local daylight-saving transitions. */
export function localDayOrdinal(timestamp: number): number {
  const date = new Date(timestamp);
  const civil = new Date(0);
  civil.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  civil.setUTCHours(0, 0, 0, 0);
  return civil.getTime() / DAY_MS;
}
function dayLabel(day: number): string {
  const date = new Date(day * DAY_MS);
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function resolveTimeBucket(
  timestamp: number,
  field: "ctime" | "mtime",
  granularity: TimeGroupGranularity,
  strings: SortGroupStrings,
  now: number,
): GroupBucket {
  const day = localDayOrdinal(timestamp);
  let identity: string;
  let label: string;
  let sortKey: string;
  const isMissing = !Number.isFinite(day);
  if (isMissing) {
    identity = "unknown"; label = strings.relativeBuckets.unknown; sortKey = "";
  } else if (granularity === "relative") {
    const age = localDayOrdinal(now) - day;
    const bucket = age < 0 ? "future" : age === 0 ? "today" : age === 1 ? "yesterday"
      : age < 7 ? "week" : age < 30 ? "month" : "older";
    identity = bucket;
    label = strings.relativeBuckets[bucket];
    sortKey = String(["older", "month", "week", "yesterday", "today", "future"].indexOf(bucket));
  } else {
    let start = day;
    if (granularity === "week") start -= modulo(day - 4, 7);
    // 1970-01-05 is civil ordinal 4, a Monday; never reset at year boundaries.
    if (granularity === "biweek") start -= modulo(day - 4, 14);
    identity = dayLabel(start);
    if (granularity === "month") identity = identity.slice(0, 7);
    if (granularity === "year") identity = identity.slice(0, 4);
    label = granularity === "week" || granularity === "biweek"
      ? `${identity} – ${dayLabel(start + (granularity === "week" ? 6 : 13))}` : identity;
    sortKey = identity;
  }
  return { key: `${field}:${granularity}:${identity}`, label, detail: "",
    header: { kind: "time", field, text: label }, sortKey, isMissing };
}
