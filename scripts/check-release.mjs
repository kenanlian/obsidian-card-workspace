import path from "node:path";
import { promises as fs } from "node:fs";

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

async function readJson(relativePath) {
  const filePath = path.resolve(process.cwd(), relativePath);
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content);
}

function validateVersion(value, label, errors) {
  if (!VERSION_PATTERN.test(value)) {
    errors.push(`${label} must use x.y.z semver, received '${value}'.`);
  }
}

function validatePackageLock(packageLockJson, packageVersion, errors) {
  validateVersion(packageLockJson.version, "package-lock.json version", errors);

  const rootPackage = packageLockJson.packages?.[""];
  const rootPackageVersion = rootPackage?.version;
  if (typeof rootPackageVersion !== "string") {
    errors.push('package-lock.json packages[""] version must be defined.');
    return;
  }

  validateVersion(rootPackageVersion, 'package-lock.json packages[""] version', errors);

  if (packageLockJson.version !== packageVersion) {
    errors.push(
      `package-lock.json version '${packageLockJson.version}' must match package.json version '${packageVersion}'.`,
    );
  }

  if (rootPackageVersion !== packageVersion) {
    errors.push(
      `package-lock.json packages[""] version '${rootPackageVersion}' must match package.json version '${packageVersion}'.`,
    );
  }
}

async function main() {
  const tag = process.argv[2] ?? null;
  const packageJson = await readJson("package.json");
  const packageLockJson = await readJson("package-lock.json");
  const manifestJson = await readJson("manifest.json");
  const versionsJson = await readJson("versions.json");

  const errors = [];

  validateVersion(packageJson.version, "package.json version", errors);
  validatePackageLock(packageLockJson, packageJson.version, errors);
  validateVersion(manifestJson.version, "manifest.json version", errors);
  validateVersion(manifestJson.minAppVersion, "manifest.json minAppVersion", errors);

  if (packageJson.version !== manifestJson.version) {
    errors.push(
      `package.json version '${packageJson.version}' must match manifest.json version '${manifestJson.version}'.`,
    );
  }

  if (versionsJson[manifestJson.version] !== manifestJson.minAppVersion) {
    const actualMinAppVersion = versionsJson[manifestJson.version];
    errors.push(
      `versions.json['${manifestJson.version}'] must equal manifest.json minAppVersion '${manifestJson.minAppVersion}', received '${actualMinAppVersion ?? "undefined"}'.`,
    );
  }

  if (tag !== null) {
    validateVersion(tag, "release tag", errors);

    if (tag !== manifestJson.version) {
      errors.push(`release tag '${tag}' must match manifest.json version '${manifestJson.version}'.`);
    }
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error);
    }

    process.exitCode = 1;
    return;
  }

  console.log(
    `Release metadata is valid for version ${manifestJson.version} (minAppVersion ${manifestJson.minAppVersion}).`,
  );
}

await main();
