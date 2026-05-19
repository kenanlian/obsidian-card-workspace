import type { TFile } from "obsidian";
import { getUiStrings, type FileKindStrings } from "../i18n";

export type CardFileKind = "markdown" | "base" | "canvas" | "excalidraw";

const CARD_FILE_KIND_RULES: ReadonlyArray<{
  suffix: string;
  kind: CardFileKind;
}> = [
  { suffix: ".excalidraw.md", kind: "excalidraw" },
  { suffix: ".excalidraw", kind: "excalidraw" },
  { suffix: ".canvas", kind: "canvas" },
  { suffix: ".base", kind: "base" },
  { suffix: ".md", kind: "markdown" },
];

const CARD_FILE_ICON: Record<CardFileKind, string> = {
  markdown: "file-text",
  base: "layout-list",
  canvas: "layout-dashboard",
  excalidraw: "pen-tool",
};

export function resolveCardFileKindFromPath(path: string): CardFileKind | null {
  const normalizedPath = path.toLowerCase();

  for (const rule of CARD_FILE_KIND_RULES) {
    if (normalizedPath.endsWith(rule.suffix)) {
      return rule.kind;
    }
  }

  return null;
}

export function resolveCardFileKind(file: TFile): CardFileKind | null {
  return resolveCardFileKindFromPath(file.path);
}

export function isSupportedCardFile(file: TFile): boolean {
  return resolveCardFileKind(file) !== null;
}

export function isMarkdownCardKind(kind: CardFileKind): boolean {
  return kind === "markdown";
}

export function getCardPlaceholderText(
  kind: CardFileKind,
  strings: FileKindStrings = getUiStrings("en").fileKind,
): string {
  return strings[kind];
}

export function getCardFileIcon(kind: CardFileKind): string {
  return CARD_FILE_ICON[kind];
}
