import { TFile, type App } from "obsidian";

const FRONTMATTER_IMAGE_KEYS = ["cover", "image", "banner", "thumbnail", "hero", "cardImage"];

export function stripMarkdownToText(markdown: string, maxLength = 260): string {
  const text = markdown
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/!\[\[[^\]]+]]/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\[\[([^\]#|]+)(?:#[^\]|]+)?(?:\|([^\]]+))?]]/g, (_, link, alias) => alias ?? link)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[>*_~]/g, " ")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength).trimEnd()}...`;
}

export function pickFrontmatterImage(frontmatter: Record<string, unknown> | undefined): string | null {
  if (!frontmatter) {
    return null;
  }

  for (const key of FRONTMATTER_IMAGE_KEYS) {
    const value = frontmatter[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      const first = value.find((item) => typeof item === "string" && item.trim().length > 0);
      if (typeof first === "string") {
        return first.trim();
      }
    }
  }
  return null;
}

export function extractFirstInlineImage(markdown: string): string | null {
  const wiki = markdown.match(/!\[\[([^\]]+)]]/);
  if (wiki?.[1]) {
    return wiki[1];
  }

  const md = markdown.match(/!\[[^\]]*]\(([^)]+)\)/);
  if (md?.[1]) {
    return md[1];
  }

  const html = markdown.match(/<img\s[^>]*src=["']([^"']+)["']/i);
  return html?.[1] ?? null;
}

export function resolveImageSource(app: App, source: string, contextFile: TFile): string | null {
  const cleaned = cleanupImageTarget(source);
  if (!cleaned) {
    return null;
  }

  if (/^(https?:\/\/|data:)/i.test(cleaned)) {
    return cleaned;
  }

  const local = app.metadataCache.getFirstLinkpathDest(cleaned, contextFile.path);
  if (local instanceof TFile) {
    return app.vault.getResourcePath(local);
  }

  const absolutePath = cleaned.replace(/^\//, "");
  const byPath = app.vault.getAbstractFileByPath(absolutePath);
  if (byPath instanceof TFile) {
    return app.vault.getResourcePath(byPath);
  }

  return null;
}

function cleanupImageTarget(input: string): string {
  let value = input.trim().replace(/^["']|["']$/g, "");

  const titleDivider = value.search(/\s+"[^"]*"$/);
  if (titleDivider > -1) {
    value = value.slice(0, titleDivider);
  }

  const pipeIndex = value.indexOf("|");
  if (pipeIndex > -1) {
    value = value.slice(0, pipeIndex);
  }

  const hashIndex = value.indexOf("#");
  if (hashIndex > -1) {
    value = value.slice(0, hashIndex);
  }

  return decodeURIComponentSafe(value).trim();
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
