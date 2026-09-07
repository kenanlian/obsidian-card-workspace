import { debounce } from "obsidian";

import {
  mergeSettings,
  migrateSettings,
  normalizeSettings,
  SETTINGS_SCHEMA_VERSION,
  type PartialPluginSettings,
  type PluginSettings,
} from "../settings";
import {
  SETTINGS_LAYER_BY_KEY,
  UnknownSettingsKeyError,
  UnsupportedSettingsSchemaError,
} from "../settings-schema";
import type { PropertyFilterClause } from "../property-filter-settings";
import { resolveSettingsUpdateIntent, type ViewUpdateIntent } from "../view/update-intent";

export interface PreferencesSettings {
  sort: PluginSettings["sort"];
  group: PluginSettings["group"];
  includeSubfolders: boolean;
  defaultView: PluginSettings["defaultView"];
  defaultCardOpenBehavior: PluginSettings["defaultCardOpenBehavior"];
  dragInsertAction: PluginSettings["dragInsertAction"];
  cardCornerRadius: PluginSettings["cardCornerRadius"];
  newNoteTemplate: PluginSettings["newNoteTemplate"];
  previewLines: number;
  showNavItemCounts: boolean;
  navSectionOrder: PluginSettings["navSectionOrder"];
  visiblePropertyKeys: string[];
}

export interface WorkspaceSectionCollapsed {
  favorites: boolean;
  folders: boolean;
  tags: boolean;
  properties: boolean;
  boxes: boolean;
}

export interface WorkspaceSettings {
  lastFolderPath: string;
  expandedFolderPaths: string[];
  expandedTagPaths: string[];
  expandedPropertyKeys: string[];
  activeBoxId: string | null;
  filterTags: string[];
  filterProperties: PropertyFilterClause[];
  navPaneWidth: number;
  navPaneCollapsed: boolean;
  sectionCollapsed: WorkspaceSectionCollapsed;
}

export type WorkspaceSettingsPatch = Omit<Partial<WorkspaceSettings>, "sectionCollapsed"> & {
  sectionCollapsed?: Partial<WorkspaceSectionCollapsed>;
};

export interface UserDataSettings {
  boxes: PluginSettings["boxes"];
  favorites: PluginSettings["favorites"];
  pinnedPaths: string[];
}

export interface SettingsStoreDeps {
  load: () => Promise<unknown>;
  save: (data: unknown) => Promise<void>;
}

const WORKSPACE_DEBOUNCE_MS = 300;

/** Whether the persisted settings document can be read and written by this version. */
export type SettingsCompatibilityStatus = "ready" | "unsupported-schema";

/**
 * Classification authority is the exhaustive `SETTINGS_LAYER_BY_KEY` manifest.
 * A defined top-level key no layer owns is a caller bug: refuse it before any
 * memory mutation or persistence instead of guessing a default layer.
 * `undefined` values keep their "not present" semantics and are skipped.
 */
function assertKnownFlatPatch(patch: object): void {
  const manifest = SETTINGS_LAYER_BY_KEY as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
    if (manifest[key] === undefined) {
      throw new UnknownSettingsKeyError(key);
    }
  }
}

type PersistWaiter = {
  revision: number;
  resolve: () => void;
  reject: (error: unknown) => void;
};

export function hasPatchValues(patch: object): boolean {
  for (const value of Object.values(patch)) {
    if (value === undefined) {
      continue;
    }
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      if (hasPatchValues(value)) {
        return true;
      }
      continue;
    }
    return true;
  }
  return false;
}

