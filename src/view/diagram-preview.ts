import { TFile, type Vault } from "obsidian";

export const DIAGRAM_MAX_BYTES = 512 * 1024;
export const DIAGRAM_MAX_NODES = 200;
export const DIAGRAM_MAX_EDGES = 400;
export type DiagramPreviewResult =
  | { status: "ready"; blob: Blob; truncated: boolean }
  | { status: "empty" | "missing" | "invalid" | "oversized" };

export function isDiagramKind(kind: string): boolean { return kind === "canvas" || kind === "excalidraw"; }

/** Ordered, same-directory exports only. Never inspect an Excalidraw scene. */
export function diagramDependencies(path: string): string[] {
  if (/\.excalidraw\.md$/i.test(path)) return [path, path.replace(/\.md$/i, ".svg"), path.replace(/\.excalidraw\.md$/i, ".svg")];
  if (/\.excalidraw$/i.test(path)) return [path, path.replace(/\.excalidraw$/i, ".svg"), `${path}.svg`];
  return [path];
}

export function diagramSourceFingerprint(vault: Vault, path: string, revision: (file: TFile) => number): string {
  return JSON.stringify(diagramDependencies(path).map((candidate) => {
    const file = vault.getAbstractFileByPath(candidate);
    return file instanceof TFile ? [candidate, file.stat.mtime, file.stat.size, revision(file)] : [candidate, null];
  }));
}

// XML 1.0 labels cannot contain control characters.
// oxlint-disable-next-line no-control-regex
const labelControls = /[\u0000-\u001f\u007f]/g;
const escapeXml = (value: string): string => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
type CanvasNode = { id: string; type: string; x: number; y: number; width: number; height: number; label: string };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const coordinate = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e9;
const yieldTurn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function resolveCanvasEndpoint(node: CanvasNode, side: unknown): [number, number] {
  switch (side) {
    case "left": return [node.x, node.y + node.height / 2];
    case "right": return [node.x + node.width, node.y + node.height / 2];
    case "top": return [node.x + node.width / 2, node.y];
    case "bottom": return [node.x + node.width / 2, node.y + node.height];
    default: return [node.x + node.width / 2, node.y + node.height / 2];
  }
}

