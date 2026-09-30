import {
  anchorValueProblem,
  matchAnchor,
  parsePlatformVersion,
  pathGlobMatches,
  type ObservedChange,
} from "./facts.anchors";

/**
 * The staleness sweep's matchers (#411, K4). The glob cases are V071's own
 * `path_glob_matches` probes (`ouroboros-db/tests/constraints.sql`), so the TypeScript port and the
 * SQL function answer alike.
 */

/** The mockup's Zephyr 4.0 → 4.1 move, as `diffExcerptOf` samples a west.yml patch. */
const ZEPHYR_BUMP = [
  "--- west.yml",
  "@@ -10,7 +10,7 @@ manifest:",
  "     - name: zephyr",
  "       remote: zephyrproject-rtos",
  "-      revision: v4.0.0",
  "+      revision: v4.1.0",
  "       import: true",
].join("\n");

/**
 * @param paths - Changed paths.
 * @param diffExcerpt - The sample, or null.
 * @returns A change.
 */
function change(paths: string[], diffExcerpt: string | null = null): ObservedChange {
  return { paths, diffExcerpt };
}

describe("path_glob_matches, in TypeScript", () => {
  it.each([
    ["tests/hil/**", "tests/hil/rig/claim_test.py", true],
    ["tests/hil/**", "tests/hil/a.c", true],
    ["tests/hil/**", "tests/unit/a.c", false],
    ["config/*.yaml", "config/control.yaml", true],
    ["config/*.yaml", "config/sub/control.yaml", false],
    ["**/Kconfig", "Kconfig", true],
    ["**/Kconfig", "boards/arm/Kconfig", true],
    ["**/Kconfig", "boards/arm/Kconfig.defconfig", false],
    ["src/?.c", "src/a.c", true],
    ["src/?.c", "src/ab.c", false],
    ["west.yml", "west.yml", true],
    ["west.yml", "westxyml", false],
    ["a+b(c)/[x].h", "a+b(c)/[x].h", true],
  ])("%s against %s is %s", (glob, path, expected) => {
    expect(pathGlobMatches(glob, path)).toBe(expected);
  });
});

describe("a path_glob anchor", () => {
  it("fires on a changed path the glob matches", () => {
    expect(
      matchAnchor(
        { kind: "path_glob", value: "tests/hil/**" },
        change(["src/a.c", "tests/hil/x.py"]),
      ),
    ).toEqual({ path: "tests/hil/x.py", evidence: "changed tests/hil/x.py" });
  });

  it("does not fire on a change that matches nothing", () => {
    expect(
      matchAnchor({ kind: "path_glob", value: "tests/hil/**" }, change(["tests/unit/a.c"])),
    ).toBeNull();
  });
});

describe("a dependency anchor", () => {
  const MCUBOOT = [
    "--- west.yml",
    "@@ -20,3 +20,3 @@",
    "     - name: mcuboot",
    "-      revision: v2.0.0",
    "+      revision: v2.1.0",
  ].join("\n");

  it("fires when a manifest's changed line names the dependency", () => {
    const hit = matchAnchor(
      { kind: "dependency", value: "zephyr" },
      change(
        ["west.yml"],
        ["--- west.yml", "@@ -1,1 +1,1 @@", "-  - name: zephyr", "+  - name: zephyr-fork"].join(
          "\n",
        ),
      ),
    );

    expect(hit).toEqual({ path: "west.yml", evidence: 'removed "- name: zephyr" in west.yml' });
  });

  it("does not fire when only context lines name it", () => {
    expect(
      matchAnchor({ kind: "dependency", value: "mcuboot" }, change(["west.yml"], MCUBOOT)),
    ).toBeNull();
  });

  it("does not fire when the manifest's patch never names it", () => {
    expect(
      matchAnchor({ kind: "dependency", value: "west" }, change(["west.yml"], MCUBOOT)),
    ).toBeNull();
  });

  it("does not take a longer name for it", () => {
    const sample = ["--- package.json", "@@ -1,1 +1,1 @@", '+    "lodash-es": "^4.17.21",'].join(
      "\n",
    );

    expect(
      matchAnchor({ kind: "dependency", value: "lodash" }, change(["package.json"], sample)),
    ).toBeNull();
    expect(
      matchAnchor({ kind: "dependency", value: "lodash-es" }, change(["package.json"], sample)),
    ).not.toBeNull();
  });

  it("fires on a changed manifest whose patch the sample does not hold", () => {
    expect(
      matchAnchor({ kind: "dependency", value: "serde" }, change(["crates/core/Cargo.toml"])),
    ).toEqual({
      path: "crates/core/Cargo.toml",
      evidence: "changed crates/core/Cargo.toml (no patch text to read)",
    });
  });

  it("ignores files that are not manifests", () => {
    expect(matchAnchor({ kind: "dependency", value: "west" }, change(["src/west.c"]))).toBeNull();
  });
});

