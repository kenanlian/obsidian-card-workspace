export type TaskDateKind = "created" | "done" | "due";

export type TaskDatePreset = "today" | "tomorrow" | "next-monday";

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const yearText = year >= 0 && year < 10000 ? String(year).padStart(4, "0") : String(year);
  return `${yearText}-${twoDigits(month)}-${twoDigits(day)}`;
}

export function isValidIsoDate(value: string): boolean {
  const parts = readIsoParts(value);
  if (parts === null) {
    return false;
  }
  const date = localDate(parts.year, parts.month, parts.day);
  return date.getFullYear() === parts.year && date.getMonth() === parts.month - 1 && date.getDate() === parts.day;
}

/** Local midnight. Invalid calendar dates, including `2026-02-30`, return null. */
export function parseIsoDateLocal(value: string): Date | null {
  const parts = readIsoParts(value);
  if (parts === null || !isValidIsoDate(value)) {
    return null;
  }
  return localDate(parts.year, parts.month, parts.day);
}

/**
 * `next-monday` is the Monday strictly after `now`'s local calendar day.
 * A Monday therefore resolves seven days ahead.
 */
export function resolveDatePreset(preset: TaskDatePreset, now: Date): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === "tomorrow") {
    date.setDate(date.getDate() + 1);
  } else if (preset === "next-monday") {
    const weekday = date.getDay();
    const daysAhead = weekday === 0 ? 1 : 8 - weekday;
    date.setDate(date.getDate() + daysAhead);
  }
  return formatIsoDate(date);
}

/** Lexical order matches chronological order for zero-padded ISO dates. */
export function compareIsoDates(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function readIsoParts(value: string): { year: number; month: number; day: number } | null {
  const match = ISO_DATE_PATTERN.exec(value);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  return { year, month, day };
}

/** `Date` year 0–99 is not 1900-based when set via `setFullYear`. */
function localDate(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
}
