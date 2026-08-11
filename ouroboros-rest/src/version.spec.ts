import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SERVICE_NAME, readServiceVersion, serviceVersion } from "./version";

/**
 * A directory to write manifest fixtures into, removed again after the suite. Fixtures
 * are written rather than committed because what is under test is how a *malformed*
 * manifest is reported, and a committed file that is deliberately broken is one someone
 * eventually tries to fix.
 */
let fixtures: string;

beforeAll(() => {
  fixtures = mkdtempSync(join(tmpdir(), "ouroboros-rest-manifest-"));
});

afterAll(() => {
  rmSync(fixtures, { recursive: true, force: true });
});

/**
 * Write a manifest fixture.
 *
 * @param name - File name within the fixture directory.
 * @param contents - Exactly what to write, so a fixture can be invalid JSON.
 * @returns The path written.
 */
function fixture(name: string, contents: string): string {
  const path = join(fixtures, name);
  writeFileSync(path, contents, "utf8");
  return path;
}

describe("readServiceVersion", () => {
  it("reads the version out of a manifest", () => {
    const path = fixture("valid.json", JSON.stringify({ name: SERVICE_NAME, version: "1.2.3" }));

    expect(readServiceVersion(path)).toBe("1.2.3");
  });

  it("reports the path when the manifest is missing", () => {
    const path = join(fixtures, "absent.json");

    expect(() => readServiceVersion(path)).toThrow(`Cannot read the service manifest at ${path}`);
  });

  it("reports the path when the manifest is not JSON", () => {
    const path = fixture("prose.json", "this is not a manifest\n");

    expect(() => readServiceVersion(path)).toThrow(
      `The service manifest at ${path} is not valid JSON`,
    );
  });

  it.each([
    ["carries no version field", JSON.stringify({ name: SERVICE_NAME })],
    ["carries a version that is not a string", JSON.stringify({ version: 3 })],
    ["carries an empty version", JSON.stringify({ version: "" })],
    ["is a JSON value that is not an object", JSON.stringify("0.1.0")],
    ["is JSON null", "null"],
  ])("reports the path when the manifest %s", (_description, contents) => {
    const path = fixture(`no-version-${_description.replace(/\W+/g, "-")}.json`, contents);

    expect(() => readServiceVersion(path)).toThrow(
      `The service manifest at ${path} declares no version`,
    );
  });
});

describe("serviceVersion", () => {
  it("reads this module's own manifest", () => {
    // Read independently of the code under test, so this asserts the two agree rather
    // than asserting the reader agrees with itself.
    const manifest = readServiceVersion(join(__dirname, "..", "package.json"));

    expect(serviceVersion()).toBe(manifest);
    expect(serviceVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("answers the same string every time, having read the file once", () => {
    expect(serviceVersion()).toBe(serviceVersion());
  });
});

describe("SERVICE_NAME", () => {
  it("is the name the manifest and the workspace roster both use", () => {
    expect(SERVICE_NAME).toBe("ouroboros-rest");
  });
});
