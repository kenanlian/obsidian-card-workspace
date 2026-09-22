import type { CliBenchmarkProfile } from "./fixtures";

export interface BenchmarkCliOptions {
  profile: CliBenchmarkProfile;
  output: string;
  seed: number | null;
  maxSliceMs: number | null;
}

export class BenchmarkCliArgumentError extends Error {}

export const BENCHMARK_CLI_USAGE = `Usage: npm run benchmark:search -- --profile <smoke|full|xl> --output <absolute-path> [--seed <uint32>] [--max-slice-ms <ms>]

Options:
  --profile <smoke|full|xl>  Fixture profile to run (default: smoke). "full" is the
                          full diagnostic baseline; "smoke" is the quick CI/verify
                          profile; "xl" is the opt-in large-vault diagnostic and is
                          not part of CI.
  --output <path>         Absolute path for the JSON report (required).
                          Parent directories are created if missing.
  --seed <uint32>         Override the profile's fixed default seed (0..4294967295).
  --max-slice-ms <ms>     Opt-in timing gate. <ms> is the ceiling for the
                          production budgeted-ingest phase; the remaining
                          production build phases (minisearch-to-json,
                          persist-structured-clone) are held to a fixed 750ms.
                          One correctness check covers both and passes only if
                          every gated phase is within its ceiling. Omit the flag
                          and no timing check is recorded, which is why ordinary
                          and CI runs enforce no wall clock. Deliberate
                          large-vault runs use 300.
  -h, --help              Show this help.

The command exits 0 on success, 1 if any correctness assertion failed, and 2 on
argument errors. Reports are diagnostic baselines: --max-slice-ms is the only
caller-supplied millisecond threshold, and it is never on by default. The
global max blocking slice is reported but never gated. A run that trips the
gate still writes its report so the failure stays diagnosable.`;

const MAX_SEED = 0xffffffff;

function readArgumentValue(
  argv: readonly string[],
  index: number,
  name: string,
  inlineValue: string | undefined,
): { value: string; nextIndex: number } {
  if (inlineValue !== undefined) {
    return { value: inlineValue, nextIndex: index + 1 };
  }
  const next = argv[index + 1];
  if (next === undefined || next.startsWith("--")) {
    throw new BenchmarkCliArgumentError(`Missing value for ${name}.\n\n${BENCHMARK_CLI_USAGE}`);
  }
  return { value: next, nextIndex: index + 2 };
}

export function parseBenchmarkCliArgs(argv: readonly string[]): BenchmarkCliOptions {
  const options: BenchmarkCliOptions = { profile: "smoke", output: "", seed: null, maxSliceMs: null };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) {
      break;
    }
    const equalsIndex = argument.indexOf("=");
    let name = argument;
    let inlineValue: string | undefined;
    if (argument.startsWith("--") && equalsIndex !== -1) {
      name = argument.slice(0, equalsIndex);
      inlineValue = argument.slice(equalsIndex + 1);
    }

    switch (name) {
      case "--profile": {
        const { value, nextIndex } = readArgumentValue(argv, index, name, inlineValue);
        index = nextIndex - 1;
        if (value !== "smoke" && value !== "full" && value !== "xl") {
          throw new BenchmarkCliArgumentError(
            `Invalid --profile "${value}": expected "smoke", "full", or "xl".\n\n${BENCHMARK_CLI_USAGE}`,
          );
        }
        options.profile = value;
        break;
      }
      case "--output": {
        const { value, nextIndex } = readArgumentValue(argv, index, name, inlineValue);
        index = nextIndex - 1;
        if (value.trim().length === 0) {
          throw new BenchmarkCliArgumentError(`--output must not be empty.\n\n${BENCHMARK_CLI_USAGE}`);
        }
        options.output = value;
        break;
      }
      case "--seed": {
        const { value, nextIndex } = readArgumentValue(argv, index, name, inlineValue);
        index = nextIndex - 1;
        if (!/^\d+$/.test(value) || Number(value) > MAX_SEED) {
          throw new BenchmarkCliArgumentError(
            `Invalid --seed "${value}": expected an integer in 0..${MAX_SEED}.\n\n${BENCHMARK_CLI_USAGE}`,
          );
        }
        options.seed = Number(value);
        break;
      }
      case "--max-slice-ms": {
        const { value, nextIndex } = readArgumentValue(argv, index, name, inlineValue);
        index = nextIndex - 1;
        if (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) <= 0) {
          throw new BenchmarkCliArgumentError(
            `Invalid --max-slice-ms "${value}": expected a positive number of milliseconds.\n\n${BENCHMARK_CLI_USAGE}`,
          );
        }
        options.maxSliceMs = Number(value);
        break;
      }
      default:
        throw new BenchmarkCliArgumentError(`Unknown argument: ${name}\n\n${BENCHMARK_CLI_USAGE}`);
    }
  }

  if (options.output.length === 0) {
    throw new BenchmarkCliArgumentError(`--output is required.\n\n${BENCHMARK_CLI_USAGE}`);
  }
  return options;
}
