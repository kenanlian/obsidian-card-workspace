import type { UiDensity, UiFontSize } from "../settings";
import type { PanelAppearanceState } from "./panel-model";

const BASE_ESTIMATED_ROW_HEIGHT = 232;

/** Mirrors the `--fce-font-scale` presets in styles.css; only feeds the row estimate. */
const FONT_SCALE: Record<UiFontSize, number> = { small: 0.9, default: 1, large: 1.1, "x-large": 1.2 };

/** Approximate per-row change from the density presets' card padding, gaps, and wall gap. */
const DENSITY_ROW_DELTA: Record<UiDensity, number> = { compact: -18, default: 0, comfortable: 15 };

/** Changes whenever the presentation presets change measured row heights or column metrics. */
export function resolveAppearanceLayoutIdentity(appearance: PanelAppearanceState): string {
  return [appearance.uiFontSize ?? "default", appearance.uiDensity ?? "default", appearance.cardStyle ?? "default"].join("\u0000");
}

/** Height used for rows that have not been measured yet. */
export function estimateRowHeight(appearance: PanelAppearanceState): number {
  const scale = FONT_SCALE[appearance.uiFontSize ?? "default"];
  return Math.round(BASE_ESTIMATED_ROW_HEIGHT * scale + DENSITY_ROW_DELTA[appearance.uiDensity ?? "default"]);
}
