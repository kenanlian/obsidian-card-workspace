import type { TFile } from "obsidian";

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

const CARD_PLACEHOLDER_TEXT: Record<CardFileKind, string> = {
  markdown: "Markdown",
  base: "This is a base file.",
  canvas: "This is a canvas file.",
  excalidraw: "This is an excalidraw file.",
};

const CARD_FILE_ICON: Record<CardFileKind, string> = {
  markdown: "file-text",
  base: "database",
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

export function getCardPlaceholderText(kind: CardFileKind): string {
  return CARD_PLACEHOLDER_TEXT[kind];
}

export function getCardFileIcon(kind: CardFileKind): string {
  return CARD_FILE_ICON[kind];
}
