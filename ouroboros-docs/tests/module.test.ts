import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The module directory (`ouroboros-docs/`). */
const MODULE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The module's package manifest. */
const manifest = JSON.parse(readFileSync(join(MODULE_DIR, "package.json"), "utf8")) as {
  name: string;
  version: string;
  license: string;
  packageManager: string;
  engines: Record<string, string>;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe("package.json", () => {
  it("names, versions and licenses the module", () => {
    expect(manifest).toMatchObject({
      name: "ouroboros-docs",
      license: "Apache-2.0",
      packageManager: "yarn@4.18.0",
      engines: { node: ">=24" },
    });
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("exposes every verb the roadmap names", () => {
    for (const verb of [
      "dev",
      "build",
      "serve",
      "clear",
      "lint",
      "typecheck",
      "test",
      "format:check",
      "screenshots",
    ]) {
      expect(manifest.scripts, verb).toHaveProperty(verb);
    }
  });

  it("serves the dev site on port 3100, clear of the UI and web on 3000", () => {
    expect(manifest.scripts.dev).toBe("docusaurus start --port 3100");
  });

  it("pins every @docusaurus package to one exact 3.10 patch", () => {
    const pins = Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })
      .filter(([name]) => name.startsWith("@docusaurus/"))
      .map(([, version]) => version);
    expect(pins.length).toBeGreaterThan(0);
    expect(new Set(pins).size).toBe(1);
    expect(pins[0]).toMatch(/^3\.10\.\d+$/);
  });
});

describe("module files", () => {
  it.each(["yarn.lock", ".yarnrc.yml", ".gitignore", ".dockerignore", "README.md"])(
    "has its own %s",
    (file) => {
      expect(existsSync(join(MODULE_DIR, file))).toBe(true);
    },
  );

  it("installs into node_modules", () => {
    expect(readFileSync(join(MODULE_DIR, ".yarnrc.yml"), "utf8")).toMatch(
      /^nodeLinker: node-modules$/m,
    );
  });

  it("keeps none of the scaffold's samples", () => {
    for (const sample of ["blog", "docs/intro.mdx", "docs/tutorial-basics", "src/components"]) {
      expect(existsSync(join(MODULE_DIR, sample)), sample).toBe(false);
    }
  });
});

describe("yarn screenshots", () => {
  it("fails loudly until the capture harness exists", () => {
    const run = spawnSync(process.execPath, ["scripts/screenshots-placeholder.mjs"], {
      cwd: MODULE_DIR,
      encoding: "utf8",
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("CZ.1");
  });
});
