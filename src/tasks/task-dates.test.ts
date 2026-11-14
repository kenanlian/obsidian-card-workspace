import { describe, expect, it } from "vitest";

import {
  compareIsoDates,
  formatIsoDate,
  isValidIsoDate,
  parseIsoDateLocal,
  resolveDatePreset,
} from "./task-dates";

function localNoon(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

describe("formatIsoDate", () => {
  it("formats local calendar components with zero padding", () => {
    expect(formatIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(formatIsoDate(new Date(2026, 10, 14, 23, 59, 58))).toBe("2026-11-14");
    expect(formatIsoDate(new Date(999, 11, 31))).toBe("0999-12-31");
  });
});

describe("isValidIsoDate", () => {
  it.each([
    ["2026-01-01", true],
    ["2026-11-14", true],
    ["2024-02-29", true],
    ["2000-02-29", true],
    ["2026-02-28", true],
    ["0001-01-01", true],
    ["2026-02-29", false],
    ["2026-02-30", false],
    ["1900-02-29", false],
    ["2026-04-31", false],
    ["2026-00-01", false],
    ["2026-13-01", false],
    ["2026-01-00", false],
    ["2026-01-32", false],
    ["2026-1-01", false],
    ["2026-01-1", false],
    ["20260101", false],
    ["2026-01-01 ", false],
    [" 2026-01-01", false],
    ["", false],
    ["2026/01/01", false],
  ] as const)("treats %j as valid=%s", (value, valid) => {
    expect(isValidIsoDate(value)).toBe(valid);
  });
});

describe("parseIsoDateLocal", () => {
  it("returns local midnight for a real calendar date", () => {
    const date = parseIsoDateLocal("2026-11-14");
    expect(date).not.toBeNull();
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(10);
    expect(date?.getDate()).toBe(14);
    expect(date?.getHours()).toBe(0);
    expect(date?.getMinutes()).toBe(0);
    expect(date?.getSeconds()).toBe(0);
    expect(date?.getMilliseconds()).toBe(0);
  });

  it("returns null for impossible and malformed dates", () => {
    expect(parseIsoDateLocal("2026-02-30")).toBeNull();
    expect(parseIsoDateLocal("1900-02-29")).toBeNull();
    expect(parseIsoDateLocal("2026-02-29")).toBeNull();
    expect(parseIsoDateLocal("not-a-date")).toBeNull();
  });

  it("keeps year 0-99 on the proleptic calendar instead of 1900+", () => {
    const date = parseIsoDateLocal("0099-03-04");
    expect(date?.getFullYear()).toBe(99);
    expect(date?.getMonth()).toBe(2);
    expect(date?.getDate()).toBe(4);
  });
});

describe("resolveDatePreset", () => {
  const saturday = localNoon(2026, 11, 14);
  const sunday = localNoon(2026, 11, 15);
  const monday = localNoon(2026, 11, 16);
  const tuesday = localNoon(2026, 11, 17);

  it("uses the local calendar day for today and tomorrow", () => {
    expect(saturday.getDay()).toBe(6);
    expect(resolveDatePreset("today", saturday)).toBe("2026-11-14");
    expect(resolveDatePreset("tomorrow", saturday)).toBe("2026-11-15");
    expect(resolveDatePreset("tomorrow", localNoon(2026, 1, 31))).toBe("2026-02-01");
    expect(resolveDatePreset("tomorrow", localNoon(2026, 12, 31))).toBe("2027-01-01");
    expect(resolveDatePreset("today", localNoon(2026, 11, 16, ))).toBe("2026-11-16");
  });

  it("resolves next Monday strictly after the current day", () => {
    expect(sunday.getDay()).toBe(0);
    expect(monday.getDay()).toBe(1);
    expect(tuesday.getDay()).toBe(2);
    expect(resolveDatePreset("next-monday", sunday)).toBe("2026-11-16");
    expect(resolveDatePreset("next-monday", monday)).toBe("2026-11-23");
    expect(resolveDatePreset("next-monday", tuesday)).toBe("2026-11-23");
    expect(resolveDatePreset("next-monday", saturday)).toBe("2026-11-16");
  });

  it("ignores the time of day when the calendar day is Monday", () => {
    const lateMonday = new Date(2026, 10, 16, 23, 30, 0, 0);
    expect(lateMonday.getDay()).toBe(1);
    expect(resolveDatePreset("next-monday", lateMonday)).toBe("2026-11-23");
  });
});

describe("compareIsoDates", () => {
  it.each([
    ["2026-01-02", "2026-01-10", -1],
    ["2026-01-10", "2026-01-02", 1],
    ["2026-01-02", "2026-01-02", 0],
    ["2026-09-30", "2026-10-01", -1],
    ["2026-12-31", "2027-01-01", -1],
  ] as const)("compares %s and %s as %s", (left, right, expected) => {
    expect(compareIsoDates(left, right)).toBe(expected);
  });
});
