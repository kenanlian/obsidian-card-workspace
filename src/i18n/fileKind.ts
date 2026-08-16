import type { UiLanguage } from "./types";

export interface FileKindStrings {
  markdown: string;
  base: string;
  canvas: string;
  excalidraw: string;
}

export const fileKindStrings: Record<UiLanguage, FileKindStrings> = {
  en: {
    markdown: "Markdown",
    base: "This is a base file.",
    canvas: "This is a canvas file.",
    excalidraw: "This is an excalidraw file.",
  },
  zh: {
    markdown: "Markdown",
    base: "这是一个 Base 文件。",
    canvas: "这是一个 Canvas 文件。",
    excalidraw: "这是一个 Excalidraw 文件。",
  },
};