export async function buildCanvasPreview(source: string, isCurrent: () => boolean): Promise<DiagramPreviewResult | undefined> {
  if (new Blob([source]).size > DIAGRAM_MAX_BYTES) return { status: "oversized" };
  let root: unknown;
  try { root = JSON.parse(source); } catch { return { status: "invalid" }; }
  if (!object(root) || !Array.isArray(root.nodes) || !Array.isArray(root.edges)) return { status: "invalid" };
  const nodes = new Map<string, CanvasNode>();
  let truncated = false;
  for (let index = 0; index < root.nodes.length; index++) {
    if (index % 50 === 0) { await yieldTurn(); if (!isCurrent()) return undefined; }
    const node: unknown = root.nodes[index];
    if (!object(node) || typeof node.id !== "string" || nodes.has(node.id)
      || !["text", "file", "link", "group"].includes(String(node.type))
      || !coordinate(node.x) || !coordinate(node.y) || !coordinate(node.width) || !coordinate(node.height)
      || node.width <= 0 || node.height <= 0) continue;
    if (nodes.size === DIAGRAM_MAX_NODES) { truncated = true; break; }
    const rawLabel = node.type === "file" ? String(node.file ?? "").split("/").pop()!
      : node.type === "text" ? node.text : node.label ?? node.url;
    const text = typeof rawLabel === "string" ? rawLabel.replace(labelControls, " ").trim() : "";
    if (text.length > 80) truncated = true;
    nodes.set(node.id, { id: node.id, type: String(node.type), x: node.x, y: node.y,
      width: node.width, height: node.height, label: text.slice(0, 80) });
  }
  if (!nodes.size) return { status: "empty" };
  const list = [...nodes.values()];
  const minX = Math.min(...list.map((node) => node.x)), minY = Math.min(...list.map((node) => node.y));
  const width = Math.max(...list.map((node) => node.x + node.width)) - minX;
  const height = Math.max(...list.map((node) => node.y + node.height)) - minY;
  const unit = Math.max(width, height) / 100;
  const stroke = Math.max(unit * 0.2, 0.1), font = Math.max(unit * 2, 1);
  const box = (node: CanvasNode): string => `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${unit}" fill="${node.type === "group" ? "#e2e8f0" : "#f8fafc"}" stroke="#64748b" stroke-width="${stroke}"/>`;
  const label = (node: CanvasNode): string => `<svg x="${node.x}" y="${node.y}" width="${node.width}" height="${Math.min(node.height, font * 2)}"><text x="${unit}" y="${font * 1.2}" font-family="sans-serif" font-size="${font}" fill="#1e293b">${escapeXml(node.label)}</text></svg>`;
  const parts = list.filter((node) => node.type === "group").map(box);
  let edgeCount = 0;
  for (let index = 0; index < root.edges.length; index++) {
    if (index % 50 === 0) { await yieldTurn(); if (!isCurrent()) return undefined; }
    const edge: unknown = root.edges[index];
    if (!object(edge) || typeof edge.fromNode !== "string" || typeof edge.toNode !== "string") continue;
    const from = nodes.get(edge.fromNode), to = nodes.get(edge.toNode);
    if (!from || !to) continue;
    if (edgeCount++ === DIAGRAM_MAX_EDGES) { truncated = true; break; }
    const [x1, y1] = resolveCanvasEndpoint(from, edge.fromSide), [x2, y2] = resolveCanvasEndpoint(to, edge.toSide);
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#475569" stroke-width="${stroke}"${edge.fromEnd === "arrow" ? ' marker-start="url(#arrow)"' : ""}${edge.toEnd !== "none" ? ' marker-end="url(#arrow)"' : ""}/>`);
    if (typeof edge.label === "string") {
      if (edge.label.length > 80) truncated = true;
      parts.push(`<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2}" font-family="sans-serif" font-size="${font}" fill="#1e293b">${escapeXml(edge.label.replace(labelControls, " ").slice(0, 80))}</text>`);
    }
  }
  parts.push(...list.filter((node) => node.type !== "group").map(box), ...list.map(label));
  if (!isCurrent()) return undefined;
  const margin = unit * 4;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - margin} ${minY - margin} ${width + margin * 2} ${height + margin * 2}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#475569"/></marker></defs>${parts.join("")}</svg>`;
  return { status: "ready", blob: new Blob([svg], { type: "image/svg+xml" }), truncated };
}

export async function readDiagramPreview(vault: Vault, path: string, isCurrent: () => boolean,
  Parser?: typeof DOMParser): Promise<DiagramPreviewResult | undefined> {
  const candidates = diagramDependencies(path);
  const canvas = /\.canvas$/i.test(path);
  const file = (canvas ? candidates : candidates.slice(1)).map((candidate) => vault.getAbstractFileByPath(candidate))
    .find((candidate): candidate is TFile => candidate instanceof TFile);
  if (!file) return { status: canvas ? "invalid" : "missing" };
  if (file.stat.size > DIAGRAM_MAX_BYTES) return { status: "oversized" };
  try {
    const source = await vault.cachedRead(file);
    if (!isCurrent()) return undefined;
    if (new Blob([source]).size > DIAGRAM_MAX_BYTES) return { status: "oversized" };
    if (canvas) return await buildCanvasPreview(source, isCurrent);
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) return { status: "invalid" };
    const doc = new (Parser ?? DOMParser)().parseFromString(source, "image/svg+xml");
    if (doc.getElementsByTagName("parsererror").length || doc.documentElement.localName !== "svg"
      || doc.documentElement.namespaceURI !== "http://www.w3.org/2000/svg") return { status: "invalid" };
    return { status: "ready", blob: new Blob([source], { type: "image/svg+xml" }), truncated: false };
  } catch { return isCurrent() ? { status: "invalid" } : undefined; }
}
