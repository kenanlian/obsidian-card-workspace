import type { PersistedSettingsV2, PreferencesSettings } from "./SettingsStore";

export const DEVICE_PREFERENCE_KEYS = [
  "sort", "linksSort", "group", "includeSubfolders", "defaultView", "backlinkSnippetCount",
  "cardCornerRadius", "uiFontSize", "uiDensity", "cardStyle", "previewLines", "searchPreviewSnippetCount",
  "cardImageMode", "cardImageFit", "showNavItemCounts", "navSectionOrder", "hiddenNavSections", "visiblePropertyKeys",
  "hoverPreviewWidth", "hoverPreviewHeight", "quickInputWidth", "quickInputHeight", "quickInputColor", "quickInputGlobalShortcut",
] as const satisfies readonly (keyof PreferencesSettings)[];
export interface DeviceSettingsRecord {
  version: 1;
  preferences: Partial<PreferencesSettings>;
  workspace: PersistedSettingsV2["workspace"];
}
export function pickDeviceSettings(document: PersistedSettingsV2): DeviceSettingsRecord {
  return { version: 1, preferences: Object.fromEntries(DEVICE_PREFERENCE_KEYS.map(key => [key, document.preferences[key]])), workspace: document.workspace };
}
export function overlayDeviceSettings(document: PersistedSettingsV2, record: unknown): PersistedSettingsV2 {
  if (!record || typeof record !== "object" || !("version" in record) || record.version !== 1) return document;
  const local = record as DeviceSettingsRecord;
  const preferences = { ...document.preferences };
  for (const key of DEVICE_PREFERENCE_KEYS) {
    if (local.preferences?.[key] !== undefined) Object.assign(preferences, { [key]: local.preferences[key] });
  }
  return { ...document, preferences, workspace: { ...document.workspace, ...local.workspace } };
}
/** Preserve original device defaults in the shared document on every write. */
export function sharedSettings(document: PersistedSettingsV2, original: PersistedSettingsV2): PersistedSettingsV2 {
  const preferences = { ...document.preferences };
  for (const key of DEVICE_PREFERENCE_KEYS) Object.assign(preferences, { [key]: original.preferences[key] });
  return { ...document, preferences, workspace: original.workspace };
}