describe("a platform_version anchor", () => {
  it("fires on the Zephyr 4.0 → 4.1 bump, recording the removed pin", () => {
    expect(
      matchAnchor(
        { kind: "platform_version", value: "zephyr-4.0" },
        change(["west.yml"], ZEPHYR_BUMP),
      ),
    ).toEqual({ path: "west.yml", evidence: 'removed "revision: v4.0.0" in west.yml' });
  });

  it("does not fire for the version the repository moved to", () => {
    expect(
      matchAnchor(
        { kind: "platform_version", value: "zephyr-4.1" },
        change(["west.yml"], ZEPHYR_BUMP),
      ),
    ).toBeNull();
  });

  it("does not fire for another platform's version", () => {
    expect(
      matchAnchor(
        { kind: "platform_version", value: "node-4.0" },
        change(["west.yml"], ZEPHYR_BUMP),
      ),
    ).toBeNull();
  });

  it("does not take 14.0 or 4.01 for 4.0", () => {
    const sample = [
      "--- west.yml",
      "@@ -1,2 +1,2 @@",
      "  - name: zephyr",
      "-    revision: v14.0.0",
      "-    revision: v4.01",
    ].join("\n");

    expect(
      matchAnchor({ kind: "platform_version", value: "zephyr-4.0" }, change(["west.yml"], sample)),
    ).toBeNull();
  });

  it("does not fire when the version is re-added (a line moved)", () => {
    const sample = [
      "--- west.yml",
      "@@ -1,2 +1,2 @@",
      "   - name: zephyr",
      "-      revision: v4.0.0 # pinned",
      "+      revision: v4.0.0",
    ].join("\n");

    expect(
      matchAnchor({ kind: "platform_version", value: "zephyr-4.0" }, change(["west.yml"], sample)),
    ).toBeNull();
  });

  it("fires on a changed marker whose patch the sample does not hold", () => {
    expect(matchAnchor({ kind: "platform_version", value: "node-20" }, change([".nvmrc"]))).toEqual(
      { path: ".nvmrc", evidence: "changed .nvmrc (no patch text to read)" },
    );
  });

  it("fires on a marker named for the platform with a bare value", () => {
    const sample = [
      "--- zephyr/VERSION",
      "@@ -1,1 +1,1 @@",
      "-VERSION_MINOR = 0",
      "+VERSION_MINOR = 1",
    ].join("\n");

    expect(
      matchAnchor(
        { kind: "platform_version", value: "zephyr" },
        change(["zephyr/VERSION"], sample),
      ),
    ).toEqual({ path: "zephyr/VERSION", evidence: "changed zephyr/VERSION, which names zephyr" });
  });

  it("ignores files that are not markers", () => {
    expect(
      matchAnchor(
        { kind: "platform_version", value: "zephyr-4.0" },
        change(["docs/zephyr-4.0.md"]),
      ),
    ).toBeNull();
  });

  it.each([
    ["zephyr-4.0", { platform: "zephyr", version: "4.0" }],
    ["node@20", { platform: "node", version: "20" }],
    ["python 3.12", { platform: "python", version: "3.12" }],
    ["zephyr-v4.1.2", { platform: "zephyr", version: "4.1.2" }],
    ["zephyr", { platform: "zephyr", version: null }],
  ])("reads %s as a platform and version", (value, parsed) => {
    expect(parsePlatformVersion(value)).toEqual(parsed);
  });
});

describe("an anchor value's shape", () => {
  it.each([
    ["path_glob", "tests/hil/**", null],
    ["path_glob", "/etc/passwd", /repository-relative/],
    ["path_glob", "src\\a.c", /forward-slashed/],
    ["path_glob", "../outside/**", /\.\. segment/],
    ["path_glob", "a/../b", /\.\. segment/],
    ["dependency", "../is-a-name", null],
    ["dependency", "", /needs a value/],
    ["dependency", "x".repeat(513), /at most 512/],
    ["platform_version", "zephyr\t4.0", /control characters/],
  ] as const)("%s %j → %s", (kind, value, problem) => {
    const answer = anchorValueProblem(kind, value);

    if (problem === null) {
      expect(answer).toBeNull();
    } else {
      expect(answer).toMatch(problem);
    }
  });
});
