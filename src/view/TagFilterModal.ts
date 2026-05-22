import { FuzzySuggestModal, type App } from "obsidian";
import type { UiStrings } from "../i18n";
import { buildTagTree, normalizeTagPath } from "./tag-tree";

interface TagFilterModalOptions {
  availableTags: string[];
  activeTags: string[];
  strings: UiStrings["toolbar"];
}

interface TagFilterOption {
  value: string;
  displayTag: string;
  selected: boolean;
}

export class TagFilterModal extends FuzzySuggestModal<TagFilterOption> {
  private readonly options: TagFilterOption[];
  private readonly activeTags: string[];
  private readonly onChoose: (tags: string[]) => void;

  constructor(app: App, options: TagFilterModalOptions, onChoose: (tags: string[]) => void) {
    super(app);
    this.setTitle(options.strings.filter.title);
    this.activeTags = normalizeTagList(options.activeTags);
    this.options = buildTagFilterOptions(options.availableTags, this.activeTags);
    this.onChoose = onChoose;
  }

  getItems(): TagFilterOption[] {
    return this.options;
  }

  getItemText(option: TagFilterOption): string {
    return option.selected ? `✓ #${option.displayTag}` : `#${option.displayTag}`;
  }

  onChooseItem(option: TagFilterOption): void {
    const nextTags = option.selected
      ? this.activeTags.filter((tag) => tag !== option.value)
      : normalizeTagList([...this.activeTags, option.value]);
    this.onChoose(nextTags);
  }
}

function buildTagFilterOptions(availableTags: string[], activeTags: string[]): TagFilterOption[] {
  const activeTagSet = new Set(activeTags);
  const optionsByValue = new Map<string, TagFilterOption>();
  const walk = (tags: ReturnType<typeof buildTagTree>): void => {
    for (const tag of tags) {
      if (!optionsByValue.has(tag.tag)) {
        optionsByValue.set(tag.tag, {
          value: tag.tag,
          displayTag: tag.displayTag,
          selected: activeTagSet.has(tag.tag),
        });
      }
      walk(tag.children);
    }
  };

  walk(buildTagTree(availableTags));
  return Array.from(optionsByValue.values()).sort((left, right) => left.value.localeCompare(right.value));
}

function normalizeTagList(tags: string[]): string[] {
  return Array.from(new Set(tags
    .map((tag) => normalizeTagPath(tag))
    .filter((tag) => tag.length > 0)));
}
