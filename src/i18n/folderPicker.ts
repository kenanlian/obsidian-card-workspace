import type { UiLanguage } from "./types";

export interface FolderPickerStrings {
  selectFolderTitle: string;
}

export const folderPickerStrings: Record<UiLanguage, FolderPickerStrings> = {
  en: {
    selectFolderTitle: "Select a folder",
  },
  zh: {
    selectFolderTitle: "选择文件夹",
  },
};
