import { GlobSet, globToRegExp, nearestGlob, widenToScope } from "./guardrails.glob";

/**
 * The glob grammar — `**`, `*`, `?`, and everything else literal.
 *
 * Small on purpose, so these cases are the whole of its behaviour rather than a sample of it.
 */

describe("globToRegExp", () => {
  it.each([
    ["drivers/**", "drivers/a.c", true],
    ["drivers/**", "drivers/can/deep/a.c", true],
    ["drivers/**", "drivers", false],
    ["drivers/**", "other/drivers/a.c", false],
    ["*.yml", "ci.yml", true],
    ["*.yml", "dir/ci.yml", false],
    ["**/Jenkinsfile", "Jenkinsfile", true],
    ["**/Jenkinsfile", "svc/api/Jenkinsfile", true],
    ["a/**/b.c", "a/b.c", true],
    ["a/**/b.c", "a/x/y/b.c", true],
    ["ci-?.yml", "ci-1.yml", true],
    ["ci-?.yml", "ci-12.yml", false],
    ["src/v1.2/*", "src/v1x2/a.c", false],
    ["src/v1.2/*", "src/v1.2/a.c", true],
    ["Jenkinsfile", "jenkinsfile", false],
    ["a+b(c)/[d]", "a+b(c)/[d]", true],
  ])("%s matches %s: %s", (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected);
  });
});

describe("GlobSet", () => {
  it("names the first glob that admits a path, and none for a path outside", () => {
    const set = new GlobSet(["docs/**", "drivers/can/**"]);

    expect(set.match("drivers/can/a.c")).toBe("drivers/can/**");
    expect(set.matches("drivers/spi/a.c")).toBe(false);
    expect(set.match("drivers/spi/a.c")).toBeUndefined();
  });

  it("matches nothing when empty", () => {
    expect(new GlobSet([]).matches("a.c")).toBe(false);
  });
});

describe("widenToScope", () => {
  it("widens a declared file to its directory, recursively", () => {
    expect(widenToScope(["drivers/can/telemetry_buf.c", "drivers/can/isr_fastpath.c"])).toEqual([
      "drivers/can/**",
    ]);
  });

  it("keeps a root-level file as itself rather than widening it to everything", () => {
    expect(widenToScope(["README.md"])).toEqual(["README.md"]);
  });

  it("keeps a declared glob as written, and drops blanks", () => {
    expect(widenToScope(["docs/**", "  ", "", "tests/*.c"])).toEqual(["docs/**", "tests/*.c"]);
  });

  it("is empty for an empty plan, which is 'no scope declared'", () => {
    expect(widenToScope([])).toEqual([]);
  });
});

describe("nearestGlob", () => {
  it("names the glob sharing the most leading segments with the path", () => {
    expect(nearestGlob("drivers/spi/bus.c", ["docs/**", "drivers/can/**"])).toBe("drivers/can/**");
  });

  it("is the first glob on a tie, so the answer is deterministic", () => {
    expect(nearestGlob("other/a.c", ["docs/**", "drivers/**"])).toBe("docs/**");
  });
});
