import { describe, expect, it } from "vitest";
import { deleteSearchHistory, normalizeSearchHistory, recordSearchHistory, suggestSearchHistory } from "./search-history";
import { mergeSettings, migrateSettings, normalizeSettings } from "./settings";
import { serializeSettings } from "./services/SettingsStore";

describe("recent search history", () => {
  it("normalizes hostile entries, trims only the ends and keeps the first case-insensitive duplicate", () => {
    expect(normalizeSearchHistory([null, 3, {}, "", "  ", " Alpha  ", "alpha", "A  B", "中文"])).toEqual(["Alpha", "A  B", "中文"]);
    expect(normalizeSearchHistory("alpha")).toEqual([]);
  });

  it("promotes the latest spelling and evicts entries after 30", () => {
    const history = Array.from({ length: 35 }, (_, i) => `query ${i}`);
    expect(normalizeSearchHistory(history)).toHaveLength(30);
    const promoted = recordSearchHistory(normalizeSearchHistory(history), " QUERY 20 ");
    expect(promoted[0]).toBe("QUERY 20");
    expect(promoted.filter((q) => q.toLowerCase() === "query 20")).toHaveLength(1);
    const added = recordSearchHistory(promoted, "new");
    expect(added).toHaveLength(30);
    expect(added).not.toContain("query 29");
    expect(recordSearchHistory(added, "  ")).toEqual(added);
  });

  it("uses case-insensitive substring matching and limits suggestions to six in recent order", () => {
    const history = ["Alpha beta", "alphabet", "中文查询", "beta", "One", "Two", "Three", "Four"];
    expect(suggestSearchHistory(history, "PHA")).toEqual(["Alpha beta", "alphabet"]);
    expect(suggestSearchHistory(history, "文查")).toEqual(["中文查询"]);
    expect(suggestSearchHistory(history, "")).toEqual(history.slice(0, 6));
    expect(suggestSearchHistory(history, "xyz")).toEqual([]);
    expect(deleteSearchHistory(history, " ALPHABET ")).toEqual(history.filter((q) => q !== "alphabet"));
  });

  it("defaults old settings to empty history and round-trips the normalized collection through schema v2", () => {
    expect(migrateSettings({ schemaVersion: 2, userData: {} }).searchHistory).toEqual([]);
    expect(migrateSettings({}).searchHistory).toEqual([]);
    const settings = mergeSettings(normalizeSettings({}), { searchHistory: [" one ", "ONE", "two"] });
    const doc = serializeSettings(settings);
    expect(doc.schemaVersion).toBe(2);
    expect(doc.userData.searchHistory).toEqual(["one", "two"]);
    expect(doc.preferences).not.toHaveProperty("searchHistory");
    expect(doc.workspace).not.toHaveProperty("searchHistory");
    expect(migrateSettings(JSON.parse(JSON.stringify(doc))).searchHistory).toEqual(["one", "two"]);
  });
});
