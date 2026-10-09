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
      "check:screenshots",
      "sync:brand",
      "check:brand",
    ]) {
      expect(manifest.scripts, verb).toHaveProperty(verb);
    }
  });

  it("serves the dev site on port 3100, clear of the UI and web on 3000", () => {
    expect(manifest.scripts.dev).toMatch(/docusaurus start --port 3100$/);
  });

  it("syncs the brand before every dev server and build", () => {
    for (const verb of ["dev", "build"]) {
      expect(manifest.scripts[verb], verb).toMatch(/^node scripts\/sync-brand\.mjs && /);
    }
    expect(manifest.scripts["check:brand"]).toBe("node scripts/sync-brand.mjs --check");
  });

  it("lints the code, the stylesheets and the pages — ci/docs runs exactly this", () => {
    expect(manifest.scripts.lint).toBe('eslint . && stylelint "src/**/*.css" && markdownlint-cli2');
  });

  it("points markdownlint at the site's pages, and not at partials", () => {
    const config = readFileSync(join(MODULE_DIR, ".markdownlint-cli2.jsonc"), "utf8");
    // A `_*.mdx` partial has no front matter (Docusaurus rejects it under CI), so the
    // first-heading rule cannot hold it; the generated one is held by its own tests.
    expect(config).toContain('"globs": ["docs/**/*.{md,mdx}", "!docs/**/_*.mdx"]');
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
    for (const sample of [
      "blog",
      "docs/intro.mdx",
      "docs/tutorial-basics",
      "src/components/HomepageFeatures",
      "src/pages/markdown-page.md",
    ]) {
      expect(existsSync(join(MODULE_DIR, sample)), sample).toBe(false);
    }
  });
});

describe("yarn screenshots", () => {
  it("runs the capture harness under Node's own TypeScript support", () => {
    expect(manifest.scripts.screenshots).toBe("node screenshots/run.ts");
    expect(existsSync(join(MODULE_DIR, "scripts/screenshots-placeholder.mjs"))).toBe(false);
  });

  it("pins Playwright to the e2e suite's major", () => {
    const e2e = JSON.parse(readFileSync(join(MODULE_DIR, "../tests/e2e/package.json"), "utf8")) as {
      devDependencies: Record<string, string>;
    };
    const major = (range: string) => range.replace(/^\D*/, "").split(".")[0];
    expect(major(manifest.devDependencies["@playwright/test"])).toBe(
      major(e2e.devDependencies["@playwright/test"]),
    );
  });

  it("runs the docs coverage gate under Node's own TypeScript support", () => {
    expect(manifest.scripts["check:coverage"]).toBe("node scripts/check-coverage.ts");
  });

  it("checks the CLI pages document every flag, under Node's own TypeScript support", () => {
    expect(manifest.scripts["check:cli-flags"]).toBe("node scripts/check-cli-flags.ts");
  });

  it("checks screenshot integrity under Node's own TypeScript support", () => {
    expect(manifest.scripts["check:screenshots"]).toBe("node screenshots/check.ts");
  });

  it("keeps the saved session out of git", () => {
    expect(readFileSync(join(MODULE_DIR, ".gitignore"), "utf8")).toContain("screenshots/.auth/");
  });
});
