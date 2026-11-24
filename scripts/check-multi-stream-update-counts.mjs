// Run the same leaf fixture against the original integration baseline and the task tree.
import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const baseline = "030bc84ef9871587c55917da6e1fc46de7410c8d";
const root = process.cwd();
const scratch = await mkdtemp(path.join(tmpdir(), "card-stream-counts-"));
const fixture = "src/view/multi-stream-view.test.ts";
const args = ["node_modules/vitest/vitest.mjs", "run", "--project", "node", fixture, "-t", "measures leaf work"];

function runFixture(cwd, label) {
  execFileSync(process.execPath, args, {
    cwd, env: { ...process.env, CARD_STREAM_COUNT_FIXTURE: label }, stdio: "inherit",
  });
}

try {
  const archive = execFileSync("git", ["archive", baseline, "src", "vitest.config.ts", "tsconfig.json", "package.json"], { maxBuffer: 64 * 1024 * 1024 });
  execFileSync("tar", ["-xf", "-", "-C", scratch], { input: archive });
  await symlink(path.join(root, "node_modules"), path.join(scratch, "node_modules"), "dir");
  await copyFile(fixture, path.join(scratch, fixture));
  runFixture(scratch, "030bc84");
  runFixture(root, "candidate");
} finally {
  await rm(scratch, { recursive: true, force: true });
}
