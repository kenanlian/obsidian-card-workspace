import { describe, expect, it } from "vitest";
import { getUiStrings } from "../i18n";
import { normalizeGroupSpec, TIME_GROUP_GRANULARITIES } from "../card-grouping-settings";
import { localDayOrdinal, resolveTimeBucket } from "./time-grouping";

const time = (year: number, month: number, day: number, hour = 12) => new Date(year, month - 1, day, hour).getTime();
const strings = getUiStrings("zh").sortGroup;
const now = time(2026, 11, 12);
const bucket = (stamp: number, grain: typeof TIME_GROUP_GRANULARITIES[number]) => resolveTimeBucket(stamp, "ctime", grain, strings, now);

describe("time grouping", () => {
  it("normalizes all time settings and removes irrelevant fields", () => {
    for (const dimension of ["ctime", "mtime"]) for (const timeGranularity of TIME_GROUP_GRANULARITIES) {
      expect(normalizeGroupSpec({ dimension, timeGranularity })).toMatchObject({ dimension, timeGranularity });
    }
    expect(normalizeGroupSpec({ dimension: "mtime", timeGranularity: "bad" }).timeGranularity).toBe("day");
    expect(normalizeGroupSpec({ dimension: "tag", timeGranularity: "month" }).timeGranularity).toBeUndefined();
  });
  it("uses calendar days, months and years", () => {
    expect(bucket(time(2024, 2, 29, 0), "day").label).toBe("2024-02-29");
    expect(bucket(time(2024, 2, 29, 23), "month").label).toBe("2024-02");
    expect(bucket(time(2024, 12, 31), "year").label).toBe("2024");
    expect(localDayOrdinal(time(2024, 3, 11)) - localDayOrdinal(time(2024, 3, 10))).toBe(1);
  });
  it("starts weeks on Monday and keeps two-week boundaries across years", () => {
    expect(bucket(time(2026, 11, 15), "week").label).toBe("2026-11-09 – 2026-11-15");
    expect(bucket(time(2026, 11, 16), "week").label).toBe("2026-11-16 – 2026-11-22");
    expect(bucket(time(1970, 1, 5), "biweek").label).toBe("1970-01-05 – 1970-01-18");
    expect(bucket(time(1970, 1, 4), "biweek").label).toBe("1969-12-22 – 1970-01-04");
  });
  it("partitions relative periods without overlaps", () => {
    for (const [age, label] of [[-1, "未来"], [0, "今天"], [1, "昨天"], [2, "过去 7 天"], [6, "过去 7 天"], [7, "过去 30 天"], [29, "过去 30 天"], [30, "更早"]] as const) {
      expect(bucket(time(2026, 11, 12 - age), "relative").label).toBe(label);
    }
    expect(bucket(NaN, "relative")).toMatchObject({ label: "未知时间", isMissing: true });
  });
  it("separates fields and granularities with stable keys and localized headers", () => {
    const created = bucket(now, "day");
    const edited = resolveTimeBucket(now, "mtime", "day", getUiStrings("en").sortGroup, now);
    expect(edited.key).not.toBe(created.key);
    expect(bucket(now, "month").key).not.toBe(created.key);
    expect(edited.header).toEqual({ kind: "time", field: "mtime", text: "2026-11-12" });
    expect(resolveTimeBucket(now, "mtime", "relative", getUiStrings("en").sortGroup, now).label).toBe("Today");
  });
});
