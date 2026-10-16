import { TFile, type Vault } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { buildCanvasPreview, diagramDependencies, DIAGRAM_MAX_BYTES, readDiagramPreview } from "./diagram-preview";

const node = (id: string, type = "text", extra = {}) => ({ id, type, x: -100, y: -50, width: 200, height: 100, text: "hello", ...extra });
function text(blob: Blob): Promise<string> {
  return new Promise((resolve) => { const reader = new FileReader(); reader.addEventListener("load", () => resolve(String(reader.result)), { once: true }); reader.readAsText(blob); });
}
function vaultFixture(paths: string[], source: string) {
  const files = new Map(paths.map((path) => [path, Object.assign(new TFile(), { path, stat: { mtime: 1, size: source.length } })]));
  const cachedRead = vi.fn(async () => source);
  const vault = { getAbstractFileByPath: (path: string) => files.get(path) ?? null, cachedRead } as unknown as Vault;
  return { vault, files, cachedRead };
}

describe("bounded Canvas SVG", () => {
  describe.each(["text", "file", "link", "group"])("%s node colors", (type) => {
    it.each([
      ["1", "#f9cdd0", "#e8c0c7"], ["2", "#f4e1cd", "#e4d4c4"],
      ["3", "#f2f3d9", "#e2e6d0"], ["4", "#cbefd9", "#bbe2d0"],
      ["5", "#cff3f4", "#bee6eb"], ["6", "#e4dcfd", "#d4cff4"],
    ])("renders preset %s with the expected soft fill", async (color, fill, groupFill) => {
      const result = await buildCanvasPreview(JSON.stringify({ nodes: [node("a", type, { color })], edges: [] }), () => true);
      expect(result).toMatchObject({ status: "ready", truncated: false });
      if (result?.status !== "ready") throw new Error("expected SVG");
      const doc = new DOMParser().parseFromString(await text(result.blob), "image/svg+xml");
      expect(doc.querySelector("parsererror")).toBeNull();
      expect(doc.querySelector("rect")?.getAttribute("fill")).toBe(type === "group" ? groupFill : fill);
    });

    it("keeps the default fill when color is absent", async () => {
      const result = await buildCanvasPreview(JSON.stringify({ nodes: [node("a", type)], edges: [] }), () => true);
      if (result?.status !== "ready") throw new Error("expected SVG");
      const doc = new DOMParser().parseFromString(await text(result.blob), "image/svg+xml");
      expect(doc.querySelector("rect")?.getAttribute("fill")).toBe(type === "group" ? "#e2e8f0" : "#f8fafc");
    });

    it.each(["", "0", "7", "01", "1 ", 1, null, true, {}, [], ["1"], "#fb464c", "__proto__", "constructor", "toString"]
      .map((color) => ({ color })))("keeps the node and default fill for invalid color $color", async ({ color }) => {
      const result = await buildCanvasPreview(JSON.stringify({ nodes: [node("a", type, { color })], edges: [] }), () => true);
      expect(result).toMatchObject({ status: "ready", truncated: false });
      if (result?.status !== "ready") throw new Error("expected SVG");
      const doc = new DOMParser().parseFromString(await text(result.blob), "image/svg+xml");
      expect(doc.querySelector("parsererror")).toBeNull();
      expect(doc.querySelectorAll("rect")).toHaveLength(1);
      expect(doc.querySelector("rect")?.getAttribute("fill")).toBe(type === "group" ? "#e2e8f0" : "#f8fafc");
    });

    it("excludes malicious color text from SVG", async () => {
      const color = '#fff" onload="alert(1)"><script>malicious</script>';
      const result = await buildCanvasPreview(JSON.stringify({ nodes: [node("a", type, { color })], edges: [] }), () => true);
      if (result?.status !== "ready") throw new Error("expected SVG");
      const svg = await text(result.blob), doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      expect(svg).not.toContain(color);
      expect(doc.querySelector("parsererror, script, [onload]")).toBeNull();
      expect(doc.querySelector("rect")?.getAttribute("fill")).toBe(type === "group" ? "#e2e8f0" : "#f8fafc");
    });
  });

  it("draws colored groups before edges and ordinary nodes while retaining text and stroke colors", async () => {
    const source = JSON.stringify({ nodes: [node("a", "text", { color: "1" }),
      node("b", "group", { color: "6", label: "Group" })], edges: [{ fromNode: "a", toNode: "b", label: "Edge" }] });
    const result = await buildCanvasPreview(source, () => true);
    if (result?.status !== "ready") throw new Error("expected SVG");
    const doc = new DOMParser().parseFromString(await text(result.blob), "image/svg+xml");
    const shapes = [...doc.querySelectorAll("rect, line")];
    expect(shapes.map((shape) => shape.localName)).toEqual(["rect", "line", "rect"]);
    expect(shapes.map((shape) => shape.getAttribute("fill"))).toEqual(["#d4cff4", null, "#f9cdd0"]);
    expect(shapes.map((shape) => shape.getAttribute("stroke"))).toEqual(["#64748b", "#475569", "#64748b"]);
    expect([...doc.querySelectorAll("text")].map((label) => label.getAttribute("fill"))).toEqual(["#1e293b", "#1e293b", "#1e293b"]);
  });

  it("renders groups first, relative negative geometry, node labels, endpoints and arrows with XML escaping", async () => {
    const source = JSON.stringify({ nodes: [node("text", "text", { text: '<script>&"\'\nhello' }),
      node("file", "file", { x: 150, file: "private/文件.md" }), node("link", "link", { url: "https://example.invalid" }),
      node("group", "group", { x: -200, width: 800, label: "Group" })], edges: [
      { fromNode: "text", toNode: "file", fromSide: "right", toSide: "left", fromEnd: "arrow", label: "a < b" },
      { fromNode: "missing", toNode: "file" }, { fromNode: "file", toNode: "text", toEnd: "none" },
    ] });
    const result = await buildCanvasPreview(source, () => true);
    expect(result?.status).toBe("ready");
    if (result?.status !== "ready") return;
    const svg = await text(result.blob);
    expect(svg).toContain('&lt;script&gt;&amp;&quot;&apos; hello');
    expect(svg).toContain("文件.md"); expect(svg).toContain("https://example.invalid");
    expect(svg).toContain('x1="100" y1="0" x2="150" y2="0"');
    expect(svg).toContain('marker-start="url(#arrow)"');
    expect(svg.indexOf('fill="#e2e8f0"')).toBeLessThan(svg.indexOf("<line"));
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull(); expect(doc.querySelectorAll("line")).toHaveLength(2);
    expect(doc.querySelectorAll("image,script,a,foreignObject")).toHaveLength(0);
  });
  it.each(["", "{", "null", "[]", '{"nodes":{}}', '{"nodes":[],"edges":null}'])("rejects malformed structure %s", async (source) => {
    expect(await buildCanvasPreview(source, () => true)).toEqual({ status: "invalid" });
  });
  it("skips invalid fields and duplicate IDs, and handles an empty canvas", async () => {
    for (const nodes of [[], [node("a", "unknown"), node("b", "text", { width: -1 }), node("c", "text", { x: "10" })]]) {
      expect(await buildCanvasPreview(JSON.stringify({ nodes, edges: [] }), () => true)).toEqual({ status: "empty" });
    }
    const result = await buildCanvasPreview(JSON.stringify({ nodes: [node("a"), node("a")], edges: [] }), () => true);
    if (result?.status !== "ready") throw new Error("expected SVG");
    expect(new DOMParser().parseFromString(await text(result.blob), "image/svg+xml").querySelectorAll("rect")).toHaveLength(1);
  });
  it("caps valid nodes, edges and labels and reports truncation", async () => {
    const nodes = Array.from({ length: 201 }, (_, index) => node(String(index), "text", { text: "a".repeat(81) }));
    const edges = Array.from({ length: 401 }, () => ({ fromNode: "0", toNode: "1" }));
    const result = await buildCanvasPreview(JSON.stringify({ nodes, edges }), () => true);
    expect(result).toMatchObject({ status: "ready", truncated: true });
    if (result?.status !== "ready") return;
    const svg = await text(result.blob), doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.querySelectorAll("rect")).toHaveLength(200); expect(doc.querySelectorAll("line")).toHaveLength(400);
    expect(svg).not.toContain("a".repeat(81));
  });
  it("enforces byte budgets and checks cancellation after yielding", async () => {
    expect(await buildCanvasPreview("中".repeat(DIAGRAM_MAX_BYTES / 2), () => true)).toEqual({ status: "oversized" });
    expect(await buildCanvasPreview(JSON.stringify({ nodes: [node("a")], edges: [] }), () => false)).toBeUndefined();
  });
  it("reads only Canvas JSON, without following file or link nodes", async () => {
    const source = JSON.stringify({ nodes: [node("a", "file", { file: "secret.md" }), node("b", "link", { url: "https://example.invalid" })], edges: [] });
    const h = vaultFixture(["a.canvas", "secret.md"], source);
    expect(await readDiagramPreview(h.vault, "a.canvas", () => true)).toMatchObject({ status: "ready" });
    expect(h.cachedRead).toHaveBeenCalledExactlyOnceWith(h.files.get("a.canvas"));
  });
});

