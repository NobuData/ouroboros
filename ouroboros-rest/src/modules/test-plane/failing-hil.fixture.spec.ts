import { CoverageParser } from "../test-results/coverage.parser";
import { parseFlakePolicy } from "../test-results/flake-policy";
import { HilParser } from "../test-results/hil.parser";
import { JunitParser } from "../test-results/junit.parser";
import { TestResultParserRegistry } from "../test-results/parser.registry";
import { assembleTree, type PreparedSuite } from "../test-results/tree";
import {
  BUILDS,
  HIL_SUITE,
  OVERSHOOT_CASE,
  RIG,
  SIM_SUITES,
  TOTAL_CASES,
  buildFiles,
  commitOf,
  expectedCounts,
  type BuildPlan,
} from "./failing-hil.fixture";

/**
 * The `failing-HIL` reports read as mockup 11 prints them (AT.6,
 * [#334](https://github.com/NobuData/ouroboros/issues/334)).
 *
 * Every number here is typed from the mockup, not computed from the fixture: the fixture is the
 * thing being checked. The reports go through the parsers the module registers, so a report the
 * parsers would read differently fails here, before any suite uploads it.
 */

const registry = new TestResultParserRegistry([
  new HilParser(),
  new CoverageParser(),
  new JunitParser(),
]);

/**
 * Parse one build's upload the way the ingest does.
 *
 * @param plan - The build.
 * @param index - Its position.
 * @returns The assembled tree.
 */
function parsed(plan: BuildPlan, index: number): PreparedSuite[] {
  const suites = buildFiles(plan, index).flatMap((file) => {
    const parser = registry.detect(file);
    if (parser === null) throw new Error(`nothing detects ${file.name}`);
    const output = parser.parse(file, { flakePolicy: parseFlakePolicy("retry-twice") });

    expect(output.warnings).toEqual([]);
    return output.suites;
  });

  return assembleTree(suites, parseFlakePolicy("retry-twice"));
}

/**
 * Count a tree's cases by status.
 *
 * @param tree - The tree.
 * @returns Total, passed and failed.
 */
function counted(tree: readonly PreparedSuite[]) {
  const cases = tree.flatMap((suite) => suite.cases);

  return {
    total: cases.length,
    passed: cases.filter((kase) => kase.status === "passed").length,
    failed: cases.filter((kase) => kase.status === "failed").length,
  };
}

describe("the failing-HIL reports", () => {
  it("have mockup 11's 63 cases across its five suites", () => {
    expect(TOTAL_CASES).toBe(63);

    const tree = parsed(BUILDS[1], 1);

    expect(tree.map((suite) => [suite.name, suite.platform, suite.cases.length])).toEqual([
      ["unit · drivers", "native_sim", 24],
      ["telemetry integration", "qemu_cortex_m3", 19],
      ["motor control", "qemu_cortex_m3", 12],
      ["OTA update", "native_sim", 6],
      [HIL_SUITE, `rig:${RIG}`, 2],
    ]);
    expect(SIM_SUITES).toHaveLength(4);
  });

  it.each([
    ["Build 1", 0, "a3f19c2", { total: 63, passed: 49, failed: 14 }],
    ["Build 2", 1, "c81d4e7", { total: 63, passed: 61, failed: 2 }],
    ["Build 3", 2, "f42b9a0", { total: 63, passed: 63, failed: 0 }],
  ] as const)("reads %s as the attempt card does", (label, index, sha, counts) => {
    const plan = BUILDS[index];

    expect(plan.label).toBe(label);
    expect(commitOf(plan)).toMatch(new RegExp(`^${sha}0{33}$`));
    expect(counted(parsed(plan, index))).toEqual(counts);
    expect(expectedCounts(plan)).toEqual(counts);
  });

  it("fails Build 2's overshoot at 2.4% against a 2.0% limit, and passes Build 3's", () => {
    const overshoot = (index: number) =>
      parsed(BUILDS[index], index)
        .flatMap((suite) => suite.cases)
        .find((kase) => kase.name === OVERSHOOT_CASE);

    expect(overshoot(1)).toMatchObject({ status: "failed" });
    expect(overshoot(1)?.hil?.measurements).toEqual([
      expect.objectContaining({
        metric: "overshoot_pct",
        value: 2.4,
        limitValue: 2,
        verdict: "fail",
      }),
    ]);
    expect(overshoot(2)).toMatchObject({ status: "passed" });
  });

  it("keeps each case's identity across builds, so its case_key is stable", () => {
    const names = (index: number) =>
      parsed(BUILDS[index], index).flatMap((suite) =>
        suite.cases.map((kase) => `${suite.name}/${kase.classname ?? ""}/${kase.name}`),
      );

    expect(names(0)).toEqual(names(1));
    expect(names(1)).toEqual(names(2));
  });

  it("uploads under names the built-in artifact globs collect", () => {
    expect(buildFiles(BUILDS[0], 0).map((file) => file.name)).toEqual([
      "junit-build1.xml",
      "ouro-hil-results.json",
    ]);
  });
});
