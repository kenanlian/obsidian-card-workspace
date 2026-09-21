/**
 * Deterministic synthetic vault fixtures for the search benchmark harness.
 *
 * Every fixture is generated from a fixed seed with integer-only PRNG
 * arithmetic, so a given (profile, seed) pair always produces byte-identical
 * content. The generator covers the composition the benchmark must exercise:
 * many small English notes, Han (Chinese) content, mixed Chinese/English,
 * Markdown near and over the 512KB single-note cap, many tiny files, the
 * non-Markdown card kinds (canvas / base / excalidraw), and attachment types
 * that must never reach the index document source.
 *
 * Supported-kind classification reuses the production path-based resolver
 * (`resolveCardFileKindFromPath`) — the same logic `SearchDocumentSource`
 * applies when filtering vault files. Markdown bodies come from
 * `./fixture-content`.
 */

import { resolveCardFileKindFromPath } from "../view/file-kind";
import {
  buildEnglishMarkdown,
  buildEnglishNeedleMarkdown,
  buildHanMarkdown,
  buildHanNeedleMarkdown,
  buildMixedMarkdown,
  buildOversizedMarkdown,
  buildTinyMarkdown,
  englishTitle,
  hanTitle,
  mixedTitle,
} from "./fixture-content";
import { createFnv1a32Hash, createDeterministicRandom } from "./prng";

/** Single-note Markdown cap in UTF-16 code units, mirroring the production limit. */
export const SEARCH_MARKDOWN_CAP_CHARS = 512 * 1024;

export type BenchmarkProfileId = "micro" | "smoke" | "full";

/** Profiles accepted by the CLI. `micro` exists for in-process tests only. */
export type CliBenchmarkProfile = Extract<BenchmarkProfileId, "smoke" | "full">;

export type FixtureBucket =
  | "english-small"
  | "han"
  | "mixed"
  | "tiny"
  | "near-cap"
  | "over-cap"
  | "markers"
  | "canvas"
  | "base"
  | "excalidraw"
  | "attachment";

export type SyntheticFixtureKind =
  | "markdown"
  | "canvas"
  | "base"
  | "excalidraw"
  | "attachment";

export interface SyntheticFixtureFile {
  path: string;
  title: string;
  bucket: FixtureBucket;
  kind: SyntheticFixtureKind;
  markdown: string | null;
  mtime: number;
  ctime: number;
}

export interface FixtureProfileSpec {
  id: BenchmarkProfileId;
  defaultSeed: number;
  buckets: Readonly<Record<FixtureBucket, number>>;
}

export const BENCHMARK_PROFILE_SPECS: Readonly<Record<BenchmarkProfileId, FixtureProfileSpec>> = {
  micro: {
    id: "micro",
    defaultSeed: 0x5eed01,
    buckets: {
      "english-small": 24,
      han: 14,
      mixed: 10,
      tiny: 16,
      "near-cap": 1,
      "over-cap": 1,
      markers: 2,
      canvas: 2,
      base: 2,
      excalidraw: 2,
      attachment: 8,
    },
  },
  smoke: {
    id: "smoke",
    defaultSeed: 0x5eedc0de,
    buckets: {
      "english-small": 220,
      han: 110,
      mixed: 70,
      tiny: 180,
      "near-cap": 1,
      "over-cap": 1,
      markers: 2,
      canvas: 6,
      base: 6,
      excalidraw: 6,
      attachment: 24,
    },
  },
  full: {
    id: "full",
    defaultSeed: 0x5eedc0de,
    buckets: {
      "english-small": 2000,
      han: 800,
      mixed: 600,
      tiny: 1200,
      "near-cap": 1,
      "over-cap": 2,
      markers: 2,
      canvas: 20,
      base: 20,
      excalidraw: 20,
      attachment: 120,
    },
  },
};

// --- Query needles: unique tokens guaranteed to appear in exactly one fixture. ---

export const ENGLISH_NEEDLE_PATH = "bench/markers/english-needle.md";
export const ENGLISH_NEEDLE_QUERY = "zymogeneous-quokka-flagword";
export const HAN_NEEDLE_PATH = "bench/markers/han-needle.md";
export const HAN_NEEDLE_QUERY = "沧溟";
export const OVER_CAP_PATH = "bench/oversize/over-cap-note.md";
export const NEAR_CAP_PATH = "bench/oversize/near-cap-note.md";
export const OVER_CAP_HEAD_MARKER = "capmarker-head-4b19";
export const OVER_CAP_TAIL_MARKER = "capmarker-tail-8e07";
export const NEAR_CAP_TAIL_MARKER = "capmarker-near-tail-2c4f";

const NEAR_CAP_TARGET_CHARS = 500_000;
const OVER_CAP_TARGET_CHARS = 620_000;

const ATTACHMENT_EXTENSIONS = [".png", ".pdf", ".webp", ".zip", ".txt", ".csv", ".docx", ".mp4"] as const;

const BASE_MTIME = 1_700_000_000_000;

function classifyFixtureKind(path: string): SyntheticFixtureKind {
  const kind = resolveCardFileKindFromPath(path);
  return kind ?? "attachment";
}

