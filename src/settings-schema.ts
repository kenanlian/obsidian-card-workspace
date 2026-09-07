import type { PluginSettings } from "./settings";

/**
 * Neutral persistence contract for the settings document.
 *
 * This module owns the schema identity, the exhaustive key-to-layer manifest,
 * and the typed refusals used when a document or patch must not be
 * reinterpreted. Its only import back into `settings.ts` is type-only and is
 * erased at runtime, so the value-level dependency stays one-directional.
 */

/** Schema version of the persisted three-layer settings document. */
export const SETTINGS_SCHEMA_VERSION = 2;

export type SettingsLayer = "preferences" | "workspace" | "userData";

/**
 * The single exhaustive declaration of which persisted layer owns every
 * `PluginSettings` key. A new settings key must be added here together with its
 * normalization/serialization in their owning modules; a runtime patch naming a
 * top-level key missing from this manifest is rejected at the `SettingsStore`
 * boundary instead of silently falling back to a default layer.
 */
export const SETTINGS_LAYER_BY_KEY = {
  // preferences layer
  sort: "preferences",
  group: "preferences",
  includeSubfolders: "preferences",
  defaultView: "preferences",
  defaultCardOpenBehavior: "preferences",
  dragInsertAction: "preferences",
  cardCornerRadius: "preferences",
  newNoteTemplate: "preferences",
  previewLines: "preferences",
  showNavItemCounts: "preferences",
  navSectionOrder: "preferences",
  visiblePropertyKeys: "preferences",
  // workspace layer
  lastFolderPath: "workspace",
  expandedFolderPaths: "workspace",
  expandedTagPaths: "workspace",
  expandedPropertyKeys: "workspace",
  activeBoxId: "workspace",
  filter: "workspace",
  navPaneWidth: "workspace",
  navPaneCollapsed: "workspace",
  sectionCollapsed: "workspace",
  // userData layer
  boxes: "userData",
  favorites: "userData",
  pinnedPaths: "userData",
} satisfies Record<keyof PluginSettings, SettingsLayer>;

/**
 * The document was written by a newer Card Workspace version. It is never
 * reinterpreted, migrated, or overwritten by this version.
 */
export class UnsupportedSettingsSchemaError extends Error {
  readonly foundVersion: number;
  readonly supportedVersion: number;

  constructor(foundVersion: number, supportedVersion: number) {
    super(
      `Unsupported Card Workspace settings schema version ${foundVersion}: this version supports up to ${supportedVersion} and will not overwrite the file.`,
    );
    this.name = "UnsupportedSettingsSchemaError";
    this.foundVersion = foundVersion;
    this.supportedVersion = supportedVersion;
  }
}

/** A runtime settings patch named a top-level key that no persistence layer owns. */
export class UnknownSettingsKeyError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`Unknown Card Workspace settings key: ${key}`);
    this.name = "UnknownSettingsKeyError";
    this.key = key;
  }
}

/**
 * Rejects a future schema before any layer is interpreted. Malformed, missing,
 * zero, or legacy version values stay on the existing defensive
 * legacy-normalization path; only a finite integer above the supported version
 * is a refusal.
 */
export function assertSupportedSettingsSchema(version: unknown): void {
  if (
    typeof version === "number"
    && Number.isInteger(version)
    && version > SETTINGS_SCHEMA_VERSION
  ) {
    throw new UnsupportedSettingsSchemaError(version, SETTINGS_SCHEMA_VERSION);
  }
}
