import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { main, type CheckPaths } from "../../screenshots/check.ts";
import { MAX_IMAGE_BYTES } from "../../screenshots/lib/integrity.ts";

/** The module directory. */
const MODULE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A valid manifest entry, minus its id and stamps. */
const ENTRY = {
  route: "/dashboard",
  workspace: "acme-robotics",
  ready: "main",
  clip: "page",
  caption: "A caption.",
  alt: "Alt text.",
};

let root: string;
let paths: CheckPaths;
let logged: string[];
let errors: string[];

/**
 * Runs the check against the fixture.
 *
 * @returns the exit code.
 */
function check(): number {
  return main(paths, { log: (line) => logged.push(line), error: (line) => errors.push(line) });
}

/**
 * Writes a file in the fixture, creating its directory.
 *
 * @param path the path, relative to the fixture root.
 * @param content its content.
 */
function put(path: string, content: string | Buffer): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "docs-check-"));
  paths = {
    moduleDir: root,
    manifestPath: join(root, "manifest.json"),
    imagesDir: join(root, "static/img/screenshots"),
    pageDirs: ["docs"],
    uiPackageJson: join(root, "ui/package.json"),
  };
  logged = [];
  errors = [];
  put(
    "manifest.json",
    JSON.stringify({ entries: [{ id: "home.dashboard", ...ENTRY, uiVersion: "0.144.0" }] }),
  );
  put("static/img/screenshots/home/dashboard.light.png", "png");
  put("static/img/screenshots/home/dashboard.dark.png", "png");
  put("docs/index.mdx", '<Screenshot id="home.dashboard" />\n');
  put("ui/package.json", JSON.stringify({ version: "0.144.3" }));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("yarn check:screenshots", () => {
  it("exits 0 when everything agrees", () => {
    expect(check()).toBe(0);
    expect(errors).toEqual([]);
    expect(logged.join("\n")).toMatch(/1 entries, all images accounted for/);
  });

  it.each([
    ["missing-image", () => rmSync(join(root, "static/img/screenshots/home/dashboard.dark.png"))],
    ["unknown-screenshot-id", () => put("docs/more.md", '<Screenshot id="cli.nope" />')],
    ["orphan-image", () => put("static/img/screenshots/cli/stray.light.png", "png")],
    [
      "image-over-budget",
      () =>
        put("static/img/screenshots/home/dashboard.light.png", Buffer.alloc(MAX_IMAGE_BYTES + 1)),
    ],
    ["invalid-manifest", () => put("manifest.json", JSON.stringify({ entries: [{ id: "x" }] }))],
  ])("names %s and exits 1", (code, breakIt) => {
    breakIt();
    expect(check()).toBe(1);
    expect(errors[0]).toMatch(new RegExp(`^yarn check:screenshots: ${code}: `));
  });

  it("prints the staleness table and still exits 0", () => {
    put("ui/package.json", JSON.stringify({ version: "0.145.0" }));
    expect(check()).toBe(0);
    expect(errors).toEqual([]);
    const report = logged.join("\n");
    expect(report).toMatch(/1 screenshot\(s\) captured before ouroboros-ui 0\.145/);
    expect(report).toMatch(/home\.dashboard\s+0\.144\.0/);
  });

  it("prints the staleness table alongside failures", () => {
    put("ui/package.json", JSON.stringify({ version: "0.145.0" }));
    put("static/img/screenshots/stray.png", "png");
    expect(check()).toBe(1);
    expect(logged.join("\n")).toMatch(/captured before ouroboros-ui 0\.145/);
  });

  it("skips the staleness report when the UI is not beside it", () => {
    rmSync(join(root, "ui"), { recursive: true });
    expect(check()).toBe(0);
    expect(logged.join("\n")).toMatch(/Staleness report skipped/);
  });

  it("skips the staleness report when the UI's version is not semver", () => {
    put("ui/package.json", JSON.stringify({ version: "next" }));
    expect(check()).toBe(0);
    expect(logged.join("\n")).toMatch(/Staleness report skipped: .*not semver/);
  });

  it("passes on the committed site", () => {
    const run = spawnSync(process.execPath, ["screenshots/check.ts"], {
      cwd: MODULE_DIR,
      encoding: "utf8",
    });
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });
});
