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
const wrap = (content: string, attributes = "") => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attributes}>${content}</svg>`;
class InvalidSecondParse extends DOMParser {
  private calls = 0;
  override parseFromString(source: string, type: DOMParserSupportedType): Document {
    return super.parseFromString(++this.calls === 1 ? source : "<broken>", type);
  }
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
    const shapes = Array.from(doc.querySelectorAll("rect, line"));
    expect(shapes.map((shape) => shape.localName)).toEqual(["rect", "line", "rect"]);
    expect(shapes.map((shape) => shape.getAttribute("fill"))).toEqual(["#d4cff4", null, "#f9cdd0"]);
    expect(shapes.map((shape) => shape.getAttribute("stroke"))).toEqual(["#64748b", "#475569", "#64748b"]);
    expect(Array.from(doc.querySelectorAll("text"), (label) => label.getAttribute("fill"))).toEqual(["#1e293b", "#1e293b", "#1e293b"]);
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
  it("replaces ASCII controls in node and edge labels while preserving Unicode and printable boundaries", async () => {
    const controls = String.fromCharCode(...Array.from({ length: 32 }, (_, code) => code), 127);
    const label = `中😀 ~${controls}\u0085完`;
    const expected = `中😀 ~${" ".repeat(33)}\u0085完`;
    const result = await buildCanvasPreview(JSON.stringify({
      nodes: [node("a", "text", { text: label }), node("b")],
      edges: [{ fromNode: "a", toNode: "b", label }],
    }), () => true);
    if (result?.status !== "ready") throw new Error("expected SVG");
    const doc = new DOMParser().parseFromString(await text(result.blob), "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(Array.from(doc.querySelectorAll("text"), (element) => element.textContent)).toEqual([expected, expected, "hello"]);
  });
  it("escapes injection attempts in every Canvas label source and ignores arbitrary colors and edge attributes", async () => {
    const injection = '</text><script onload="alert(1)">x</script>';
    const nodes = [node("text", "text", { text: injection }), node("file", "file", { file: injection }),
      node("link", "link", { url: injection }), node("group", "group", { label: injection, color: injection })];
    const edges = [{ fromNode: "text", toNode: "file", label: injection, fromSide: injection, toEnd: injection }];
    const result = await buildCanvasPreview(JSON.stringify({ nodes, edges }), () => true);
    if (result?.status !== "ready") throw new Error("expected SVG");
    const doc = new DOMParser().parseFromString(await text(result.blob), "image/svg+xml");
    expect(doc.querySelector("parsererror, script, [onload], foreignObject, a, image")).toBeNull();
    expect(Array.from(doc.querySelectorAll("text"), (label) => label.textContent)).toEqual([
      injection, injection, injection.split("/").pop(), injection, injection,
    ]);
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
  async function exportedSvg(source: string): Promise<Document> {
    const h = vaultFixture(["a.svg"], source);
    const result = await readDiagramPreview(h.vault, "a.excalidraw", () => true);
    expect(result).toMatchObject({ status: "ready", truncated: false });
    if (result?.status !== "ready") throw new Error("expected sanitized SVG");
    expect(result.blob.type).toBe("image/svg+xml");
    const doc = new DOMParser().parseFromString(await text(result.blob), "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    return doc;
  }

  it.each(["script", "foreignObject", "animate", "animateTransform", "animateMotion", "set", "handler", "discard"])(
    "removes %s and its whole subtree from the Blob", async (tag) => {
      const doc = await exportedSvg(wrap(`<${tag}><g id="unsafe"/></${tag}><rect width="10" height="10"/>`));
      expect(doc.getElementsByTagName(tag)).toHaveLength(0);
      expect(doc.getElementById("unsafe")).toBeNull();
      expect(doc.querySelectorAll("rect")).toHaveLength(1);
    });

  it("removes event attributes on the root and descendants, including namespaced and mixed-case handlers", async () => {
    const doc = await exportedSvg(wrap('<rect width="10" onload="alert(1)" OnClick="alert(2)" xlink:onerror="alert(3)"/>',
      'onload="alert(4)"'));
    for (const element of [doc.documentElement, doc.querySelector("rect")!]) {
      expect(Array.from(element.attributes).some((attribute) => /^on/i.test(attribute.localName))).toBe(false);
    }
    expect(doc.querySelector("rect")?.getAttribute("width")).toBe("10");
  });

  describe.each(["href", "xlink:href", "src"])("%s URL attributes", (attribute) => {
    it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java&#x9;script:alert(1)", "vbscript:msgbox(1)",
      "data:text/html;base64,PHNjcmlwdC8+", "http://example.invalid/image.svg", "https://example.invalid/font.woff2",
      "//example.invalid/image.svg", "../image.svg", "file:///tmp/image.svg", "blob:untrusted"])(
      "removes unsafe URL %s", async (url) => {
        const doc = await exportedSvg(wrap(`<image ${attribute}="${url}" width="10" height="10"/>`));
        expect(doc.querySelector("image")?.hasAttribute(attribute)).toBe(false);
      });

    it.each(["data:image/png;base64,aGVsbG8=", "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'/%3E"])(
      "preserves embedded image %s verbatim", async (url) => {
        const doc = await exportedSvg(wrap(`<image ${attribute}="${url}" width="10" height="10"/>`));
        expect(doc.querySelector("image")?.getAttribute(attribute)).toBe(url);
      });
  });

  it.each([
    'fill="url(https://example.invalid/paint.svg#paint)"',
    'filter="url(//example.invalid/filter.svg#filter)"',
    'clip-path="url(../clip.svg#clip)"',
    'style="fill: url(&quot;https://example.invalid/paint.svg&quot;); stroke: red"',
    'style="fill: u\\72l(https://example.invalid/paint.svg)"',
    'style="fill: u/**/rl(https://example.invalid/paint.svg)"',
    'style="background: image-set(&quot;https://example.invalid/image.png&quot; 1x)"',
    'style="width: expression(alert(1))"',
  ])("removes an unsafe presentation attribute without changing sibling attributes: %s", async (attribute) => {
    const doc = await exportedSvg(wrap(`<rect ${attribute} width="10" height="10" opacity="0.5"/>`));
    const rect = doc.querySelector("rect")!;
    expect(new Set(rect.getAttributeNames())).toEqual(new Set(["height", "opacity", "width"]));
    expect(rect.getAttribute("opacity")).toBe("0.5");
  });

  it.each([
    '@import "https://example.invalid/style.css";',
    '@\\69mport "https://example.invalid/style.css";',
    '@font-face { font-family: Test; src: url(https://example.invalid/font.woff2) }',
    'rect { fill: url("http://example.invalid/paint.svg#paint") }',
    'rect { fill: url("javascript:alert(1)") }',
    'rect { fill: url("data:text/html,unsafe") }',
    'rect { fill: url("unterminated) }',
  ])("removes unsafe style blocks: %s", async (css) => {
    const doc = await exportedSvg(wrap(`<style><![CDATA[${css}]]></style><rect width="10" height="10"/>`));
    expect(doc.querySelector("style")).toBeNull();
    expect(doc.querySelector("rect")?.getAttribute("width")).toBe("10");
  });

  it("removes foreign namespaces, unknown attributes, XML base URLs and stylesheet processing instructions", async () => {
    const doc = await exportedSvg('<?xml-stylesheet href="https://example.invalid/style.css"?>' + wrap(
      '<?xml-stylesheet href="https://example.invalid/nested.css"?><html:script xmlns:html="http://www.w3.org/1999/xhtml">alert(1)</html:script>'
      + '<rect xml:base="https://example.invalid/" unknown="unsafe" width="10"/><use href="#shape"/>',
      'xml:base="https://example.invalid/"'));
    expect(doc.getElementsByTagNameNS("http://www.w3.org/1999/xhtml", "*")).toHaveLength(0);
    expect(doc.documentElement.hasAttribute("xml:base")).toBe(false);
    expect(doc.querySelector("rect")?.getAttributeNames()).toEqual(["width"]);
    expect(new XMLSerializer().serializeToString(doc)).not.toContain("xml-stylesheet");
    expect(doc.querySelector("use")?.getAttribute("href")).toBe("#shape");
  });

  it("preserves ordinary Excalidraw geometry, text, embedded fonts/images and local references", async () => {
    const source = wrap(`<defs><style><![CDATA[@font-face {font-family: Virgil; src: url(data:font/woff2;base64,d09GMg==)}
      .label {font-family: Virgil; fill: #123456}]]></style>
      <linearGradient id="paint"><stop offset="0" stop-color="#fff"/></linearGradient>
      <clipPath id="clip"><rect width="100" height="100"/></clipPath></defs>
      <g transform="translate(10 20)" stroke-linecap="round" clip-path="url(#clip)">
        <path id="shape" d="M0 0L10 10" stroke="#000" fill="url(#paint)"/>
        <text class="label" x="1" y="2" style="font-size: 20px; white-space: pre" xml:space="preserve">你好 &amp; &lt;world&gt;</text>
        <use xlink:href="#shape"/><image href="data:image/png;base64,aGVsbG8=" width="10" height="10"/>
      </g>`, 'viewBox="0 0 100 100" width="100" height="100"');
    const doc = await exportedSvg(source);
    const original = new DOMParser().parseFromString(source, "image/svg+xml");
    const serializer = new XMLSerializer();
    expect(serializer.serializeToString(doc)).toBe(serializer.serializeToString(original));
    expect(serializer.serializeToString(await exportedSvg(svg))).toBe(svg);
  });

  it.each(["", "<script>alert(1)</script>", "<g><script>alert(1)</script></g>", "<defs><style>rect {fill: red}</style></defs>",
    '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">unsafe</div></foreignObject>'])(
    "returns invalid when sanitization leaves no graphic elements: %s", async (content) => {
      const h = vaultFixture(["a.svg"], wrap(content));
      expect(await readDiagramPreview(h.vault, "a.excalidraw", () => true)).toEqual({ status: "invalid" });
    });

  it("rejects an oversized serialized SVG even when its source fits the byte budget", async () => {
    // XMLSerializer escapes each literal '>' to '&gt;', expanding otherwise valid input.
    const source = wrap(`<text>${">".repeat(DIAGRAM_MAX_BYTES / 3)}</text>`);
    expect(new Blob([source]).size).toBeLessThan(DIAGRAM_MAX_BYTES);
    const h = vaultFixture(["a.svg"], source);
    expect(await readDiagramPreview(h.vault, "a.excalidraw", () => true)).toEqual({ status: "oversized" });
  });

  it("revalidates the serialized SVG and returns invalid if serialization fails validation", async () => {
    const h = vaultFixture(["a.svg"], svg);
    expect(await readDiagramPreview(h.vault, "a.excalidraw", () => true, InvalidSecondParse)).toEqual({ status: "invalid" });
  });
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
  it.each(["<svg>", "{}", "<html/>", '<svg xmlns="wrong"/>', '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>',
    '<!DOCTYPE svg [<!ENTITY x "unsafe">]><svg xmlns="http://www.w3.org/2000/svg"><text>&x;</text></svg>',
    '<!ENTITY x "unsafe"><svg xmlns="http://www.w3.org/2000/svg"/>'])("rejects invalid exported SVG %s", async (source) => {
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
