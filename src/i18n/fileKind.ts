import type { UiLanguage } from "./types";

export interface FileKindStrings {
  markdown: string;
  base: string;
  canvas: string;
  excalidraw: string;
  diagramEmpty: string;
  diagramMissing: string;
  diagramInvalid: string;
  diagramOversized: string;
  diagramTruncated: string;
}

export const fileKindStrings: Record<UiLanguage, FileKindStrings> = {
  en: {
    diagramEmpty: "This canvas is empty.",
    diagramMissing: "Please install the Excalidraw plugin and enable SVG auto-export.",
    diagramInvalid: "Preview unavailable: invalid diagram or SVG.",
    diagramOversized: "Preview unavailable: file exceeds 512 KiB.",
    diagramTruncated: "Preview shortened to fit the diagram budget.",
    markdown: "Markdown",
    base: "This is a base file.",
    canvas: "This is a canvas file.",
    excalidraw: "This is an excalidraw file.",
  },
  zh: {
    diagramEmpty: "画布为空。",
    diagramMissing: "请安装 Excalidraw 插件并开启 SVG 自动导出。",
    diagramInvalid: "无法预览：图形或 SVG 格式错误。",
    diagramOversized: "无法预览：文件超过 512 KiB。",
    diagramTruncated: "预览已按图形预算截略。",
    markdown: "Markdown",
    base: "这是一个 Base 文件。",
    canvas: "这是一个 Canvas 文件。",
    excalidraw: "这是一个 Excalidraw 文件。",
  },
};
