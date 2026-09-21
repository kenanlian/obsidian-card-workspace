import type { CliBenchmarkProfile } from "./fixtures";

export interface BenchmarkCliOptions {
  profile: CliBenchmarkProfile;
  output: string;
  seed: number | null;
}

export class BenchmarkCliArgumentError extends Error {}

export const BENCHMARK_CLI_USAGE = `Usage: npm run benchmark:search -- --profile <smoke|full> --output <absolute-path> [--seed <uint32>]

Options:
  --profile <smoke|full>  Fixture profile to run (default: smoke). "full" is the
                          full diagnostic baseline; "smoke" is the quick CI/verify profile.
  --output <path>         Absolute path for the JSON report (required).
                          Parent directories are created if missing.
  --seed <uint32>         Override the profile's fixed default seed (0..4294967295).
  -h, --help              Show this help.

The command exits 0 on success, 1 if any correctness assertion failed, and 2 on
argument errors. Reports are diagnostic baselines: no millisecond thresholds
are enforced.`;

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
  const options: BenchmarkCliOptions = { profile: "smoke", output: "", seed: null };

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
        if (value !== "smoke" && value !== "full") {
          throw new BenchmarkCliArgumentError(
            `Invalid --profile "${value}": expected "smoke" or "full".\n\n${BENCHMARK_CLI_USAGE}`,
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
      default:
        throw new BenchmarkCliArgumentError(`Unknown argument: ${name}\n\n${BENCHMARK_CLI_USAGE}`);
    }
  }

  if (options.output.length === 0) {
    throw new BenchmarkCliArgumentError(`--output is required.\n\n${BENCHMARK_CLI_USAGE}`);
  }
  return options;
}
