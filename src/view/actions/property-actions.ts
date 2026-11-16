import { getBrowseFilter, getStreamViewConfig, setBrowseFilter } from "../stream-browse-state";
import type { ViewContext } from "../view-context";
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
  context?: ViewContext;
  getApp: () => App;
  getSettings: () => PluginSettings;
  saveSettings: (patch: PartialPluginSettings) => Promise<void>;
  /** Fresh vault frontmatter inventory; invoked once per chooser opening. */
  collectPropertyInventory: () => PropertyInventorySnapshot;
  getStrings: () => UiStrings;
  /** Browse property filter capability for the current source (C6); links disable it. */
  browsePropertyFilterEnabled: () => boolean;
}

export interface PropertyActions {
  /** Opens the searchable chooser; the modal collects a fresh inventory per opening. */
  chooseVisibleProperties(): void;
  /** Clears only `filter.properties`; a no-op when nothing is active or browse filters are disabled. */
  clearPropertyFilters(): Promise<void>;
  /** Hides one key with the same coherent cleanup as the chooser commit. */
  hideProperty(key: string): Promise<void>;
  /** Ordinary (replace/toggle-off) or additive (within-key OR) value selection; no-op when browse filters are disabled. */
  applyValueFilter(key: string, ref: PropertyScalarRef, additive: boolean): Promise<void>;
  /** Replaces all property clauses with the single key/value, never toggling off; no-op when browse filters are disabled. */
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
    ...(settings.group.dimension === "property" && !visibleSet.has(settings.group.propertyKey ?? "")
      ? { group: { dimension: "none" as const, orderBy: settings.group.orderBy, orderDirection: settings.group.orderDirection } } : {}),
    ...(settings.boxes.some((box) => box.group.dimension === "property" && !visibleSet.has(box.group.propertyKey ?? ""))
      ? { boxes: settings.boxes.map((box) => box.group.dimension === "property" && !visibleSet.has(box.group.propertyKey ?? "")
        ? { ...box, group: { dimension: "none" as const, orderBy: box.group.orderBy, orderDirection: box.group.orderDirection } } : box) } : {}),
  };
}

/**
 * Host-callable property lane commands (C9). Publish-independent: the host
 * owns view publication after each save. No-op state changes write nothing.
 */
export function createPropertyActions(deps: PropertyActionsDeps): PropertyActions {
  const getFilter = (): PluginSettings["filter"] => deps.context ? getBrowseFilter(deps.context) : deps.getSettings().filter;
  const saveFilter = (filter: Partial<PluginSettings["filter"]>): Promise<void> => deps.context
    ? setBrowseFilter(deps.context, filter) : deps.saveSettings({ filter });
  async function saveVisibility(visibleKeys: readonly string[]): Promise<void> {
    const patch = buildPropertyVisibilityPatch(deps.getSettings(), visibleKeys);
    const context = deps.context;
    if (context?.browse) {
      const visible = new Set(visibleKeys);
      const config = getStreamViewConfig(context);
      const group = config.group;
      context.browse.update({
        filter: { ...getBrowseFilter(context), properties: normalizePropertyFilterClauses(getBrowseFilter(context).properties, visible) },
        ...(group.dimension === "property" && !visible.has(group.propertyKey ?? "")
          ? { group: { dimension: "none", orderBy: group.orderBy, orderDirection: group.orderDirection } } : {}),
      });
      // Shared property visibility still cleans shared defaults and legacy filter state.
      await deps.saveSettings(patch);
      await context.requestUpdate("reproject", "settings-change");
      return;
    }
    await deps.saveSettings(patch);
  }
  async function savePropertyClauses(next: PropertyFilterClause[], additive = false): Promise<void> {
    const current = getFilter();
    if (propertyFilterClausesEqual(next, current.properties) && (additive || next.length === 0 || current.tags.length === 0)) {
      return;
    }
    await saveFilter(!additive && next.length > 0 ? { tags: [], properties: next } : { properties: next });
  }

  return {
    chooseVisibleProperties(): void {
      const settings = deps.getSettings();
      new PropertyPickerModal(deps.getApp(), {
        strings: deps.getStrings(),
        selectedKeys: settings.visiblePropertyKeys,
        collectPropertyInventory: deps.collectPropertyInventory,
        onSubmit: async (visibleKeys) => {
          await saveVisibility(visibleKeys);
        },
      }).open();
    },

    async clearPropertyFilters(): Promise<void> {
      if (!deps.browsePropertyFilterEnabled() || getFilter().properties.length === 0) {
        return;
      }
      await saveFilter({ properties: [] });
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
      await saveVisibility(nextVisible);
    },

    async applyValueFilter(key, ref, additive): Promise<void> {
      if (!deps.browsePropertyFilterEnabled()) {
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
        getFilter().properties,
        key,
        ref,
        additive,
      );
      await savePropertyClauses(next, additive);
    },

    async filterByOnlyValue(key, ref): Promise<void> {
      if (!deps.browsePropertyFilterEnabled()) {
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
