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
    expect(parsed).toEqual({ profile: "smoke", output: "/tmp/report.json", seed: null });
  });

  it("accepts next-argument and inline=value forms", () => {
    expect(parseBenchmarkCliArgs(["--profile", "full", "--output", "/tmp/r.json"])).toEqual({
      profile: "full",
      output: "/tmp/r.json",
      seed: null,
    });
    expect(parseBenchmarkCliArgs(["--profile=smoke", "--output=/tmp/r.json", "--seed=42"])).toEqual({
      profile: "smoke",
      output: "/tmp/r.json",
      seed: 42,
    });
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

  it("exposes usage text that documents both profiles and the output path", () => {
    expect(BENCHMARK_CLI_USAGE).toContain("--profile <smoke|full>");
    expect(BENCHMARK_CLI_USAGE).toContain("--output <path>");
    expect(BENCHMARK_CLI_USAGE).not.toContain("micro");
  });

  it("accepts the maximum uint32 seed", () => {
    expect(parseBenchmarkCliArgs(["--output", "/tmp/r.json", "--seed", "4294967295"]).seed).toBe(
      4294967295,
    );
  });
});
