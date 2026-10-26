import { writeFile, mkdir, readFile } from "node:fs/promises";
import { createDeflate } from "node:zlib";
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc(data) { let c = 0xffffffff; for (const byte of data) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(kind, data) { const type = Buffer.from(kind), size = Buffer.alloc(4), checksum = Buffer.alloc(4); size.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([type, data]))); return Buffer.concat([size, type, data, checksum]); }
async function png(width, height) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.alloc(1 + width * 3); for (let x = 0; x < width; x++) { row[1 + x * 3] = x % 255; row[2 + x * 3] = 140; row[3 + x * 3] = 200; }
  const deflater = createDeflate(); const parts = []; deflater.on("data", (part) => parts.push(part));
  const completion = new Promise((resolve, reject) => { deflater.on("end", resolve); deflater.on("error", reject); });
  for (let y = 0; y < height; y++) if (!deflater.write(row)) await new Promise((resolve) => deflater.once("drain", resolve));
  deflater.end(); await completion;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", Buffer.concat(parts)), chunk("IEND", Buffer.alloc(0))]);
}
export async function createFixtures(directory) {
  await mkdir(directory, { recursive: true }); const stats = {};
  const markdown = "# A note\n\nA useful note with searchable needle and regular body content.\nSecond line of text.\nThird line of text.\nFourth line of text.\nFifth line of text.\n\n![[regular.png]]";
  await writeFile(`${directory}/note.md`, markdown); stats["note.md"] = Buffer.byteLength(markdown);
  for (const [name, width, height] of [["regular", 1600, 900], ["8k", 7680, 4320], ["long", 1000, 30000], ["pixel-boundary", 10000, 5000], ["pixel-over", 10000, 5001]]) {
    const data = await png(width, height); await writeFile(`${directory}/${name}.png`, data); stats[`${name}.png`] = data.length;
  }
  const small = await png(32, 32);
  for (const [name, bytes] of [["byte-boundary", 50_000_000], ["byte-over", 50_000_001]]) {
    const data = Buffer.alloc(bytes); small.copy(data); await writeFile(`${directory}/${name}.png`, data); stats[`${name}.png`] = bytes;
  }
  const vector = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40"><rect width="80" height="40" fill="red"/></svg>';
  await writeFile(`${directory}/vector.svg`, vector); stats["vector.svg"] = Buffer.byteLength(vector);
  for (const name of ["red.avif", "animated.gif"]) {
    const data = await readFile(new URL(`./fixtures/${name}`, import.meta.url));
    await writeFile(`${directory}/${name}`, data); stats[name] = data.length;
  }
  return stats;
}