describe("same-directory Excalidraw exports", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
  it.each([
    ["文件 夹/图.excalidraw", "文件 夹/图.svg", "文件 夹/图.excalidraw.svg"],
    ["文件 夹/图.excalidraw.md", "文件 夹/图.excalidraw.svg", "文件 夹/图.svg"],
    ["图 1.excalidraw.md", "图 1.excalidraw.svg", "图 1.svg"],
    ["图.EXCALIDRAW.MD", "图.EXCALIDRAW.svg", "图.svg"],
  ])("prefers the exact export convention for %s and never reads the scene", async (path, preferred, alternate) => {
    expect(diagramDependencies(path)).toEqual([path, preferred, alternate]);
    const h = vaultFixture([path, preferred, alternate], svg);
    expect(await readDiagramPreview(h.vault, path, () => true)).toMatchObject({ status: "ready" });
    expect(h.cachedRead).toHaveBeenCalledExactlyOnceWith(h.files.get(preferred));
    h.files.delete(preferred); h.cachedRead.mockClear();
    expect(await readDiagramPreview(h.vault, path, () => true)).toMatchObject({ status: "ready" });
    expect(h.cachedRead).toHaveBeenCalledExactlyOnceWith(h.files.get(alternate));
    h.files.delete(alternate); h.cachedRead.mockClear();
    expect(await readDiagramPreview(h.vault, path, () => true)).toEqual({ status: "missing" });
    expect(h.cachedRead).not.toHaveBeenCalled();
  });
  it.each(["<svg>", "{}", "<html/>", '<svg xmlns="wrong"/>', '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>'])("rejects invalid exported SVG %s", async (source) => {
    const h = vaultFixture(["a.excalidraw", "a.svg"], source);
    expect(await readDiagramPreview(h.vault, "a.excalidraw", () => true)).toEqual({ status: "invalid" });
  });
  it("accepts exactly the UTF-8 byte budget", async () => {
    const source = svg + " ".repeat(DIAGRAM_MAX_BYTES - svg.length);
    const h = vaultFixture(["a.svg"], source);
    expect(await readDiagramPreview(h.vault, "a.excalidraw", () => true)).toMatchObject({ status: "ready" });
  });
  it("checks file stat before reading and UTF-8 byte size afterwards without truncation", async () => {
    const h = vaultFixture(["a.svg"], svg); h.files.get("a.svg")!.stat.size = DIAGRAM_MAX_BYTES + 1;
    expect(await readDiagramPreview(h.vault, "a.excalidraw", () => true)).toEqual({ status: "oversized" });
    expect(h.cachedRead).not.toHaveBeenCalled();
    h.files.get("a.svg")!.stat.size = 1; h.cachedRead.mockResolvedValue("中".repeat(DIAGRAM_MAX_BYTES / 2));
    expect(await readDiagramPreview(h.vault, "a.excalidraw", () => true)).toEqual({ status: "oversized" });
    h.cachedRead.mockResolvedValue(svg);
    expect(await readDiagramPreview(h.vault, "a.excalidraw", () => false)).toBeUndefined();
    h.cachedRead.mockRejectedValue(new Error("unreadable"));
    expect(await readDiagramPreview(h.vault, "a.excalidraw", () => true)).toEqual({ status: "invalid" });
  });
});
