import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { emojiVariant, getEmojiCatalog, isEmojiCatalogInitialized, normalizeEmojiInput } from "./emoji-catalog";

describe("pinned offline emoji catalogue", () => {
  it("initializes lazily once and includes every fully-qualified Unicode 17.0 sequence", () => {
    expect(isEmojiCatalogInitialized()).toBe(false);
    const catalog = getEmojiCatalog(); expect(getEmojiCatalog()).toBe(catalog);
    const source = readFileSync(new URL("../../data/emoji/emoji-test.txt", import.meta.url), "utf8");
    const sequences = source.split("\n").flatMap(line => {
      const match = /^([A-F0-9 ]+)\s*; fully-qualified/.exec(line);
      return match ? [String.fromCodePoint(...match[1].trim().split(/\s+/).map(value => Number.parseInt(value, 16)))] : [];
    });
    expect(sequences).toHaveLength(3944);
    expect(catalog.entries.reduce((sum, entry) => sum + entry.variants.length, 0)).toBe(sequences.length);
    for (const sequence of sequences) expect(normalizeEmojiInput(sequence)).toBe(sequence);
  });
  it("searches bilingual names/keywords and shares metadata for skin tones", () => {
    const catalog = getEmojiCatalog();
    const english = catalog.entries.filter(entry => entry.search.includes("thumbs up"));
    const chinese = catalog.entries.filter(entry => entry.search.includes("拇指向上"));
    expect(english.length).toBeGreaterThan(0); expect(chinese.length).toBeGreaterThan(0);
    const thumbs = catalog.entries.find(entry => entry.variants.includes("👍"))!;
    expect(emojiVariant(thumbs, "🏽")).toBe("👍🏽");
    expect(thumbs.variants).toHaveLength(6);
  });
  it("normalizes an entire flag, ZWJ, keycap or tone sequence without accepting multiple emoji", () => {
    for (const sequence of ["🇨🇳", "👨‍👩‍👧‍👦", "👩🏽‍💻", "🫱🏻‍🫲🏿", "1️⃣"]) expect(normalizeEmojiInput(` ${sequence} `)).toBe(sequence);
    expect(normalizeEmojiInput("❤")).toBe("❤️");
    for (const value of ["😀😀", "hello 😀", "🇨", "", "<img src=x>"]) expect(normalizeEmojiInput(value)).toBeNull();
  });
});
