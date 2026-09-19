import { compareVersions, parseVersion, type Version } from "./semver";

/**
 * Parse a version a test knows is well-formed.
 *
 * @param text - The version.
 * @returns It, parsed.
 */
function v(text: string): Version {
  const parsed = parseVersion(text);
  if (!parsed) throw new Error(`not a version: ${text}`);
  return parsed;
}

describe("semantic-version precedence", () => {
  it("parses the three numbers and the pre-release identifiers", () => {
    expect(parseVersion("1.4.0")).toEqual({ major: 1, minor: 4, patch: 0, prerelease: [] });
    expect(parseVersion("0.2.0-rc.1+build.7")).toEqual({
      major: 0,
      minor: 2,
      patch: 0,
      prerelease: ["rc", "1"],
    });
  });

  it("refuses what is not SemVer", () => {
    for (const text of ["v1.0.0", "1.0", "1.0.0.0", "01.0.0", "dev", "", "1.0.0-", "1.0.0-01"]) {
      expect(parseVersion(text)).toBeUndefined();
    }
  });

  // SemVer 2.0.0 § 11's own example chain, in order.
  it("orders the specification's own example", () => {
    const chain = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];

    for (let i = 1; i < chain.length; i += 1) {
      expect(compareVersions(v(chain[i - 1]), v(chain[i]))).toBeLessThan(0);
      expect(compareVersions(v(chain[i]), v(chain[i - 1]))).toBeGreaterThan(0);
    }
  });

  it("compares numbers as numbers, where a string comparison would not", () => {
    expect(compareVersions(v("0.10.0"), v("0.9.0"))).toBeGreaterThan(0);
    expect(compareVersions(v("2.0.0"), v("10.0.0"))).toBeLessThan(0);
  });

  it("ignores build metadata", () => {
    expect(compareVersions(v("1.0.0+a"), v("1.0.0+b"))).toBe(0);
  });
});
