import * as Obsidian from "obsidian";

import { appStrings, type AppStrings } from "./app";
import { boxStrings } from "./box";
import { cardItemStrings, type CardItemStrings } from "./cardItem";
import { desktopShellStrings } from "./desktopShell";
import { fileKindStrings } from "./fileKind";
import { folderPickerStrings } from "./folderPicker";
import { noteOpsStrings } from "./noteOps";
import { panelStrings } from "./panel";
import { propertyStrings } from "./property";
import { settingTabStrings, type SettingTabStrings } from "./settingTab";
import { sortGroupStrings } from "./sortGroup";
import { toolbarStrings, type ToolbarStrings } from "./toolbar";
import type { LocalizedOption, UiLanguage, UiStrings } from "./types";
import { viewStrings } from "./view";

export type { UiLanguage, LocalizedOption, UiStrings } from "./types";
export type { AppStrings } from "./app";
export type { BoxStrings } from "./box";
export type { CardItemStrings } from "./cardItem";
export type { DesktopShellStrings } from "./desktopShell";
export type { FileKindStrings } from "./fileKind";
export type { FolderPickerStrings } from "./folderPicker";
export type { NoteOpsStrings } from "./noteOps";
export type { PanelStrings } from "./panel";
export type { PropertyStrings } from "./property";
export type { SettingTabStrings } from "./settingTab";
export type { SortGroupStrings } from "./sortGroup";
export type { ToolbarStrings } from "./toolbar";
export type { ViewStrings } from "./view";

function safeGetLanguage(): string {
  const maybeGetLanguage = (Obsidian as { getLanguage?: () => string }).getLanguage;
  return typeof maybeGetLanguage === "function" ? maybeGetLanguage() : "en";
}

export function resolveUiLanguage(language: string = safeGetLanguage()): UiLanguage {
  return language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function isChineseLanguage(language: string = safeGetLanguage()): boolean {
  return resolveUiLanguage(language) === "zh";
}

const EN: UiStrings = {
  settingTab: settingTabStrings.en,
  toolbar: toolbarStrings.en,
  sortGroup: sortGroupStrings.en,
  cardItem: cardItemStrings.en,
  folderPicker: folderPickerStrings.en,
  panel: panelStrings.en,
  property: propertyStrings.en,
  fileKind: fileKindStrings.en,
  noteOps: noteOpsStrings.en,
  desktopShell: desktopShellStrings.en,
  box: boxStrings.en,
  view: viewStrings.en,
  app: appStrings.en,
};

const ZH: UiStrings = {
  settingTab: settingTabStrings.zh,
  toolbar: toolbarStrings.zh,
  sortGroup: sortGroupStrings.zh,
  cardItem: cardItemStrings.zh,
  folderPicker: folderPickerStrings.zh,
  panel: panelStrings.zh,
  property: propertyStrings.zh,
  fileKind: fileKindStrings.zh,
  noteOps: noteOpsStrings.zh,
  desktopShell: desktopShellStrings.zh,
  box: boxStrings.zh,
  view: viewStrings.zh,
  app: appStrings.zh,
};

function selectStrings<T>(language: string, english: T, chinese: T): T {
  return resolveUiLanguage(language) === "zh" ? chinese : english;
}

export function getUiStrings(language: string = safeGetLanguage()): UiStrings {
  return selectStrings(language, EN, ZH);
}

export function getSettingTabStrings(language: string = safeGetLanguage()): SettingTabStrings {
  return getUiStrings(language).settingTab;
}

export function getToolbarStrings(language: string = safeGetLanguage()): ToolbarStrings {
  return getUiStrings(language).toolbar;
}

export function getCardItemStrings(language: string = safeGetLanguage()): CardItemStrings {
  return getUiStrings(language).cardItem;
}

export function getAppStrings(language: string = safeGetLanguage()): AppStrings {
  return getUiStrings(language).app;
}

export function getDefaultCardOpenBehaviorOptions(
  language: string = safeGetLanguage(),
): LocalizedOption[] {
  const zh = resolveUiLanguage(language) === "zh";
  return [
    { value: "smart", label: zh ? "当前窗格 / 当前标签页" : "Current pane / current tab" },
    { value: "new-tab", label: zh ? "在新标签页中打开" : "Open in new tab" },
    { value: "split-right", label: zh ? "在右侧分栏打开" : "Open to the right" },
    { value: "new-window", label: zh ? "在新窗口中打开" : "Open in new window" },
  ];
}

export function getDragInsertActionOptions(
  language: string = safeGetLanguage(),
): LocalizedOption[] {
  const zh = resolveUiLanguage(language) === "zh";
  return [
    { value: "ask", label: zh ? "每次弹框确认" : "Ask every time" },
    { value: "wiki", label: zh ? "插入 wiki link" : "Insert wiki link" },
    { value: "embed", label: zh ? "插入嵌入 link" : "Insert embed link" },
    { value: "content", label: zh ? "插入卡片内容" : "Insert card content" },
    { value: "title-content", label: zh ? "插入卡片标题&内容" : "Insert card title & content" },
  ];
}

export function getNewNoteTemplateOptions(
  language: string = safeGetLanguage(),
): LocalizedOption[] {
  const zh = resolveUiLanguage(language) === "zh";
  return [
    { value: "tags-frontmatter", label: zh ? "带 tags 属性" : "Start with a tags property" },
    { value: "blank", label: zh ? "完全空白" : "Start blank" },
  ];
}

export function getCardCornerRadiusOptions(
  language: string = safeGetLanguage(),
): LocalizedOption[] {
  const zh = resolveUiLanguage(language) === "zh";
  return [
    { value: "compact", label: zh ? "紧凑" : "Compact" },
    { value: "medium", label: zh ? "柔和" : "Softer" },
    { value: "rounded", label: zh ? "圆角" : "Rounded" },
  ];
}