export function splitFlatPatch(patch: PartialPluginSettings): {
  preferences: Partial<PreferencesSettings>;
  workspace: WorkspaceSettingsPatch;
  userData: Partial<UserDataSettings>;
} {
  assertKnownFlatPatch(patch);
  const preferences: Partial<PreferencesSettings> = {};
  const workspace: WorkspaceSettingsPatch = {};
  const userData: Partial<UserDataSettings> = {};
  const sectionCollapsed: Partial<WorkspaceSectionCollapsed> = {};

  if (patch.sort !== undefined) preferences.sort = patch.sort as PreferencesSettings["sort"];
  if (patch.group !== undefined) preferences.group = patch.group;
  if (patch.includeSubfolders !== undefined) preferences.includeSubfolders = patch.includeSubfolders;
  if (patch.defaultView !== undefined) preferences.defaultView = patch.defaultView;
  if (patch.defaultCardOpenBehavior !== undefined) {
    preferences.defaultCardOpenBehavior = patch.defaultCardOpenBehavior;
  }
  if (patch.dragInsertAction !== undefined) preferences.dragInsertAction = patch.dragInsertAction;
  if (patch.cardCornerRadius !== undefined) preferences.cardCornerRadius = patch.cardCornerRadius;
  if (patch.newNoteTemplate !== undefined) preferences.newNoteTemplate = patch.newNoteTemplate;
  if (patch.previewLines !== undefined) preferences.previewLines = patch.previewLines;
  if (patch.showNavItemCounts !== undefined) preferences.showNavItemCounts = patch.showNavItemCounts;
  if (patch.navSectionOrder !== undefined) preferences.navSectionOrder = patch.navSectionOrder;
  if (patch.visiblePropertyKeys !== undefined) preferences.visiblePropertyKeys = patch.visiblePropertyKeys;

  if (patch.lastFolderPath !== undefined) workspace.lastFolderPath = patch.lastFolderPath;
  if (patch.expandedFolderPaths !== undefined) workspace.expandedFolderPaths = patch.expandedFolderPaths;
  if (patch.expandedTagPaths !== undefined) workspace.expandedTagPaths = patch.expandedTagPaths;
  if (patch.expandedPropertyKeys !== undefined) workspace.expandedPropertyKeys = patch.expandedPropertyKeys;
  if (patch.activeBoxId !== undefined) workspace.activeBoxId = patch.activeBoxId;
  if (patch.filter?.tags !== undefined) workspace.filterTags = patch.filter.tags;
  if (patch.filter?.properties !== undefined) workspace.filterProperties = patch.filter.properties;
  if (patch.navPaneWidth !== undefined) workspace.navPaneWidth = patch.navPaneWidth;
  if (patch.navPaneCollapsed !== undefined) workspace.navPaneCollapsed = patch.navPaneCollapsed;
  if (patch.sectionCollapsed) Object.assign(sectionCollapsed, patch.sectionCollapsed);
  if (hasPatchValues(sectionCollapsed)) {
    workspace.sectionCollapsed = sectionCollapsed;
  }

  if (patch.boxes !== undefined) userData.boxes = patch.boxes;
  if (patch.favorites !== undefined) userData.favorites = patch.favorites;
  if (patch.pinnedPaths !== undefined) userData.pinnedPaths = patch.pinnedPaths;

  return { preferences, workspace, userData };
}

export interface PersistedSettingsV2 {
  schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  preferences: PreferencesSettings;
  workspace: WorkspaceSettings;
  userData: UserDataSettings;
}

export function serializeSettings(settings: PluginSettings): PersistedSettingsV2 {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    preferences: {
      sort: { ...settings.sort },
      group: { ...settings.group },
      includeSubfolders: settings.includeSubfolders,
      defaultView: settings.defaultView,
      defaultCardOpenBehavior: settings.defaultCardOpenBehavior,
      dragInsertAction: settings.dragInsertAction,
      cardCornerRadius: settings.cardCornerRadius,
      newNoteTemplate: settings.newNoteTemplate,
      previewLines: settings.previewLines,
      showNavItemCounts: settings.showNavItemCounts,
      navSectionOrder: [...settings.navSectionOrder],
      visiblePropertyKeys: [...settings.visiblePropertyKeys],
    },
    workspace: {
      lastFolderPath: settings.lastFolderPath,
      expandedFolderPaths: [...settings.expandedFolderPaths],
      expandedTagPaths: [...settings.expandedTagPaths],
      expandedPropertyKeys: [...settings.expandedPropertyKeys],
      activeBoxId: settings.activeBoxId,
      filterTags: [...settings.filter.tags],
      filterProperties: settings.filter.properties.map((clause) => ({
        key: clause.key,
        values: clause.values.map((ref) => ({ ...ref })),
      })),
      navPaneWidth: settings.navPaneWidth,
      navPaneCollapsed: settings.navPaneCollapsed,
      sectionCollapsed: { ...settings.sectionCollapsed },
    },
    userData: {
      boxes: settings.boxes,
      favorites: settings.favorites,
      pinnedPaths: [...settings.pinnedPaths],
    },
  };
}

