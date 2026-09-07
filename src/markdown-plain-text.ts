// Neutral Markdown-to-plain-text extraction shared by search excerpting and
// view previews. Moved verbatim from src/view/markdown-utils.ts so the search
// subsystem no longer depends on the view layer (contract C7); output is
// byte-for-byte identical to the previous view-owned implementation.
export function stripMarkdownToText(markdown: string, maxLength = 260): string {
  const text = markdown
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, (_match: string, codeText: string) => {
      return /^[A-Za-z0-9 _-]+$/.test(codeText) ? codeText : " ";
    })
    .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
    .replace(/\$([^$\n]+)\$/g, "$1")
    .replace(/\\\((.*?)\\\)/g, "$1")
    .replace(/\\\[(.*?)\\\]/g, "$1")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/!\[\[[^\]]+]]/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\[\[([^\]#|]+)(?:#[^\]|]+)?(?:\|([^\]]+))?]]/g, (_match: string, link: string, alias?: string) => alias ?? link)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+\[(?: |x|X)\]\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~=>]/g, " ")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength).trimEnd()}...`;
}
