import type { App } from "obsidian";
import type { UiStrings } from "../../i18n";
import {
  normalizeExpandedPropertyKeys,
  normalizePropertyFilterClauses,
  normalizePropertyKey,
  propertyFilterClausesEqual,
  resolvePropertyValueSelection,
  type PropertyFilterClause,
  type PropertyInventorySnapshot,
  type PropertyScalarRef,
} from "../../property-filter-settings";
import type { PartialPluginSettings, PluginSettings } from "../../settings";
import { PropertyPickerModal } from "../modals/PropertyPickerModal";

export interface PropertyActionsDeps {
  getApp: () => App;
  getSettings: () => PluginSettings;
  saveSettings: (patch: PartialPluginSettings) => Promise<void>;
  /** Fresh vault frontmatter inventory; invoked once per chooser opening. */
  collectPropertyInventory: () => PropertyInventorySnapshot;
  getStrings: () => UiStrings;
  /** True inside a card box, where browse property filtering is disabled. */
  isBoxScope: () => boolean;
}

export interface PropertyActions {
  /** Opens the searchable chooser; the modal collects a fresh inventory per opening. */
  chooseVisibleProperties(): void;
  /** Clears only `filter.properties`; a no-op when nothing is active or in a box. */
  clearPropertyFilters(): Promise<void>;
  /** Hides one key with the same coherent cleanup as the chooser commit. */
  hideProperty(key: string): Promise<void>;
  /** Ordinary (replace/toggle-off) or additive (within-key OR) value selection; no-op in a box. */
  applyValueFilter(key: string, ref: PropertyScalarRef, additive: boolean): Promise<void>;
  /** Replaces all property clauses with the single key/value, never toggling off; no-op in a box. */
  filterByOnlyValue(key: string, ref: PropertyScalarRef): Promise<void>;
}

/**
 * One coherent visibility patch: sets the visible keys, drops hidden keys'
 * expansions and active clauses, and expands newly enabled keys so their
 * values are immediately visible. Tags and all other settings are untouched.
 */
export function buildPropertyVisibilityPatch(
  settings: PluginSettings,
  visiblePropertyKeys: readonly string[],
): PartialPluginSettings {
  const visibleSet = new Set(visiblePropertyKeys);
  const previouslyVisible = new Set(settings.visiblePropertyKeys);
  const newlyEnabled = visiblePropertyKeys.filter((key) => !previouslyVisible.has(key));
  const retainedExpansion = settings.expandedPropertyKeys.filter((key) => visibleSet.has(key));
  return {
    visiblePropertyKeys: [...visiblePropertyKeys],
    expandedPropertyKeys: normalizeExpandedPropertyKeys(
      [...retainedExpansion, ...newlyEnabled],
      visibleSet,
    ),
    filter: { properties: normalizePropertyFilterClauses(settings.filter.properties, visibleSet) },
  };
}

/**
 * Host-callable property lane commands (C9). Publish-independent: the host
 * owns view publication after each save. No-op state changes write nothing.
 */
export function createPropertyActions(deps: PropertyActionsDeps): PropertyActions {
  async function savePropertyClauses(next: PropertyFilterClause[]): Promise<void> {
    if (propertyFilterClausesEqual(next, deps.getSettings().filter.properties)) {
      return;
    }
    await deps.saveSettings({ filter: { properties: next } });
  }

  return {
    chooseVisibleProperties(): void {
      const settings = deps.getSettings();
      new PropertyPickerModal(deps.getApp(), {
        strings: deps.getStrings(),
        selectedKeys: settings.visiblePropertyKeys,
        collectPropertyInventory: deps.collectPropertyInventory,
        onSubmit: async (visibleKeys) => {
          await deps.saveSettings(buildPropertyVisibilityPatch(deps.getSettings(), visibleKeys));
        },
      }).open();
    },

    async clearPropertyFilters(): Promise<void> {
      if (deps.isBoxScope() || deps.getSettings().filter.properties.length === 0) {
        return;
      }
      await deps.saveSettings({ filter: { properties: [] } });
    },

    async hideProperty(key: string): Promise<void> {
      const normalizedKey = normalizePropertyKey(key);
      if (normalizedKey === null) {
        return;
      }
      const settings = deps.getSettings();
      if (!settings.visiblePropertyKeys.includes(normalizedKey)) {
        return;
      }
      const nextVisible = settings.visiblePropertyKeys.filter((key2) => key2 !== normalizedKey);
      await deps.saveSettings(buildPropertyVisibilityPatch(settings, nextVisible));
    },

    async applyValueFilter(key, ref, additive): Promise<void> {
      if (deps.isBoxScope()) {
        return;
      }
      const normalizedKey = normalizePropertyKey(key);
      if (normalizedKey === null) {
        return;
      }
      const settings = deps.getSettings();
      if (!settings.visiblePropertyKeys.includes(normalizedKey)) {
        return;
      }
      const next = resolvePropertyValueSelection(
        settings.filter.properties,
        key,
        ref,
        additive,
      );
      await savePropertyClauses(next);
    },

    async filterByOnlyValue(key, ref): Promise<void> {
      if (deps.isBoxScope()) {
        return;
      }
      const normalizedKey = normalizePropertyKey(key);
      if (normalizedKey === null) {
        return;
      }
      const settings = deps.getSettings();
      if (!settings.visiblePropertyKeys.includes(normalizedKey)) {
        return;
      }
      // Resolving against an empty clause list always yields the single key/value.
      const next = resolvePropertyValueSelection([], key, ref, false);
      await savePropertyClauses(next);
    },
  };
}
