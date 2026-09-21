import { describe, expect, it } from "vitest";

import { resolveCardFileKindFromPath } from "../view/file-kind";
import {
  BENCHMARK_PROFILE_SPECS,
  ENGLISH_NEEDLE_PATH,
  ENGLISH_NEEDLE_QUERY,
  HAN_NEEDLE_PATH,
  HAN_NEEDLE_QUERY,
  NEAR_CAP_PATH,
  NEAR_CAP_TAIL_MARKER,
  OVER_CAP_HEAD_MARKER,
  OVER_CAP_PATH,
  OVER_CAP_TAIL_MARKER,
  SEARCH_MARKDOWN_CAP_CHARS,
  computeFixtureDigest,
  generateSyntheticVault,
  type SyntheticFixtureFile,
} from "./fixtures";

const NEAR_CAP_MIN_CHARS = 450_000;

function findFile(files: readonly SyntheticFixtureFile[], path: string): SyntheticFixtureFile {
  const file = files.find((candidate) => candidate.path === path);
  if (file === undefined) {
    throw new Error(`fixture file not found: ${path}`);
  }
  return file;
}

describe("synthetic benchmark fixtures", () => {
  it("are deterministic for a fixed profile and seed", () => {
    expect(generateSyntheticVault("smoke")).toEqual(generateSyntheticVault("smoke"));
    expect(computeFixtureDigest(generateSyntheticVault("smoke", 1234))).toBe(
      computeFixtureDigest(generateSyntheticVault("smoke", 1234)),
    );
    expect(computeFixtureDigest(generateSyntheticVault("micro"))).toBe(
      computeFixtureDigest(generateSyntheticVault("micro")),
    );
  });

  it("change when the seed changes", () => {
    expect(computeFixtureDigest(generateSyntheticVault("smoke", 1))).not.toBe(
      computeFixtureDigest(generateSyntheticVault("smoke", 2)),
    );
  });

  it("cover every required composition bucket for the smoke profile", () => {
    const files = generateSyntheticVault("smoke");
    const spec = BENCHMARK_PROFILE_SPECS.smoke;
    const countBucket = (bucket: keyof typeof spec.buckets): number =>
      files.filter((file) => file.bucket === bucket).length;

    for (const [bucket, expected] of Object.entries(spec.buckets)) {
      expect(countBucket(bucket as keyof typeof spec.buckets), bucket).toBe(expected);
    }

    const kinds = new Set(files.map((file) => file.kind));
    expect([...kinds].sort()).toEqual(["attachment", "base", "canvas", "excalidraw", "markdown"]);

    const paths = new Set(files.map((file) => file.path));
    expect(paths.size).toBe(files.length);
  });

  it("classifies kinds through the production path resolver", () => {
    const files = generateSyntheticVault("smoke");
    for (const file of files) {
      expect(file.kind).toBe(resolveCardFileKindFromPath(file.path) ?? "attachment");
    }
  });

  it("produces attachment fixtures that the production resolver excludes", () => {
    const attachments = generateSyntheticVault("smoke").filter((file) => file.bucket === "attachment");
    expect(attachments.length).toBeGreaterThan(0);
    const extensions = new Set(attachments.map((file) => file.path.slice(file.path.lastIndexOf("."))));
    expect([...extensions].sort()).toEqual([".csv", ".docx", ".mp4", ".pdf", ".png", ".txt", ".webp", ".zip"]);
    for (const attachment of attachments) {
      expect(resolveCardFileKindFromPath(attachment.path)).toBeNull();
    }
  });

  it("brackets the 512KB cap with near-cap and over-cap Markdown", () => {
    const files = generateSyntheticVault("smoke");
    const nearCap = findFile(files, NEAR_CAP_PATH).markdown ?? "";
    const overCap = findFile(files, OVER_CAP_PATH).markdown ?? "";

    expect(nearCap.length).toBeGreaterThan(NEAR_CAP_MIN_CHARS);
    expect(nearCap.length).toBeLessThan(SEARCH_MARKDOWN_CAP_CHARS);
    expect(overCap.length).toBeGreaterThan(SEARCH_MARKDOWN_CAP_CHARS + 40_000);
    expect(overCap.includes(OVER_CAP_HEAD_MARKER)).toBe(true);
    expect(overCap.includes(OVER_CAP_TAIL_MARKER)).toBe(true);
    expect(nearCap.includes(NEAR_CAP_TAIL_MARKER)).toBe(true);
  });

  it("embeds query needles that appear in exactly one fixture each", () => {
    const files = generateSyntheticVault("smoke");

    const englishNeedle = findFile(files, ENGLISH_NEEDLE_PATH);
    expect(englishNeedle.markdown ?? "").toContain(ENGLISH_NEEDLE_QUERY);
    for (const file of files) {
      if (file.path === ENGLISH_NEEDLE_PATH) continue;
      const haystack = `${file.title} ${file.markdown ?? ""}`;
      expect(haystack).not.toContain("quokka");
      expect(haystack).not.toContain("zymogeneous");
      expect(haystack).not.toContain("flagword");
    }

    const hanNeedle = findFile(files, HAN_NEEDLE_PATH);
    expect(hanNeedle.markdown ?? "").toContain(HAN_NEEDLE_QUERY);
    for (const file of files) {
      if (file.path === HAN_NEEDLE_PATH) continue;
      const haystack = `${file.title} ${file.markdown ?? ""}`;
      expect(haystack).not.toContain("沧");
      expect(haystack).not.toContain("溟");
    }
  });

  it("anchors the canonical cap fixture paths in every profile", () => {
    for (const profile of ["micro", "smoke", "full"] as const) {
      const files = generateSyntheticVault(profile);
      expect(files.some((file) => file.path === OVER_CAP_PATH), profile).toBe(true);
      expect(files.some((file) => file.path === NEAR_CAP_PATH), profile).toBe(true);
      expect(files.some((file) => file.path === ENGLISH_NEEDLE_PATH), profile).toBe(true);
      expect(files.some((file) => file.path === HAN_NEEDLE_PATH), profile).toBe(true);
    }
  });

  it("includes Han and mixed Chinese/English Markdown content", () => {
    const files = generateSyntheticVault("smoke");
    const hanFiles = files.filter((file) => file.bucket === "han");
    expect(hanFiles.length).toBe(BENCHMARK_PROFILE_SPECS.smoke.buckets.han);
    expect(hanFiles[0]?.markdown ?? "").toMatch(/\p{Script=Han}/u);

    const mixedFiles = files.filter((file) => file.bucket === "mixed");
    const mixedMarkdown = mixedFiles[0]?.markdown ?? "";
    expect(mixedMarkdown).toMatch(/\p{Script=Han}/u);
    expect(mixedMarkdown).toMatch(/[A-Za-z]/);
  });

  it("uses deterministic timestamps derived from the sequence, not the clock", () => {
    const files = generateSyntheticVault("micro");
    expect(files[0]?.ctime).toBe(1_700_000_000_000);
    for (const file of files) {
      expect(file.mtime).toBe(file.ctime + 30_000);
    }
  });
});
