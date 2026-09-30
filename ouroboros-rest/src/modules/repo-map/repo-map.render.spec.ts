import type { RepoTree, RepoTreeEntry } from "../ticket-sources/ticket-source.probe";
import {
  MAX_CHILD_MODULES,
  MAX_TREE_ENTRIES,
  codeownersPath,
  modulesOf,
  ownersOf,
  parseCodeowners,
  patternMatcher,
  renderRepoMap,
  type RepoMapInput,
} from "./repo-map.render";

/**
 * The repo-map document (#415, K2): GitHub's CODEOWNERS semantics, bounded module listing, and —
 * the property diff-awareness rests on — byte-identical output for identical input.
 */

/**
 * A tree from paths; a trailing `/` makes a directory.
 *
 * @param paths - The paths.
 * @param truncated - Whether the host cut it.
 * @returns The tree.
 */
function tree(paths: readonly string[], truncated = false): RepoTree {
  const entries: RepoTreeEntry[] = paths.map((path) =>
    path.endsWith("/") ? { path: path.slice(0, -1), type: "dir" } : { path, type: "file" },
  );

  return { entries, truncated };
}

/** helios-firmware, as the map reads it. */
const HELIOS_TREE = tree([
  "app/",
  "app/src/",
  "app/src/main.c",
  "drivers/",
  "drivers/can/",
  "drivers/can/can.c",
  "drivers/i2c/",
  "drivers/i2c/i2c.c",
  "drivers/i2c/i2c.h",
  "tests/",
  "tests/hil/",
  "tests/hil/rig.py",
  ".github/",
  ".github/CODEOWNERS",
  "west.yml",
]);

const CODEOWNERS = [
  "# Default owners",
  "*                 @acme/firmware",
  "/drivers/         @acme/platform",
  "drivers/can/**    @acme/telemetry @maya",
  "tests/hil/        @acme/hil  # the rig",
  "*.md",
].join("\n");

/** The input the service would hand the render. */
const INPUT: RepoMapInput = {
  repo: "acme-robotics/helios-firmware",
  tree: HELIOS_TREE,
  codeowners: { path: ".github/CODEOWNERS", content: CODEOWNERS },
  detections: [
    { rowKey: "tests", verdict: "ok", value: "twister — 5 suites" },
    { rowKey: "build", verdict: "ok", value: "west + twister (found west.yml)" },
  ],
};

describe("CODEOWNERS", () => {
  it("is looked for where GitHub looks, first found wins", () => {
    expect(codeownersPath(HELIOS_TREE)).toBe(".github/CODEOWNERS");
    expect(codeownersPath(tree(["CODEOWNERS", "docs/CODEOWNERS"]))).toBe("CODEOWNERS");
    expect(codeownersPath(tree(["src/main.c"]))).toBeUndefined();
  });

  it("parses rules, skipping comments and blank lines, keeping an owner-less rule", () => {
    const rules = parseCodeowners(CODEOWNERS);

    expect(rules.map((rule) => [rule.pattern, rule.owners])).toEqual([
      ["*", ["@acme/firmware"]],
      ["/drivers/", ["@acme/platform"]],
      ["drivers/can/**", ["@acme/telemetry", "@maya"]],
      ["tests/hil/", ["@acme/hil"]],
      ["*.md", []],
    ]);
  });

  it.each([
    ["*", "anything/at/all", true],
    ["/drivers/", "drivers/can", true],
    ["/drivers/", "vendor/drivers/can", false],
    ["drivers/", "vendor/drivers/can", true],
    ["docs/*", "docs/guide.md", true],
    ["docs/*", "docs/deep/guide.md", false],
    ["*.c", "drivers/can/can.c", true],
    ["*.c", "drivers/can", false],
    ["drivers/can/**", "drivers/can/", true],
    ["**/logs", "deep/down/logs", true],
    ["a?c", "abc", true],
  ])("matches %s against %s → %s", (pattern, path, expected) => {
    expect(patternMatcher(pattern).test(path)).toBe(expected);
  });

  it("gives a directory the owners of the last rule matching it", () => {
    const rules = parseCodeowners(CODEOWNERS);

    expect(ownersOf("app", rules)).toEqual(["@acme/firmware"]);
    expect(ownersOf("drivers", rules)).toEqual(["@acme/platform"]);
    expect(ownersOf("drivers/can", rules)).toEqual(["@acme/telemetry", "@maya"]);
    expect(ownersOf("tests/hil", rules)).toEqual(["@acme/hil"]);
    expect(ownersOf("anything", [])).toEqual([]);
  });
});

