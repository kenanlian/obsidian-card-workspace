import type { UiLanguage } from "./types";

export interface FileKindStrings {
  image: string;
  pdf: string;
  audio: string;
  video: string;
  file: string;
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
    image: "Image file", pdf: "PDF document", audio: "Audio file", video: "Video file", file: "File",
    diagramEmpty: "This canvas is empty.",
    diagramMissing: "SVG preview not found. Enable SVG auto-export in Excalidraw, then edit and save the drawing once, or export an SVG manually.",
    diagramInvalid: "Preview unavailable: invalid diagram or SVG.",
    diagramOversized: "Preview unavailable: file exceeds 512 KiB.",
    diagramTruncated: "Preview shortened to fit the diagram budget.",
    markdown: "Markdown",
    base: "This is a base file.",
    canvas: "This is a canvas file.",
    excalidraw: "This is an excalidraw file.",
  },
  zh: {
    image: "图片文件", pdf: "PDF 文档", audio: "音频文件", video: "视频文件", file: "文件",
    diagramEmpty: "画布为空。",
    diagramMissing: "未找到 SVG 预览。请开启 Excalidraw 的 SVG 自动导出，并编辑保存一次绘图，或手动导出 SVG。",
    diagramInvalid: "无法预览：图形或 SVG 格式错误。",
    diagramOversized: "无法预览：文件超过 512 KiB。",
    diagramTruncated: "预览已按图形预算截略。",
    markdown: "Markdown",
    base: "这是一个 Base 文件。",
    canvas: "这是一个 Canvas 文件。",
    excalidraw: "这是一个 Excalidraw 文件。",
  },
};
