import type { AppStrings } from "./app";
import type { BoxStrings } from "./box";
import type { CardItemStrings } from "./cardItem";
import type { DesktopShellStrings } from "./desktopShell";
import type { FileKindStrings } from "./fileKind";
import type { FolderPickerStrings } from "./folderPicker";
import type { NoteOpsStrings } from "./noteOps";
import type { PanelStrings } from "./panel";
import type { SettingTabStrings } from "./settingTab";
import type { ToolbarStrings } from "./toolbar";
import type { ViewStrings } from "./view";

export type UiLanguage = "en" | "zh";

export interface LocalizedOption<TValue extends string = string> {
  value: TValue;
  label: string;
}

export interface UiStrings {
  settingTab: SettingTabStrings;
  toolbar: ToolbarStrings;
  cardItem: CardItemStrings;
  folderPicker: FolderPickerStrings;
  panel: PanelStrings;
  fileKind: FileKindStrings;
  noteOps: NoteOpsStrings;
  desktopShell: DesktopShellStrings;
  box: BoxStrings;
  view: ViewStrings;
  app: AppStrings;
}
