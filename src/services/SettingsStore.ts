import { debounce } from "obsidian";

import {
  mergeSettings,
  migrateSettings,
  normalizeSettings,
  SETTINGS_SCHEMA_VERSION,
  type PartialPluginSettings,
  type PluginSettings,
} from "../settings";
import { resolveSettingsUpdateIntent, type ViewUpdateIntent } from "../view/update-intent";

export interface PreferencesSettings {
  sort: PluginSettings["sort"];
  includeSubfolders: boolean;
  defaultView: PluginSettings["defaultView"];
  defaultCardOpenBehavior: PluginSettings["defaultCardOpenBehavior"];
  dragInsertAction: PluginSettings["dragInsertAction"];
  cardCornerRadius: PluginSettings["cardCornerRadius"];
  newNoteTemplate: PluginSettings["newNoteTemplate"];
  previewLines: number;
  showNavItemCounts: boolean;
}

export interface WorkspaceSectionCollapsed {
  favorites: boolean;
  folders: boolean;
  tags: boolean;
  boxes: boolean;
}

export interface WorkspaceSettings {
  lastFolderPath: string;
  expandedFolderPaths: string[];
  expandedTagPaths: string[];
  activeBoxId: string | null;
  filterTags: string[];
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

const PREFERENCE_KEYS = new Set<string>([
  "sort",
  "includeSubfolders",
  "defaultView",
  "defaultCardOpenBehavior",
  "dragInsertAction",
  "cardCornerRadius",
  "newNoteTemplate",
  "previewLines",
  "showNavItemCounts",
]);

const USER_DATA_KEYS = new Set<string>(["boxes", "favorites", "pinnedPaths"]);

const WORKSPACE_FLAT_KEYS = new Set<string>([
  "lastFolderPath",
  "expandedFolderPaths",
  "expandedTagPaths",
  "activeBoxId",
  "navPaneWidth",
  "navPaneCollapsed",
  "sectionCollapsed",
  "filter",
]);

const WORKSPACE_DEBOUNCE_MS = 300;

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
  const preferences: Partial<PreferencesSettings> = {};
  const workspace: WorkspaceSettingsPatch = {};
  const userData: Partial<UserDataSettings> = {};
  const sectionCollapsed: Partial<WorkspaceSectionCollapsed> = {};

  if (patch.sort !== undefined) preferences.sort = patch.sort as PreferencesSettings["sort"];
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

  if (patch.lastFolderPath !== undefined) workspace.lastFolderPath = patch.lastFolderPath;
  if (patch.expandedFolderPaths !== undefined) workspace.expandedFolderPaths = patch.expandedFolderPaths;
  if (patch.expandedTagPaths !== undefined) workspace.expandedTagPaths = patch.expandedTagPaths;
  if (patch.activeBoxId !== undefined) workspace.activeBoxId = patch.activeBoxId;
  if (patch.filter?.tags !== undefined) workspace.filterTags = patch.filter.tags;
  if (patch.navPaneWidth !== undefined) workspace.navPaneWidth = patch.navPaneWidth;
  if (patch.navPaneCollapsed !== undefined) workspace.navPaneCollapsed = patch.navPaneCollapsed;
  if (patch.sectionCollapsed) Object.assign(sectionCollapsed, patch.sectionCollapsed);
  if (hasPatchValues(sectionCollapsed)) {
    workspace.sectionCollapsed = sectionCollapsed;
  }

  if (patch.boxes !== undefined) userData.boxes = patch.boxes;
  if (patch.favorites !== undefined) userData.favorites = patch.favorites;
  if (patch.pinnedPaths !== undefined) userData.pinnedPaths = patch.pinnedPaths;

  for (const key of Object.keys(patch)) {
    if (PREFERENCE_KEYS.has(key) || USER_DATA_KEYS.has(key) || WORKSPACE_FLAT_KEYS.has(key)) {
      continue;
    }
    (preferences as Record<string, unknown>)[key] = (patch as Record<string, unknown>)[key];
  }

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
      includeSubfolders: settings.includeSubfolders,
      defaultView: settings.defaultView,
      defaultCardOpenBehavior: settings.defaultCardOpenBehavior,
      dragInsertAction: settings.dragInsertAction,
      cardCornerRadius: settings.cardCornerRadius,
      newNoteTemplate: settings.newNoteTemplate,
      previewLines: settings.previewLines,
      showNavItemCounts: settings.showNavItemCounts,
    },
    workspace: {
      lastFolderPath: settings.lastFolderPath,
      expandedFolderPaths: [...settings.expandedFolderPaths],
      expandedTagPaths: [...settings.expandedTagPaths],
      activeBoxId: settings.activeBoxId,
      filterTags: [...settings.filter.tags],
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
  if (patch.activeBoxId !== undefined) flat.activeBoxId = patch.activeBoxId;
  if (patch.filterTags !== undefined) flat.filter = { tags: patch.filterTags };
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

  async init(): Promise<void> {
    this.debouncedWorkspaceWrite.cancel();
    this.memory = migrateSettings(await this.load());
    this.revision = 0;
    this.persistedRevision = 0;
    this.dirty = false;
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

  async flushPendingWrites(): Promise<void> {
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
    if (!hasPatchValues(flatPatch)) {
      return Promise.resolve(null);
    }

    const previous = this.getFlat();
    this.memory = mergeSettings(this.memory, flatPatch);
    this.revision += 1;
    const myRevision = this.revision;
    const intent = resolveSettingsUpdateIntent(previous, this.getFlat());
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
