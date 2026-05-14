import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

interface ReleaseFixtureOptions {
  packageVersion?: string;
  packageLockVersion?: string;
  packageLockRootVersion?: string;
  manifestVersion?: string;
  minAppVersion?: string;
  versions?: Record<string, string>;
}

const ROOT = process.cwd();
const CHECK_RELEASE_SCRIPT = path.resolve(ROOT, "scripts/check-release.mjs");
const SYNC_VERSION_SCRIPT = path.resolve(ROOT, "scripts/sync-version.mjs");

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createReleaseFixture(options: ReleaseFixtureOptions = {}): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "card-workspace-release-"));
  const packageVersion = options.packageVersion ?? "0.1.0";
  const packageLockVersion = options.packageLockVersion ?? packageVersion;
  const packageLockRootVersion = options.packageLockRootVersion ?? packageLockVersion;
  const manifestVersion = options.manifestVersion ?? packageVersion;
  const minAppVersion = options.minAppVersion ?? "1.5.0";
  const versions = options.versions ?? {
    [manifestVersion]: minAppVersion,
  };

  writeJson(path.join(tempDir, "package.json"), {
    name: "card-workspace",
    version: packageVersion,
  });
  writeJson(path.join(tempDir, "package-lock.json"), {
    name: "card-workspace",
    version: packageLockVersion,
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: "card-workspace",
        version: packageLockRootVersion,
      },
    },
  });
  writeJson(path.join(tempDir, "manifest.json"), {
    id: "card-workspace",
    name: "Card Workspace",
    version: manifestVersion,
    minAppVersion,
  });
  writeJson(path.join(tempDir, "versions.json"), versions);

  return tempDir;
}

describe("release support", () => {
  it("validates aligned metadata against a matching bare semver tag", () => {
    const tempDir = createReleaseFixture();

    try {
      const result = spawnSync(process.execPath, [CHECK_RELEASE_SCRIPT, "0.1.0"], {
        cwd: tempDir,
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Release metadata is valid for version 0.1.0");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects a v-prefixed release tag", () => {
    const tempDir = createReleaseFixture();

    try {
      const result = spawnSync(process.execPath, [CHECK_RELEASE_SCRIPT, "v0.1.0"], {
        cwd: tempDir,
        encoding: "utf8",
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("release tag must use x.y.z semver, received 'v0.1.0'.");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("fails when release metadata drifts", () => {
    const tempDir = createReleaseFixture({
      packageVersion: "0.1.0",
      packageLockVersion: "0.1.2",
      packageLockRootVersion: "0.1.3",
      manifestVersion: "0.1.1",
      versions: {
        "0.1.1": "1.6.0",
      },
    });

    try {
      const result = spawnSync(process.execPath, [CHECK_RELEASE_SCRIPT, "0.1.1"], {
        cwd: tempDir,
        encoding: "utf8",
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("package-lock.json version '0.1.2' must match package.json version '0.1.0'.");
      expect(result.stderr).toContain("package-lock.json packages[\"\"] version '0.1.3' must match package.json version '0.1.0'.");
      expect(result.stderr).toContain("package.json version '0.1.0' must match manifest.json version '0.1.1'.");
      expect(result.stderr).toContain(
        "versions.json['0.1.1'] must equal manifest.json minAppVersion '1.5.0', received '1.6.0'.",
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("syncs package, package-lock, manifest, and compatibility metadata for a new release", () => {
    const tempDir = createReleaseFixture();

    try {
      const result = spawnSync(process.execPath, [SYNC_VERSION_SCRIPT, "0.2.0", "1.6.0"], {
        cwd: tempDir,
        encoding: "utf8",
      });

      expect(result.status).toBe(0);

      const packageJson = JSON.parse(fs.readFileSync(path.join(tempDir, "package.json"), "utf8"));
      const packageLockJson = JSON.parse(fs.readFileSync(path.join(tempDir, "package-lock.json"), "utf8"));
      const manifestJson = JSON.parse(fs.readFileSync(path.join(tempDir, "manifest.json"), "utf8"));
      const versionsJson = JSON.parse(fs.readFileSync(path.join(tempDir, "versions.json"), "utf8"));

      expect(packageJson.version).toBe("0.2.0");
      expect(packageLockJson.version).toBe("0.2.0");
      expect(packageLockJson.packages[""].version).toBe("0.2.0");
      expect(manifestJson.version).toBe("0.2.0");
      expect(manifestJson.minAppVersion).toBe("1.6.0");
      expect(versionsJson["0.2.0"]).toBe("1.6.0");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite an existing release version mapping", () => {
    const tempDir = createReleaseFixture({
      versions: {
        "0.1.0": "1.5.0",
        "0.2.0": "1.6.0",
      },
    });
    const originalPackageJson = fs.readFileSync(path.join(tempDir, "package.json"), "utf8");
    const originalPackageLockJson = fs.readFileSync(path.join(tempDir, "package-lock.json"), "utf8");
    const originalManifestJson = fs.readFileSync(path.join(tempDir, "manifest.json"), "utf8");
    const originalVersionsJson = fs.readFileSync(path.join(tempDir, "versions.json"), "utf8");

    try {
      const result = spawnSync(process.execPath, [SYNC_VERSION_SCRIPT, "0.2.0", "1.6.0"], {
        cwd: tempDir,
        encoding: "utf8",
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("versions.json already contains '0.2.0'. Choose a new version instead of overwriting an existing release mapping.");
      expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe(originalPackageJson);
      expect(fs.readFileSync(path.join(tempDir, "package-lock.json"), "utf8")).toBe(originalPackageLockJson);
      expect(fs.readFileSync(path.join(tempDir, "manifest.json"), "utf8")).toBe(originalManifestJson);
      expect(fs.readFileSync(path.join(tempDir, "versions.json"), "utf8")).toBe(originalVersionsJson);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("wires release scripts and workflow assets into the repository", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(ROOT, "package.json"), "utf8"));
    const workflow = fs.readFileSync(path.resolve(ROOT, ".github/workflows/release.yml"), "utf8");

    expect(packageJson.scripts["release:check"]).toBe("node scripts/check-release.mjs");
    expect(packageJson.scripts["release:prepare"]).toBe("node scripts/sync-version.mjs");
    expect(workflow).toContain("tags:");
    expect(workflow).toContain('- "[0-9]*.[0-9]*.[0-9]*"');
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("npm run check:svelte");
    expect(workflow).toContain("npm run release:check -- \"$TAG\"");
    expect(workflow).toContain("main.js manifest.json styles.css");
  });
});
