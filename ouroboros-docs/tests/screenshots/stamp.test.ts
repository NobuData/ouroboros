import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { Manifest } from "../../screenshots/lib/manifest.ts";
import {
  fullyCaptured,
  readUiVersion,
  stampEntries,
  writeManifest,
} from "../../screenshots/lib/stamp.ts";

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
});

/**
 * A fresh scratch directory, removed after the test.
 *
 * @returns its path.
 */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "docs-stamp-"));
  scratch.push(dir);
  return dir;
}

const MANIFEST: Manifest = {
  entries: [
    {
      id: "home.dashboard",
      route: "/dashboard",
      workspace: "acme",
      ready: "h1",
      clip: "page",
      caption: "c",
      alt: "a",
    },
    {
      id: "cli.install",
      route: "/farm",
      workspace: "acme",
      ready: "h1",
      clip: "page",
      caption: "c",
      alt: "a",
    },
  ],
};
const STAMP = { capturedAt: "2026-10-08T12:00:00.000Z", uiVersion: "0.40.0", seedRef: "abc" };

describe("stampEntries", () => {
  it("stamps the captured entries and leaves the others alone", () => {
    const stamped = stampEntries(MANIFEST, ["home.dashboard"], STAMP);
    expect(stamped.entries[0]).toMatchObject(STAMP);
    expect(stamped.entries[1]).toEqual(MANIFEST.entries[1]);
    expect(MANIFEST.entries[0]).not.toHaveProperty("capturedAt");
  });
});

describe("fullyCaptured", () => {
  const log = [
    '{"id":"home.dashboard","theme":"light"}',
    '{"id":"cli.install","theme":"light"}',
    '{"id":"home.dashboard","theme":"dark"}',
    "",
  ].join("\n");

  it("returns the entries captured in every requested theme", () => {
    expect(fullyCaptured(log, ["light", "dark"])).toEqual(["home.dashboard"]);
  });

  it("counts a single-theme run as full when that theme landed", () => {
    expect(fullyCaptured(log, ["light"])).toEqual(["home.dashboard", "cli.install"]);
  });

  it("returns nothing for an empty log", () => {
    expect(fullyCaptured("", ["light", "dark"])).toEqual([]);
  });
});

describe("writeManifest and readUiVersion", () => {
  it("writes two-space JSON with a final newline", () => {
    const file = join(tempDir(), "manifest.json");
    writeManifest(MANIFEST, file);
    const text = readFileSync(file, "utf8");
    expect(text).toBe(`${JSON.stringify(MANIFEST, null, 2)}\n`);
  });

  it("reads a package version", () => {
    const file = join(tempDir(), "package.json");
    writeFileSync(file, '{"name":"ouroboros-ui","version":"1.2.3"}');
    expect(readUiVersion(file)).toBe("1.2.3");
  });
});