function workspacePatchToFlat(patch: WorkspaceSettingsPatch): PartialPluginSettings {
  const flat: PartialPluginSettings = {};
  if (patch.lastFolderPath !== undefined) flat.lastFolderPath = patch.lastFolderPath;
  if (patch.expandedFolderPaths !== undefined) flat.expandedFolderPaths = patch.expandedFolderPaths;
  if (patch.expandedTagPaths !== undefined) flat.expandedTagPaths = patch.expandedTagPaths;
  if (patch.expandedPropertyKeys !== undefined) flat.expandedPropertyKeys = patch.expandedPropertyKeys;
  if (patch.activeBoxId !== undefined) flat.activeBoxId = patch.activeBoxId;
  // Map each filter arm independently so a tags-only patch never clears
  // filter.properties and a properties-only patch never clears filter.tags.
  const filter: { tags?: string[]; properties?: PropertyFilterClause[] } = {};
  if (patch.filterTags !== undefined) filter.tags = patch.filterTags;
  if (patch.filterProperties !== undefined) filter.properties = patch.filterProperties;
  if (filter.tags !== undefined || filter.properties !== undefined) flat.filter = filter;
  if (patch.navPaneWidth !== undefined) flat.navPaneWidth = patch.navPaneWidth;
  if (patch.navPaneCollapsed !== undefined) flat.navPaneCollapsed = patch.navPaneCollapsed;
  const collapsed = patch.sectionCollapsed;
  if (collapsed) flat.sectionCollapsed = { ...collapsed };
  return flat;
}

/**
 * Owns the in-memory settings snapshot and a single serialized write queue.
 * Disk format is v2 three-layer JSON; getFlat() remains the flattened PluginSettings view.
 */
export class SettingsStore {
  private readonly load: () => Promise<unknown>;
  private readonly save: (data: unknown) => Promise<void>;
  private memory: PluginSettings = normalizeSettings(undefined);
  private revision = 0;
  private persistedRevision = 0;
  private dirty = false;
  private pending: Promise<void> | null = null;
  private persistWaiters: PersistWaiter[] = [];
  private compatibility: SettingsCompatibilityStatus = "ready";
  private unsupportedSchemaError: UnsupportedSettingsSchemaError | null = null;
  private readonly debouncedWorkspaceWrite: (() => void) & {
    cancel: () => void;
  };

  constructor(deps: SettingsStoreDeps) {
    this.load = deps.load;
    this.save = deps.save;
    this.debouncedWorkspaceWrite = debounce(
      () => {
        this.enqueueWrite();
      },
      WORKSPACE_DEBOUNCE_MS,
      false,
    );
  }

  async init(): Promise<SettingsCompatibilityStatus> {
    this.debouncedWorkspaceWrite.cancel();
    const raw = await this.load();
    try {
      this.memory = migrateSettings(raw);
      this.compatibility = "ready";
      this.unsupportedSchemaError = null;
    } catch (error) {
      if (!(error instanceof UnsupportedSettingsSchemaError)) {
        throw error;
      }
      // Future-schema document: keep a usable default read view, start no
      // dirty revision, and never write the document back.
      this.compatibility = "unsupported-schema";
      this.unsupportedSchemaError = error;
      this.memory = normalizeSettings(undefined);
    }
    this.revision = 0;
    this.persistedRevision = 0;
    this.dirty = false;
    return this.compatibility;
  }

  /** Compatibility state of the loaded document: writable, or read-only defaults. */
  getCompatibility(): SettingsCompatibilityStatus {
    return this.compatibility;
  }

  /** C7: collapse boxes to browse mode on launch without persisting. */
  applyLaunchOverride(): void {
    this.memory = { ...this.memory, activeBoxId: null };
  }

  getFlat(): PluginSettings {
    return normalizeSettings(this.memory);
  }

  updatePreferences(patch: Partial<PreferencesSettings>): Promise<ViewUpdateIntent | null> {
    return this.commitPatch(patch as PartialPluginSettings, "immediate");
  }

  updateWorkspace(patch: WorkspaceSettingsPatch): Promise<ViewUpdateIntent | null> {
    return this.commitPatch(workspacePatchToFlat(patch), "workspace");
  }

  updateUserData(patch: Partial<UserDataSettings>): Promise<ViewUpdateIntent | null> {
    return this.commitPatch(patch as PartialPluginSettings, "immediate");
  }

