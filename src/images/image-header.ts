import { DESKTOP_RESOURCE_BUDGET, type RuntimeResourceBudget } from "../runtime/resource-budget";
export interface ImageHeader { width: number; height: number; orientation: number; mime: string; animated: boolean }
/** Bounds checked container parsing. Never decode an unmeasurable image. Runs in the Worker. */
export function readImageHeader(buffer: ArrayBuffer, budget: RuntimeResourceBudget["image"] = DESKTOP_RESOURCE_BUDGET.image): ImageHeader | null {
  if (buffer.byteLength > budget.maxBytes || buffer.byteLength < 12) return null;
  const v = new DataView(buffer);
  const text = (p: number, n: number): string => {
    if (p + n > v.byteLength) return "";
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(v.getUint8(p + i));
    return s;
  };
  let width = 0, height = 0, orientation = 1, mime = "", animated = false;
  try {
    if (v.getUint32(0) === 0x89504e47 && v.getUint32(4) === 0x0d0a1a0a) {
      mime = "image/png";
      if (text(12, 4) !== "IHDR" || v.getUint32(8) !== 13) return null;
      width = v.getUint32(16); height = v.getUint32(20);
      let ended = false;
      for (let p = 8; p + 12 <= v.byteLength;) {
        const n = v.getUint32(p), kind = text(p + 4, 4);
        if (p + n + 12 > v.byteLength) return null;
        if (kind === "acTL" || kind === "fcTL" || kind === "fdAT") animated = true;
        p += n + 12;
        if (kind === "IEND") { ended = true; break; }
      }
      if (!ended) return null;
    } else if (text(0, 4) === "RIFF" && text(8, 4) === "WEBP") {
      mime = "image/webp";
      const end = v.getUint32(4, true) + 8;
      if (end > v.byteLength || end < 20) return null;
      for (let p = 12; p + 8 <= end;) {
        const kind = text(p, 4), n = v.getUint32(p + 4, true), d = p + 8;
        if (d + n > end) return null;
        if (kind === "ANIM" || kind === "ANMF") animated = true;
        if (kind === "VP8X" && n >= 10) {
          if (p !== 12) return null;
          animated ||= (v.getUint8(d) & 2) !== 0;
          width = 1 + v.getUint8(d + 4) + (v.getUint8(d + 5) << 8) + (v.getUint8(d + 6) << 16);
          height = 1 + v.getUint8(d + 7) + (v.getUint8(d + 8) << 8) + (v.getUint8(d + 9) << 16);
        } else if (kind === "VP8 " && n >= 10) {
          if (text(d + 3, 3) !== "\x9d\x01\x2a") return null;
          const codedWidth = v.getUint16(d + 6, true) & 0x3fff, codedHeight = v.getUint16(d + 8, true) & 0x3fff;
          if (width && (width !== codedWidth || height !== codedHeight)) return null;
          width = codedWidth; height = codedHeight;
        } else if (kind === "VP8L" && n >= 5) {
          if (v.getUint8(d) !== 0x2f) return null;
          const bits = v.getUint32(d + 1, true);
          const codedWidth = (bits & 0x3fff) + 1, codedHeight = ((bits >>> 14) & 0x3fff) + 1;
          if (width && (width !== codedWidth || height !== codedHeight)) return null;
          width = codedWidth; height = codedHeight;
        }
        p = d + n + (n & 1);
      }
    } else if (v.getUint16(0) === 0xffd8) {
      mime = "image/jpeg";
      for (let p = 2; p + 4 <= v.byteLength;) {
        if (v.getUint8(p++) !== 0xff) return null;
        while (p < v.byteLength && v.getUint8(p) === 0xff) p++;
        const marker = v.getUint8(p++);
        if (marker === 0xda || marker === 0xd9) break;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        const n = v.getUint16(p);
        if (n < 2 || p + n > v.byteLength) return null;
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
          if (n < 8) return null;
          const codedHeight = v.getUint16(p + 3), codedWidth = v.getUint16(p + 5);
          if (width && (width !== codedWidth || height !== codedHeight)) return null;
          height = codedHeight; width = codedWidth;
        }
        if (marker === 0xe1 && text(p + 2, 6) === "Exif\0\0" && n >= 16) {
          const t = p + 8, little = text(t, 2) === "II";
          if ((!little && text(t, 2) !== "MM") || v.getUint16(t + 2, little) !== 42) return null;
          const ifd = t + v.getUint32(t + 4, little);
          if (ifd < t || ifd + 2 > p + n) return null;
          const count = v.getUint16(ifd, little);
          if (ifd + 2 + count * 12 > p + n) return null;
          for (let i = 0; i < count; i++) {
            const entry = ifd + 2 + i * 12;
            if (v.getUint16(entry, little) === 0x112 && v.getUint16(entry + 2, little) === 3 && v.getUint32(entry + 4, little) === 1) {
              orientation = v.getUint16(entry + 8, little);
              if (orientation < 1 || orientation > 8) return null;
            }
          }
        }
        p += n;
      }
    } else if (text(0, 2) === "BM") {
      mime = "image/bmp";
      const dib = v.getUint32(14, true);
      if (dib === 12) { width = v.getUint16(18, true); height = v.getUint16(20, true); }
      else if (dib >= 40 && 14 + dib <= v.byteLength) {
        width = v.getInt32(18, true); height = Math.abs(v.getInt32(22, true));
      } else return null;
    } else return null;
  } catch { return null; }
  if (width <= 0 || height <= 0 || width * height > budget.maxPixels || animated) return null;
  return { width, height, orientation, mime, animated };
}
export function thumbnailDimensions(header: ImageHeader, budget: RuntimeResourceBudget["image"] = DESKTOP_RESOURCE_BUDGET.image): { width: number; height: number } {
  const swapped = header.orientation >= 5;
  const w = swapped ? header.height : header.width, h = swapped ? header.width : header.height;
  const scale = Math.min(1, budget.maxEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}
