import { describe, expect, it } from "vitest";
import { readImageHeader, thumbnailDimensions } from "./image-header";
import { resolveRuntimeResourceBudget } from "../runtime/resource-budget";
import { IMAGE_MAX_BYTES, maxImageBytes, SVG_MAX_BYTES } from "./types";
function png(width = 80, height = 40, animated = false): ArrayBuffer {
  const bytes = new Uint8Array(animated ? 65 : 45), v = new DataView(bytes.buffer);
  v.setUint32(0, 0x89504e47); v.setUint32(4, 0x0d0a1a0a); v.setUint32(8, 13);
  bytes.set(new TextEncoder().encode("IHDR"), 12); v.setUint32(16, width); v.setUint32(20, height);
  if (animated) { v.setUint32(33, 8); bytes.set(new TextEncoder().encode("acTL"), 37); }
  bytes.set(new TextEncoder().encode("IEND"), animated ? 57 : 37);
  return bytes.buffer;
}
function jpeg(orientation: number): ArrayBuffer {
  const bytes = new Uint8Array(50), v = new DataView(bytes.buffer);
  v.setUint16(0, 0xffd8); v.setUint16(2, 0xffe1); v.setUint16(4, 34);
  bytes.set(new TextEncoder().encode("Exif\0\0II"), 6);
  v.setUint16(14, 42, true); v.setUint32(16, 8, true); v.setUint16(20, 1, true);
  v.setUint16(22, 0x112, true); v.setUint16(24, 3, true); v.setUint32(26, 1, true); v.setUint16(30, orientation, true);
  v.setUint16(38, 0xffc0); v.setUint16(40, 8); v.setUint16(43, 200); v.setUint16(45, 400);
  v.setUint16(48, 0xffd9);
  return bytes.buffer;
}
function webp(animated = false): ArrayBuffer {
  const bytes = new Uint8Array(30), v = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF")); v.setUint32(4, 22, true);
  bytes.set(new TextEncoder().encode("WEBPVP8X"), 8); v.setUint32(16, 10, true);
  bytes[20] = animated ? 2 : 0; bytes[24] = 99; bytes[27] = 49;
  return bytes.buffer;
}
describe("pre-decode image budgets", () => {
  it("measures PNG/WebP including animations for static first-frame thumbnails", () => {
    expect(readImageHeader(png())).toMatchObject({ width: 80, height: 40, mime: "image/png" });
    expect(readImageHeader(webp())).toMatchObject({ width: 100, height: 50, mime: "image/webp" });
    expect(readImageHeader(png(80, 40, true))).toMatchObject({ width: 80, height: 40, animated: true });
    expect(readImageHeader(webp(true))).toMatchObject({ width: 100, height: 50, animated: true });
  });
  it("enforces exact inclusive pixel and byte budgets before decoding", () => {
    expect(readImageHeader(png(10000, 5000))).not.toBeNull();
    expect(readImageHeader(png(10000, 5001))).toBeNull();
    expect(readImageHeader(new ArrayBuffer(IMAGE_MAX_BYTES + 1))).toBeNull();
  });
  it("handles JPEG orientation without enlarging small images", () => {
    for (let orientation = 1; orientation <= 8; orientation++) {
      const header = readImageHeader(jpeg(orientation))!;
      expect(header.orientation).toBe(orientation);
      expect(thumbnailDimensions(header)).toEqual(orientation >= 5 ? { width: 200, height: 400 } : { width: 400, height: 200 });
    }
    expect(thumbnailDimensions(readImageHeader(png(8000, 4000))!)).toEqual({ width: 1024, height: 512 });
    expect(thumbnailDimensions(readImageHeader(png(1, 10000))!)).toEqual({ width: 1, height: 1024 });
  });
  it("measures top-down BMP and safely rejects damaged or unknown headers", () => {
    const bytes = new Uint8Array(54), v = new DataView(bytes.buffer);
    bytes.set(new TextEncoder().encode("BM")); v.setUint32(14, 40, true); v.setInt32(18, 100, true); v.setInt32(22, -50, true);
    expect(readImageHeader(bytes.buffer)).toMatchObject({ width: 100, height: 50 });
    for (const buffer of [new ArrayBuffer(0), new ArrayBuffer(50), png().slice(0, 30), webp().slice(0, 20), jpeg(9)]) expect(readImageHeader(buffer)).toBeNull();
    const broken = png(); new DataView(broken).setUint32(8, 0xffffffff); expect(readImageHeader(broken)).toBeNull();
  });
});

function avif(width: number, height: number): ArrayBuffer {
  const box = (name: string, data: Uint8Array): Uint8Array => {
    const result = new Uint8Array(data.length + 8);
    new DataView(result.buffer).setUint32(0, result.length);
    result.set(new TextEncoder().encode(name), 4); result.set(data, 8); return result;
  };
  const spatial = new Uint8Array(12), view = new DataView(spatial.buffer);
  view.setUint32(4, width); view.setUint32(8, height);
  const properties = box("iprp", box("ipco", box("ispe", spatial)));
  const meta = new Uint8Array(properties.length + 4); meta.set(properties, 4);
  const brands = new Uint8Array(12); brands.set(new TextEncoder().encode("avif")); brands.set(new TextEncoder().encode("avif"), 8);
  const type = box("ftyp", brands), metadata = box("meta", meta);
  const result = new Uint8Array(type.length + metadata.length); result.set(type); result.set(metadata, type.length);
  return result.buffer;
}
it("bounds GIF canvas and AVIF spatial properties before decode", () => {
  const gif = Uint8Array.from(Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"));
  const view = new DataView(gif.buffer); view.setUint16(6, 100, true); view.setUint16(8, 50, true);
  expect(readImageHeader(gif.buffer)).toMatchObject({ width: 100, height: 50, mime: "image/gif" });
  view.setUint16(6, 65535, true); view.setUint16(8, 65535, true);
  expect(readImageHeader(gif.buffer)).toBeNull();
  expect(readImageHeader(avif(80, 40))).toMatchObject({ width: 80, height: 40, mime: "image/avif" });
  expect(readImageHeader(avif(10000, 5000))).not.toBeNull();
  expect(readImageHeader(avif(10000, 5001))).toBeNull();
  const malformed = avif(80, 40); new DataView(malformed).setUint32(20, 0xffffffff);
  expect(readImageHeader(malformed)).toBeNull();
  const nonAvif = avif(80, 40); new Uint8Array(nonAvif).fill(0, 8, 20);
  expect(readImageHeader(nonAvif)).toBeNull();
});

it("keeps main format support while enforcing the selected mobile image budget", () => {
  const phone = resolveRuntimeResourceBudget("phone").image;
  expect(readImageHeader(avif(4000, 4000), phone)).not.toBeNull();
  expect(readImageHeader(avif(4000, 4001), phone)).toBeNull();
  expect(readImageHeader(png(4000, 4000, true), phone)).toMatchObject({ animated: true });
  expect(readImageHeader(png(4000, 4001, true), phone)).toBeNull();
  expect(readImageHeader(webp(true), phone)).toMatchObject({ animated: true });
  expect(maxImageBytes("photo.avif", phone)).toBe(phone.maxBytes);
  expect(maxImageBytes("diagram.SVG", phone)).toBe(SVG_MAX_BYTES);
  expect(maxImageBytes("diagram.svg", { ...phone, maxBytes: 100 })).toBe(100);
});