  /**
   * Atomic flat-patch entry point used by `main.saveSettings()`: the complete
   * patch is normalized once, revision increments once, and one whole v2
   * document is serialized. A patch carrying any preference/userData value
   * persists immediately; a workspace-only patch retains the 300 ms debounce.
   * A cross-layer chooser commit therefore never starts a partial first save.
   * A patch naming an unknown top-level key rejects before any mutation, and a
   * patch that normalizes to the current values is a semantic no-op that never
   * revises, schedules, or writes.
   */
  updateFlat(patch: PartialPluginSettings): Promise<ViewUpdateIntent | null> {
    try {
      const { preferences, userData } = splitFlatPatch(patch);
      const persist = hasPatchValues(preferences) || hasPatchValues(userData)
        ? "immediate"
        : "workspace";
      return this.commitPatch(patch, persist);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async flushPendingWrites(): Promise<void> {
    if (this.compatibility === "unsupported-schema") {
      // Never create or overwrite a future-schema document on flush.
      this.debouncedWorkspaceWrite.cancel();
      return;
    }
    const target = this.revision;
    this.debouncedWorkspaceWrite.cancel();
    if (this.persistedRevision >= target) {
      return;
    }
    const wait = this.waitForPersisted(target);
    this.enqueueWrite();
    await wait;
  }

  private commitPatch(
    flatPatch: PartialPluginSettings,
    persist: "immediate" | "workspace",
  ): Promise<ViewUpdateIntent | null> {
    if (this.compatibility === "unsupported-schema") {
      // Defensive fallback: the blocked state always carries the typed error.
      return Promise.reject(
        this.unsupportedSchemaError
          ?? new UnsupportedSettingsSchemaError(SETTINGS_SCHEMA_VERSION + 1, SETTINGS_SCHEMA_VERSION),
      );
    }
    try {
      assertKnownFlatPatch(flatPatch);
    } catch (error) {
      return Promise.reject(error);
    }
    if (!hasPatchValues(flatPatch)) {
      return Promise.resolve(null);
    }

    // Normalize/merge once and compare semantically before touching state: a
    // no-op patch must not change memory identity, revision, debounce state,
    // waiters, or issue a write.
    const previous = this.getFlat();
    const next = mergeSettings(this.memory, flatPatch);
    const intent = resolveSettingsUpdateIntent(previous, next);
    if (intent === null) {
      return Promise.resolve(null);
    }

    this.memory = next;
    this.revision += 1;
    const myRevision = this.revision;
    const wait = this.waitForPersisted(myRevision);
    if (persist === "workspace") {
      this.debouncedWorkspaceWrite();
    } else {
      this.enqueueWrite();
    }
    return wait.then(() => intent);
  }

  private waitForPersisted(revision: number): Promise<void> {
    if (this.persistedRevision >= revision) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.persistWaiters.push({ revision, resolve, reject });
    });
  }

  private resolveWaiters(upTo: number): void {
    const remaining: PersistWaiter[] = [];
    for (const waiter of this.persistWaiters) {
      if (waiter.revision <= upTo) {
        waiter.resolve();
      } else {
        remaining.push(waiter);
      }
    }
    this.persistWaiters = remaining;
  }

  private rejectUnpersistedWaiters(error: unknown): void {
    const remaining: PersistWaiter[] = [];
    for (const waiter of this.persistWaiters) {
      if (waiter.revision > this.persistedRevision) {
        waiter.reject(error);
      } else {
        remaining.push(waiter);
      }
    }
    this.persistWaiters = remaining;
  }

  private enqueueWrite(): void {
    this.dirty = true;
    if (this.pending !== null) {
      return;
    }
    this.pending = this.drain().then(
      () => {
        this.pending = null;
        if (this.dirty) {
          this.enqueueWrite();
        }
      },
      () => {
        this.pending = null;
      },
    );
  }

  private async drain(): Promise<void> {
    while (this.dirty) {
      this.dirty = false;
      if (this.persistedRevision === this.revision) {
        this.resolveWaiters(this.persistedRevision);
        return;
      }
      const revisionAtStart = this.revision;
      try {
        await this.save(serializeSettings(this.getFlat()));
      } catch (error) {
        this.dirty = true;
        this.rejectUnpersistedWaiters(error);
        throw error;
      }
      this.persistedRevision = revisionAtStart;
      this.resolveWaiters(revisionAtStart);
      if (this.revision === this.persistedRevision) {
        this.dirty = false;
      }
    }
  }
}
