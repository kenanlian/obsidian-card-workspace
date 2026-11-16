import { FuzzySuggestModal, TFolder, type App } from "obsidian";
import type CardWorkspacePlugin from "../../main";
import { createFolderScope, createLinksScope, type CardScope } from "../scope";
import type { PluginSettings } from "../../settings";
import { getStreamUiStrings } from "../stream-ui-strings";

export interface StreamSourceChoice { scope: CardScope; filter?: PluginSettings["filter"] }
type SourceCategory = "sources" | "folders" | "boxes" | "tags" | "properties" | "backlinks" | "outgoing";
interface SourceItem { label: string; choice?: StreamSourceChoice; category?: SourceCategory }

/** Choosing a source creates no stream until the user confirms an actual item. */
export class StreamSourcePicker extends FuzzySuggestModal<SourceItem> {
  private items: SourceItem[] | null = null;
  constructor(app: App, private readonly plugin: CardWorkspacePlugin, private readonly choose: (choice: StreamSourceChoice) => void, private readonly category: SourceCategory = "sources") {
    super(app); this.setPlaceholder(getStreamUiStrings(plugin.getUiLanguage()).create);
  }
  getItems(): SourceItem[] {
    if (this.items) return this.items;
    const settings = this.plugin.getSettings();
    const strings = this.plugin.getUiStrings();
    if (this.category === "sources") return this.items = [
      { label: strings.toolbar.navPane.foldersSection, category: "folders" },
      { label: strings.toolbar.navPane.boxesSection, category: "boxes" },
      { label: strings.toolbar.navPane.tagsSection, category: "tags" },
      { label: strings.property.sectionLabel, category: "properties" },
      { label: strings.links.directionBacklinks, category: "backlinks" },
      { label: strings.links.directionOutgoing, category: "outgoing" },
    ];
    const zh = this.plugin.getUiLanguage() === "zh";
    const root = createFolderScope("", true);
    const items: SourceItem[] = [];
    if (this.category === "folders") items.push({ label: `${zh ? "文件夹" : "Folder"}: /`, choice: { scope: root } });
    if (this.category === "folders") for (const file of this.app.vault.getAllLoadedFiles()) {
      if (file instanceof TFolder && file.path !== "/" && file.path !== "") items.push({ label: `${zh ? "文件夹" : "Folder"}: ${file.path}`, choice: { scope: createFolderScope(file.path, settings.includeSubfolders) } });
    }
    if (this.category === "boxes") for (const box of settings.boxes) items.push({ label: `${zh ? "卡片盒" : "Box"}: ${box.name}`, choice: { scope: { kind: "box", boxId: box.id } } });
    const metadata = this.plugin.navigationMetadataCatalog?.getSnapshot();
    if (this.category === "tags") for (const tag of metadata?.tags ?? []) items.push({ label: `#${tag}`, choice: { scope: root, filter: { tags: [tag], properties: [] } } });
    if (this.category === "properties") for (const property of metadata?.properties ?? []) {
      if (!settings.visiblePropertyKeys.includes(property.key)) continue;
      for (const value of property.values) items.push({ label: `${property.label}: ${"value" in value ? String(value.value) : zh ? "缺失" : "Missing"}`,
        choice: { scope: root, filter: { tags: [], properties: [{ key: property.key, values: [{ ...value }] }] } } });
    }
    const direction = this.category === "backlinks" || this.category === "outgoing" ? this.category : null;
    const active = direction ? this.app.workspace.getActiveFile() : null;
    const references = !direction ? [] : active ? [active, ...this.app.vault.getMarkdownFiles().filter(file => file !== active)] : this.app.vault.getMarkdownFiles();
    if (direction) for (const reference of references) {
      const label = direction === "backlinks" ? this.plugin.getUiStrings().links.directionBacklinks : this.plugin.getUiStrings().links.directionOutgoing;
      items.push({ label: `${label}: ${reference.path}`, choice: { scope: createLinksScope(reference.path, direction) } });
    }
    return this.items = items;
  }
  getItemText(item: SourceItem): string { return item.label; }
  onChooseItem(item: SourceItem): void {
    if (item.choice) this.choose(item.choice);
    else if (item.category) new StreamSourcePicker(this.app, this.plugin, this.choose, item.category).open();
  }
}
