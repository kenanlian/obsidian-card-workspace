/** Theme-adaptive card fills. Only these identifiers may reach CSS. */
export const CARD_BACKGROUND_TINTS = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"] as const;
export type CardBackgroundTint = typeof CARD_BACKGROUND_TINTS[number];
export type CardBackgroundColor = "theme" | CardBackgroundTint;
export function isCardBackgroundTint(value: unknown): value is CardBackgroundTint {
  return (CARD_BACKGROUND_TINTS as readonly unknown[]).includes(value);
}
export function isCardBackgroundColor(value: unknown): value is CardBackgroundColor {
  return value === "theme" || isCardBackgroundTint(value);
}
export function normalizeCardBackgroundOverrides(value: unknown): Record<string, CardBackgroundTint> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([path, color]) => path.length > 0 && path.trim() === path && isCardBackgroundTint(color)));
}
