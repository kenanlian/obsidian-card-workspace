import path from "node:path";
import { promises as fs } from "node:fs";

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function assertVersion(value, label) {
  if (!VERSION_PATTERN.test(value)) {
    throw new Error(`${label} must use x.y.z semver, received '${value}'.`);
  }
}

async function readJson(relativePath) {
  const filePath = path.resolve(process.cwd(), relativePath);
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content);
}

async function writeJson(relativePath, data) {
  const filePath = path.resolve(process.cwd(), relativePath);
  const content = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(filePath, content, "utf8");
}

async function main() {
  const nextVersion = process.argv[2];
  const nextMinAppVersion = process.argv[3] ?? null;

  if (!nextVersion) {
    throw new Error("Usage: node scripts/sync-version.mjs <version> [minAppVersion]");
  }

  assertVersion(nextVersion, "version");

  if (nextMinAppVersion !== null) {
    assertVersion(nextMinAppVersion, "minAppVersion");
  }

  const packageJson = await readJson("package.json");
  const packageLockJson = await readJson("package-lock.json");
  const manifestJson = await readJson("manifest.json");
  const versionsJson = await readJson("versions.json");
  const resolvedMinAppVersion = nextMinAppVersion ?? manifestJson.minAppVersion;

  if (Object.prototype.hasOwnProperty.call(versionsJson, nextVersion)) {
    throw new Error(
      `versions.json already contains '${nextVersion}'. Choose a new version instead of overwriting an existing release mapping.`,
    );
  }

  packageJson.version = nextVersion;
  packageLockJson.version = nextVersion;
  if (!packageLockJson.packages || typeof packageLockJson.packages[""] !== "object") {
    throw new Error('package-lock.json packages[""] metadata must be defined.');
  }
  packageLockJson.packages[""].version = nextVersion;
  manifestJson.version = nextVersion;
  manifestJson.minAppVersion = resolvedMinAppVersion;
  versionsJson[nextVersion] = resolvedMinAppVersion;

  await writeJson("package.json", packageJson);
  await writeJson("package-lock.json", packageLockJson);
  await writeJson("manifest.json", manifestJson);
  await writeJson("versions.json", versionsJson);

  console.log(
    `Synced package.json, package-lock.json, manifest.json, and versions.json to ${nextVersion} (minAppVersion ${resolvedMinAppVersion}).`,
  );
}

await main();
