import { sanitizeSvg } from "../view/svg-sanitize";
import { IMAGE_MAX_PIXELS, SVG_MAX_BYTES, THUMBNAIL_MAX_EDGE, type ThumbnailResult } from "./types";

export function isSvgBuffer(buffer: ArrayBuffer): boolean {
  return /^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(
    new TextDecoder().decode(buffer.slice(0, 4096)));
}
/** DOM parsing stays on the host; only a detached, sanitized, bounded image is decoded. */
export async function generateSvgThumbnail(buffer: ArrayBuffer, onEligible: () => void, signal: AbortSignal): Promise<ThumbnailResult> {
  if (buffer.byteLength > SVG_MAX_BYTES || signal.aborted) return { status: "skipped" };
  const source = new TextDecoder().decode(buffer);
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) return { status: "skipped" };
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = doc.documentElement;
  if (doc.querySelector("parsererror") || root.localName !== "svg" || root.namespaceURI !== "http://www.w3.org/2000/svg") return { status: "skipped" };
  const viewBox = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  const validBox = viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0;
  const length = (value: string | null, fallback: number): number => {
    if (!value || /%$/.test(value)) return fallback;
    return /^(?:\d+(?:\.\d*)?|\.\d+)(?:px)?$/.test(value.trim()) ? parseFloat(value) : NaN;
  };
  const width = length(root.getAttribute("width"), validBox ? viewBox[2] : 300);
  const height = length(root.getAttribute("height"), validBox ? viewBox[3] : 150);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width * height > IMAGE_MAX_PIXELS) return { status: "skipped" };
  if (!validBox) root.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(width, height));
  const outputWidth = Math.max(1, Math.round(width * scale)), outputHeight = Math.max(1, Math.round(height * scale));
  root.setAttribute("width", String(outputWidth)); root.setAttribute("height", String(outputHeight));
  const sanitized = sanitizeSvg(doc);
  if (!sanitized) return { status: "skipped" };
  onEligible();
  const url = URL.createObjectURL(new Blob([sanitized], { type: "image/svg+xml" }));
  const image = new Image();
  const canvas = new OffscreenCanvas(outputWidth, outputHeight);
  let timer: number | undefined;
  let abort: () => void = () => {};
  try {
    await new Promise<void>((resolve, reject) => {
      abort = () => { image.src = ""; reject(new Error("SVG decode cancelled")); };
      signal.addEventListener("abort", abort, { once: true });
      timer = window.setTimeout(abort, 10000);
      image.onload = () => resolve(); image.onerror = () => reject(new Error("SVG decode failed"));
      image.src = url;
    });
    if (signal.aborted) return { status: "skipped" };
    canvas.width = outputWidth; canvas.height = outputHeight;
    const context = canvas.getContext("2d");
    if (!context) return { status: "failed" };
    context.drawImage(image, 0, 0, outputWidth, outputHeight);
    let blob: Blob;
    try { blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.85 }); }
    catch { blob = await canvas.convertToBlob({ type: "image/png" }); }
    return blob && !signal.aborted ? { status: "ready", blob } : { status: "failed" };
  } catch { return { status: signal.aborted ? "skipped" : "failed" }; }
  finally {
    window.clearTimeout(timer); signal.removeEventListener("abort", abort);
    image.onload = null; image.onerror = null; image.src = "";
    URL.revokeObjectURL(url); canvas.width = 0; canvas.height = 0;
  }
}
