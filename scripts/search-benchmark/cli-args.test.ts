import { describe, expect, it } from "vitest";

import {
  BENCHMARK_CLI_USAGE,
  BenchmarkCliArgumentError,
  parseBenchmarkCliArgs,
} from "./cli-args";

describe("parseBenchmarkCliArgs", () => {
  it("defaults to the smoke profile and requires --output", () => {
    expect(() => parseBenchmarkCliArgs([])).toThrow(BenchmarkCliArgumentError);
    expect(() => parseBenchmarkCliArgs([])).toThrow(/--output is required/);

    const parsed = parseBenchmarkCliArgs(["--output", "/tmp/report.json"]);
    expect(parsed).toEqual({
      profile: "smoke",
      output: "/tmp/report.json",
      seed: null,
      maxSliceMs: null,
    });
  });

  it("accepts next-argument and inline=value forms", () => {
    expect(parseBenchmarkCliArgs(["--profile", "full", "--output", "/tmp/r.json"])).toEqual({
      profile: "full",
      output: "/tmp/r.json",
      seed: null,
      maxSliceMs: null,
    });
    expect(parseBenchmarkCliArgs(["--profile=smoke", "--output=/tmp/r.json", "--seed=42"])).toEqual({
      profile: "smoke",
      output: "/tmp/r.json",
      seed: 42,
      maxSliceMs: null,
    });
    expect(parseBenchmarkCliArgs(["--profile", "xl", "--output", "/tmp/xl.json"]).profile).toBe("xl");
  });

  it("rejects invalid profiles, seeds, and unknown arguments", () => {
    expect(() => parseBenchmarkCliArgs(["--profile", "micro", "--output", "/tmp/r.json"])).toThrow(
      /Invalid --profile "micro"/,
    );
    expect(() => parseBenchmarkCliArgs(["--output", "/tmp/r.json", "--seed", "-1"])).toThrow(
      /Invalid --seed "-1"/,
    );
    expect(() => parseBenchmarkCliArgs(["--output", "/tmp/r.json", "--seed", "4294967296"])).toThrow(
      /Invalid --seed "4294967296"/,
    );
    expect(() => parseBenchmarkCliArgs(["--wat", "--output", "/tmp/r.json"])).toThrow(
      /Unknown argument: --wat/,
    );
  });

  it("rejects flags with missing values", () => {
    expect(() => parseBenchmarkCliArgs(["--output"])).toThrow(/Missing value for --output/);
    expect(() => parseBenchmarkCliArgs(["--profile", "--output", "/tmp/r.json"])).toThrow(
      /Missing value for --profile/,
    );
  });

  it("exposes usage text that documents the profiles and the output path", () => {
    expect(BENCHMARK_CLI_USAGE).toContain("--profile <smoke|full|xl>");
    expect(BENCHMARK_CLI_USAGE).toContain("--output <path>");
    expect(BENCHMARK_CLI_USAGE).not.toContain("micro");
  });

  it("parses --max-slice-ms in both forms and leaves it null when absent", () => {
    expect(parseBenchmarkCliArgs(["--output", "/tmp/r.json", "--max-slice-ms", "300"]).maxSliceMs).toBe(300);
    expect(parseBenchmarkCliArgs(["--output=/tmp/r.json", "--max-slice-ms=12.5"]).maxSliceMs).toBe(12.5);
    expect(parseBenchmarkCliArgs(["--output", "/tmp/r.json"]).maxSliceMs).toBeNull();
  });

  it("rejects non-positive and malformed --max-slice-ms values", () => {
    for (const value of ["0", "-5", "abc", "1e3", ""]) {
      expect(() => parseBenchmarkCliArgs(["--output", "/tmp/r.json", "--max-slice-ms", value])).toThrow(
        BenchmarkCliArgumentError,
      );
    }
    expect(() => parseBenchmarkCliArgs(["--output", "/tmp/r.json", "--max-slice-ms"])).toThrow(
      /Missing value for --max-slice-ms/,
    );
  });

  it("documents the opt-in gate, both ceilings, and no longer claims zero thresholds", () => {
    expect(BENCHMARK_CLI_USAGE).toContain("--max-slice-ms <ms>");
    expect(BENCHMARK_CLI_USAGE).toContain("budgeted-ingest");
    expect(BENCHMARK_CLI_USAGE).toContain("750ms");
    expect(BENCHMARK_CLI_USAGE).toContain("never gated");
    expect(BENCHMARK_CLI_USAGE).not.toContain("no millisecond thresholds");
  });

  it("accepts the maximum uint32 seed", () => {
    expect(parseBenchmarkCliArgs(["--output", "/tmp/r.json", "--seed", "4294967295"]).seed).toBe(
      4294967295,
    );
  });
});
