import { EMOJI_CATALOG, EMOJI_GROUPS } from "./emoji-data";

export { EMOJI_GROUPS };
/** Category-bar glyphs by group index; an empty slot (the Component group) is not offered. */
export const EMOJI_GROUP_ICONS = ["😀", "👋", "", "🐻", "🍔", "✈️", "⚽", "💡", "🔣", "🏁"];
export interface EmojiEntry { variants: string[]; group: number; en: string; zh: string; search: string }
export interface EmojiCatalog { entries: EmojiEntry[]; canonical: Map<string, string>; byVariant: Map<string, EmojiEntry>; initializationMs: number }
let catalog: EmojiCatalog | null = null;
/** Intentionally invoked only on first Emoji-tab activation (or explicit catalog tests). */
export function getEmojiCatalog(): EmojiCatalog {
  if (catalog) return catalog;
  const start = performance.now();
  const entries = EMOJI_CATALOG.split("\n").map(line => {
    const [values, group, en, zh, englishKeywords, chineseKeywords] = line.split("\t");
    return { variants: values.split("\x1f"), group: Number(group), en, zh, search: `${en} ${zh} ${englishKeywords} ${chineseKeywords}`.toLowerCase() };
  });
  const canonical = new Map<string, string>();
  const byVariant = new Map<string, EmojiEntry>();
  for (const entry of entries) for (const variant of entry.variants) { canonical.set(variant.replace(/\uFE0F/g, ""), variant); byVariant.set(variant, entry); }
  catalog = { entries, canonical, byVariant, initializationMs: performance.now() - start };
  return catalog;
}
export function isEmojiCatalogInitialized(): boolean { return catalog !== null; }
/** Cheap pre-check that never parses the catalogue. */
export function looksLikeEmoji(input: string): boolean {
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u.test(input);
}
/** Recognize the entire input; never truncate flags, tones, or ZWJ sequences. */
export function normalizeEmojiInput(input: string): string | null {
  return getEmojiCatalog().canonical.get(input.trim().replace(/\uFE0F/g, "")) ?? null;
}
export function emojiVariant(entry: EmojiEntry, tone: string): string {
  if (!tone) return entry.variants[0];
  return entry.variants.find(value => value.includes(tone) && [...value].filter(char => /[\u{1F3FB}-\u{1F3FF}]/u.test(char)).every(char => char === tone)) ?? entry.variants[0];
}
