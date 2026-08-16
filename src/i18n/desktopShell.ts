import type { UiLanguage } from "./types";

export interface DesktopShellStrings {
  unavailable: string;
  unknownError: string;
}

export const desktopShellStrings: Record<UiLanguage, DesktopShellStrings> = {
  en: {
    unavailable: "Desktop shell support is unavailable.",
    unknownError: "Unknown error",
  },
  zh: {
    unavailable: "桌面外壳功能不可用。",
    unknownError: "未知错误",
  },
};
