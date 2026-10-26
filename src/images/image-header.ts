import { IMAGE_MAX_BYTES, IMAGE_MAX_PIXELS, THUMBNAIL_MAX_EDGE } from "./types";
export interface ImageHeader { width: number; height: number; orientation: number; mime: string; animated: boolean }
/** Bounds checked container parsing. Never decode an unmeasurable image. Runs in the Worker. */
export function readImageHeader(buffer: ArrayBuffer): ImageHeader | null {
  if (buffer.byteLength > IMAGE_MAX_BYTES || buffer.byteLength < 12) return null;
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
        if (kind === "fcTL") {
          if (n !== 26) return null;
          const w = v.getUint32(p + 12), h = v.getUint32(p + 16);
          if (!w || !h || v.getUint32(p + 20) + w > width || v.getUint32(p + 24) + h > height) return null;
        }
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
        if (kind === "ANMF") {
          if (n < 16 || !width || !height) return null;
          const uint24 = (position: number): number => v.getUint8(position) + (v.getUint8(position + 1) << 8) + (v.getUint8(position + 2) << 16);
          if (2 * uint24(d) + uint24(d + 6) + 1 > width || 2 * uint24(d + 3) + uint24(d + 9) + 1 > height) return null;
        }
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
    } else if (text(0, 6) === "GIF87a" || text(0, 6) === "GIF89a") {
      mime = "image/gif";
      width = v.getUint16(6, true); height = v.getUint16(8, true);
      if (!validateGifFrames(buffer, width, height)) return null;
      animated = true;
    } else if (text(4, 4) === "ftyp") {
      const dimensions = readAvifDimensions(buffer);
      if (!dimensions) return null;
      mime = "image/avif"; width = dimensions.width; height = dimensions.height;
    } else if (text(0, 2) === "BM") {
      mime = "image/bmp";
      const dib = v.getUint32(14, true);
      if (dib === 12) { width = v.getUint16(18, true); height = v.getUint16(20, true); }
      else if (dib >= 40 && 14 + dib <= v.byteLength) {
        width = v.getInt32(18, true); height = Math.abs(v.getInt32(22, true));
      } else return null;
    } else return null;
  } catch { return null; }
  if (width <= 0 || height <= 0 || width * height > IMAGE_MAX_PIXELS) return null;
  return { width, height, orientation, mime, animated };
}
export function thumbnailDimensions(header: ImageHeader): { width: number; height: number } {
  const swapped = header.orientation >= 5;
  const w = swapped ? header.height : header.width, h = swapped ? header.width : header.height;
  const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Bounded ISO-BMFF walk. Never inspect compressed mdat payloads. */
function readAvifDimensions(buffer: ArrayBuffer): { width: number; height: number } | null {
  const view = new DataView(buffer);
  let width = 0, height = 0, boxes = 0, branded = false;
  const text = (offset: number): string => String.fromCharCode(...new Uint8Array(buffer, offset, 4));
  const walk = (start: number, end: number, depth: number): boolean => {
    if (depth > 8) return false;
    for (let offset = start; offset < end;) {
      if (offset + 8 > end || ++boxes > 10000) return false;
      let size = view.getUint32(offset), header = 8;
      const kind = text(offset + 4);
      if (size === 1) {
        if (offset + 16 > end) return false;
        size = view.getUint32(offset + 8) * 4294967296 + view.getUint32(offset + 12); header = 16;
      } else if (size === 0) size = end - offset;
      if (!Number.isSafeInteger(size) || size < header || offset + size > end) return false;
      const data = offset + header, limit = offset + size;
      if (kind === "ftyp") {
        if (limit - data < 8 || (limit - data) % 4 !== 0) return false;
        for (let position = data; position + 4 <= limit; position += 4) {
          if (position === data + 4) continue;
          const brand = text(position); branded ||= brand === "avif" || brand === "avis";
        }
      } else if (kind === "ispe") {
        if (limit - data !== 12) return false;
        const w = view.getUint32(data + 4), h = view.getUint32(data + 8);
        if (!w || !h || w * h > IMAGE_MAX_PIXELS) return false;
        width = Math.max(width, w); height = Math.max(height, h);
      } else if (kind === "meta" || kind === "iprp" || kind === "ipco") {
        const child = data + (kind === "meta" ? 4 : 0);
        if (child > limit || !walk(child, limit, depth + 1)) return false;
      }
      offset = limit;
    }
    return true;
  };
  try {
    return walk(0, buffer.byteLength, 0) && branded && width > 0 && height > 0 && width * height <= IMAGE_MAX_PIXELS
      ? { width, height } : null;
  } catch { return null; }
}

/** Validate frame bounds too: a small GIF logical screen must not hide a giant frame. */
function validateGifFrames(buffer: ArrayBuffer, width: number, height: number): boolean {
  if (!width || !height || width * height > IMAGE_MAX_PIXELS || buffer.byteLength < 14) return false;
  const view = new DataView(buffer);
  let position = 13, frames = 0;
  if (view.getUint8(10) & 0x80) position += 3 * (2 << (view.getUint8(10) & 7));
  const subBlocks = (): boolean => {
    while (position < view.byteLength) {
      const size = view.getUint8(position++);
      if (!size) return true;
      position += size;
    }
    return false;
  };
  while (position < view.byteLength) {
    const kind = view.getUint8(position++);
    if (kind === 0x3b) return frames > 0;
    if (kind === 0x21) { position++; if (!subBlocks()) return false; }
    else if (kind === 0x2c) {
      if (position + 9 > view.byteLength || ++frames > 10000) return false;
      const x = view.getUint16(position, true), y = view.getUint16(position + 2, true);
      const w = view.getUint16(position + 4, true), h = view.getUint16(position + 6, true);
      const packed = view.getUint8(position + 8); position += 9;
      if (!w || !h || x + w > width || y + h > height) return false;
      if (packed & 0x80) position += 3 * (2 << (packed & 7));
      if (position >= view.byteLength) return false;
      const codeSize = view.getUint8(position++);
      if (codeSize < 2 || codeSize > 8 || !subBlocks()) return false;
    } else return false;
  }
  return false;
}
