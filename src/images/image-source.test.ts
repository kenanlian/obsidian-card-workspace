import { TFile, type App, type CachedMetadata } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { resolveFirstImage } from "./image-source";
const file = (path: string): TFile => Object.assign(new TFile(), { path });
function embed(link: string, offset: number, original = `![[${link}]]`): NonNullable<CachedMetadata["embeds"]>[number] {
  return { link, original, position: { start: { offset, line: offset, col: 0 }, end: { offset: offset + 5, line: offset, col: 5 } } };
}
describe("metadata first local body image", () => {
  it("orders by body position, skips missing/unsupported/remote references and resolves encoded paths", () => {
    const outside = file("attachments/space image.png");
    const getFirstLinkpathDest = vi.fn((path: string) => path === "../attachments/space image.png" ? outside : null);
    const getFileCache = vi.fn(() => ({ embeds: [embed("later.jpeg", 999), embed("missing.png", 100), embed("https://example.com/x.png", 20), embed("x.tiff", 50), embed("note.md", 60), embed("../attachments/space%20image.png", 500, "![alt](../attachments/space%20image.png)")] }));
    const app = { metadataCache: { getFileCache, getFirstLinkpathDest } } as unknown as App;
    expect(resolveFirstImage(app, file("notes/n.md"))).toEqual({ status: "found", file: outside });
    expect(getFirstLinkpathDest).toHaveBeenCalledWith("../attachments/space image.png", "notes/n.md");
    expect(getFirstLinkpathDest).not.toHaveBeenCalledWith("https://example.com/x.png", expect.anything());
  });
  it("keeps missing metadata unknown and excludes frontmatter/HTML/embedded notes", () => {
    const getFileCache = vi.fn<() => CachedMetadata | null>(() => null), getFirstLinkpathDest = vi.fn(() => file("x.png"));
    const app = { metadataCache: { getFileCache, getFirstLinkpathDest } } as unknown as App;
    expect(resolveFirstImage(app, file("n.md"))).toEqual({ status: "unknown" });
    getFileCache.mockReturnValue({ frontmatterPosition: { start: { line: 0, col: 0, offset: 0 }, end: { line: 3, col: 0, offset: 30 } }, embeds: [embed("x.png", 10), embed("x.png", 40, '<img src="x.png">'), embed("x.tiff", 50), embed("x.heic", 60), embed("note.md", 70)] });
    expect(resolveFirstImage(app, file("n.md"))).toEqual({ status: "none" }); expect(getFirstLinkpathDest).not.toHaveBeenCalled();
  });
});