describe("modules", () => {
  it("lists top-level directories and their children, counting files, hidden ones left out", () => {
    const { modules, truncated } = modulesOf(HELIOS_TREE, []);

    expect(modules.map((module) => [module.path, module.files])).toEqual([
      ["app/", 1],
      ["app/src/", 1],
      ["drivers/", 3],
      ["drivers/can/", 1],
      ["drivers/i2c/", 2],
      ["tests/", 1],
      ["tests/hil/", 1],
    ]);
    expect(truncated).toBe(false);
  });

  it("is bounded: children per directory, and entries read", () => {
    const wide = tree(
      Array.from({ length: MAX_CHILD_MODULES + 5 }, (_, index) => `lib/m${String(index)}/x.c`),
    );
    const { modules, truncated } = modulesOf(wide, []);

    expect(modules).toHaveLength(1 + MAX_CHILD_MODULES);
    expect(truncated).toBe(true);

    const huge: RepoTree = {
      entries: Array.from({ length: MAX_TREE_ENTRIES + 1 }, () => ({
        path: "src/a.c",
        type: "file" as const,
      })),
      truncated: false,
    };

    expect(modulesOf(huge, []).modules[0].files).toBe(MAX_TREE_ENTRIES);
    expect(modulesOf(huge, []).truncated).toBe(true);
  });

  it("says the host cut the listing short", () => {
    expect(modulesOf(tree(["src/a.c"], true), []).truncated).toBe(true);
  });
});

describe("the document", () => {
  it("renders modules, owners and detections as structured markdown", () => {
    const { body, modules } = renderRepoMap(INPUT);

    expect(modules).toBe(7);
    expect(body).toContain("# Repository map — acme-robotics/helios-firmware");
    expect(body).toContain("| `drivers/can/` | 1 | @acme/telemetry @maya |");
    expect(body).toContain("From `.github/CODEOWNERS` (5 rules)");
    // Detections sorted by key, so their stored order cannot move the document.
    expect(body.indexOf("| build |")).toBeLessThan(body.indexOf("| tests |"));
  });

  it("is byte-identical for identical input — no clock, sorted everywhere", () => {
    const reordered: RepoMapInput = {
      ...INPUT,
      tree: { ...HELIOS_TREE, entries: [...HELIOS_TREE.entries].reverse() },
      detections: [...INPUT.detections].reverse(),
    };

    expect(renderRepoMap(reordered).body).toBe(renderRepoMap(INPUT).body);
  });

  it("changes when the structure changes — a new module, or a changed owner", () => {
    const base = renderRepoMap(INPUT).body;
    const withModule = renderRepoMap({
      ...INPUT,
      tree: tree([...HELIOS_TREE.entries.map(pathOf), "subsys/telemetry/frame.c"]),
    }).body;
    const reowned = renderRepoMap({
      ...INPUT,
      codeowners: { path: ".github/CODEOWNERS", content: `${CODEOWNERS}\n/app/ @acme/apps` },
    }).body;

    expect(withModule).not.toBe(base);
    expect(reowned).not.toBe(base);
  });

  it("says so when there is no CODEOWNERS, no scan and no directory", () => {
    const { body, modules } = renderRepoMap({
      repo: "acme/empty",
      tree: tree([]),
      codeowners: null,
      detections: [],
    });

    expect(modules).toBe(0);
    expect(body).toContain("_No directories on the default branch._");
    expect(body).toContain("_No CODEOWNERS file");
    expect(body).toContain("_The repository has not been scanned._");
  });

  it("keeps a table row one row when a value carries a pipe or a newline", () => {
    const { body } = renderRepoMap({
      ...INPUT,
      detections: [{ rowKey: "custom:x", verdict: "warn", value: "a | b\nc" }],
    });

    expect(body).toContain("| custom:x | warn | a \\| b c |");
  });
});

/**
 * @param entry - A tree entry.
 * @returns Its path as {@link tree} takes it.
 */
function pathOf(entry: RepoTreeEntry): string {
  return entry.type === "dir" ? `${entry.path}/` : entry.path;
}