/**
 * Generates the deterministic synthetic vault file list for a profile.
 * Bucket order is fixed so document enumeration order is stable, matching the
 * stable `getFiles()` enumeration the production document source relies on.
 */
export function generateSyntheticVault(
  profile: BenchmarkProfileId,
  seed?: number,
): SyntheticFixtureFile[] {
  const spec = BENCHMARK_PROFILE_SPECS[profile];
  const random = createDeterministicRandom(seed ?? spec.defaultSeed);
  const files: SyntheticFixtureFile[] = [];
  let clock = BASE_MTIME;

  const push = (
    path: string,
    title: string,
    bucket: FixtureBucket,
    markdown: string | null,
  ): void => {
    const ctime = clock;
    clock += 60_000;
    files.push({
      path,
      title,
      bucket,
      kind: classifyFixtureKind(path),
      markdown,
      mtime: ctime + 30_000,
      ctime,
    });
  };

  for (let index = 0; index < spec.buckets["english-small"]; index += 1) {
    const path = `bench/english/note-${String(index + 1).padStart(4, "0")}.md`;
    push(path, englishTitle(random), "english-small", buildEnglishMarkdown(random));
  }

  for (let index = 0; index < spec.buckets.han; index += 1) {
    const path = `bench/han/han-note-${String(index + 1).padStart(4, "0")}.md`;
    push(path, hanTitle(random), "han", buildHanMarkdown(random));
  }

  for (let index = 0; index < spec.buckets.mixed; index += 1) {
    const path = `bench/mixed/mixed-note-${String(index + 1).padStart(4, "0")}.md`;
    push(path, mixedTitle(random), "mixed", buildMixedMarkdown(random));
  }

  for (let index = 0; index < spec.buckets.tiny; index += 1) {
    const path = `bench/tiny/tip-${String(index + 1).padStart(4, "0")}.md`;
    push(path, `Tip ${index + 1}`, "tiny", buildTinyMarkdown(random));
  }

  if (spec.buckets["near-cap"] > 0) {
    push(
      NEAR_CAP_PATH,
      "Oversized Near Cap Fixture",
      "near-cap",
      buildOversizedMarkdown(random, NEAR_CAP_TARGET_CHARS, "near cap fixture head", NEAR_CAP_TAIL_MARKER),
    );
  }

  for (let index = 0; index < spec.buckets["over-cap"]; index += 1) {
    // The first over-cap document always uses the canonical path so cap
    // correctness checks have a stable anchor in every profile.
    const path = index === 0
      ? OVER_CAP_PATH
      : `bench/oversize/over-cap-note-${index + 1}.md`;
    push(
      path,
      `Oversized Over Cap Fixture ${index + 1}`,
      "over-cap",
      buildOversizedMarkdown(random, OVER_CAP_TARGET_CHARS, OVER_CAP_HEAD_MARKER, OVER_CAP_TAIL_MARKER),
    );
  }

  if (spec.buckets.markers > 0) {
    push(ENGLISH_NEEDLE_PATH, "Marker Note For Query Regression", "markers", buildEnglishNeedleMarkdown(random, ENGLISH_NEEDLE_QUERY));
    push(HAN_NEEDLE_PATH, "针标记笔记", "markers", buildHanNeedleMarkdown(random, HAN_NEEDLE_QUERY));
  }

  for (let index = 0; index < spec.buckets.canvas; index += 1) {
    push(`bench/canvas/board-${String(index + 1).padStart(4, "0")}.canvas`, `Board ${index + 1}`, "canvas", null);
  }

  for (let index = 0; index < spec.buckets.base; index += 1) {
    push(`bench/base/table-${String(index + 1).padStart(4, "0")}.base`, `Table ${index + 1}`, "base", null);
  }

  for (let index = 0; index < spec.buckets.excalidraw; index += 1) {
    const suffix = index % 2 === 0 ? ".excalidraw.md" : ".excalidraw";
    push(`bench/excalidraw/sketch-${String(index + 1).padStart(4, "0")}${suffix}`, `Sketch ${index + 1}`, "excalidraw", null);
  }

  for (let index = 0; index < spec.buckets.attachment; index += 1) {
    const extension = ATTACHMENT_EXTENSIONS[index % ATTACHMENT_EXTENSIONS.length] ?? ".png";
    push(`bench/attachments/asset-${String(index + 1).padStart(4, "0")}${extension}`, `Asset ${index + 1}`, "attachment", null);
  }

  return files;
}

/** Stable content digest so determinism can be asserted cheaply. */
export function computeFixtureDigest(files: readonly SyntheticFixtureFile[]): string {
  const hash = createFnv1a32Hash();
  for (const file of files) {
    hash.update(file.path);
    hash.update("\u0000");
    hash.update(file.title);
    hash.update("\u0000");
    hash.update(file.bucket);
    hash.update("\u0000");
    hash.update(file.kind);
    hash.update("\u0000");
    hash.update(`${file.mtime}:${file.ctime}`);
    hash.update("\u0000");
    if (file.markdown !== null) {
      const contentHash = createFnv1a32Hash();
      contentHash.update(file.markdown);
      hash.update(contentHash.digest());
    } else {
      hash.update("-");
    }
    hash.update("\u0001");
  }
  return `fnv1a32-${hash.digest()}`;
}
