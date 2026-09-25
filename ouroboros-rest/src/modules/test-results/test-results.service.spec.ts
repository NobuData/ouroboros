import { NotFoundError } from "../errors/error.envelope";
import { CoverageParser } from "./coverage.parser";
import { parseFlakePolicy } from "./flake-policy";
import { HilParser } from "./hil.parser";
import { JunitParser } from "./junit.parser";
import { TestResultParserRegistry } from "./parser.registry";
import { PARSE_WARNING_CODES } from "./parser.spi";
import { MATRIX, fixtureFile } from "./test-results.fixture";
import { InMemoryTestResultsStore } from "./test-results.store.fixture";
import {
  TEST_RUN_NOT_FOUND,
  TestResultIngestService,
  roundTenth,
  summarizeCoverage,
} from "./test-results.service";

const ATTEMPT = {
  id: "t3",
  organizationId: "org",
  runId: "r",
  attemptSeq: 3,
  githubRepoId: "repo",
};

/**
 * A service over the built-in parsers and an in-memory store.
 *
 * @param prior - The prior coverage the store answers for {@link ATTEMPT}.
 * @returns The service and its store.
 */
function harness(prior?: { attemptSeq: number; linesCovered: number; linesTotal: number }) {
  const store = new InMemoryTestResultsStore([ATTEMPT], prior === undefined ? {} : { t3: prior });
  const registry = new TestResultParserRegistry([
    new HilParser(),
    new CoverageParser(),
    new JunitParser(),
  ]);

  return { store, service: new TestResultIngestService(registry, store) };
}

describe("TestResultIngestService.parseAttempt", () => {
  it("refuses an attempt the workspace does not have", async () => {
    const { service } = harness();
    const parse = service.parseAttempt({ organizationId: "other", testRunId: "t3", files: [] });

    await expect(parse).rejects.toBeInstanceOf(NotFoundError);
    await expect(parse).rejects.toMatchObject({ code: TEST_RUN_NOT_FOUND });
  });

  it("parses the whole matrix as one upload set, keeping every warning with its file", async () => {
    const { service, store } = harness();
    const report = await service.parseAttempt({
      organizationId: "org",
      testRunId: "t3",
      files: Object.values(MATRIX).map(fixtureFile),
      flakePolicy: parseFlakePolicy("retry-twice"),
    });

    expect(report.parsedBy["notes.txt"]).toBeNull();
    expect(report.warnings.filter((w) => w.code === "format_unrecognized")).toEqual([
      expect.objectContaining({ file: "notes.txt" }),
    ]);
    expect(store.writes[0].warnings).toBe(report.warnings);
    expect(new Set(report.warnings.map((w) => w.code))).toEqual(new Set(PARSE_WARNING_CODES));
  });

  it("merges a rig's JUnit and HIL reports into one measured suite", async () => {
    const { service, store } = harness();

    await service.parseAttempt({
      organizationId: "org",
      testRunId: "t3",
      files: [fixtureFile("twister-reruns.xml"), fixtureFile("hil-valid.json")],
    });

    const rig = store.writes[0].suites.find((s) => s.platform === "rig:helios-rig-02");

    expect(rig).toMatchObject({ format: "hil", kind: "physical", durationMs: 132_000 });
    expect(
      rig?.cases.map((c) => [c.name, c.status, c.hil?.measurements.map((m) => m.verdict)]),
    ).toEqual([
      ["estop_release_overshoot", "failed", ["fail"]],
      ["bus_flood_frame_order", "passed", ["pass"]],
      ["brownout_recovery", "passed", ["pass", "pass"]],
    ]);
  });

  it("defaults to no sanctioned retries, so nothing is flaky", async () => {
    const { service } = harness();
    const report = await service.parseAttempt({
      organizationId: "org",
      testRunId: "t3",
      files: [fixtureFile("twister-reruns.xml")],
    });

    expect(report.totals).toMatchObject({ flaky: 0, failed: 7 });
  });

  it("stores the wall-time split the suites give", async () => {
    const { service, store } = harness();
    const report = await service.parseAttempt({
      organizationId: "org",
      testRunId: "t3",
      files: [fixtureFile("twister-reruns.xml")],
    });

    expect(report.split).toEqual({ wallMs: 155_800, simMs: 23_800, physicalMs: 132_000 });
    expect(store.writes[0].split).toEqual(report.split);
  });

  it("reports coverage with no delta when there is no prior attempt", async () => {
    const { service } = harness();
    const report = await service.parseAttempt({
      organizationId: "org",
      testRunId: "t3",
      files: [fixtureFile("cobertura.xml")],
    });

    expect(report.coverage).toEqual({
      linesCovered: 874,
      linesTotal: 1000,
      percent: 87.4,
      files: [{ file: "cobertura.xml", linesCovered: 874, linesTotal: 1000 }],
    });
    expect(report.coverage).not.toHaveProperty("delta");
  });

  it("reports the delta against the prior attempt with coverage", async () => {
    const { service } = harness({ attemptSeq: 2, linesCovered: 868, linesTotal: 1000 });
    const report = await service.parseAttempt({
      organizationId: "org",
      testRunId: "t3",
      files: [fixtureFile("cobertura.xml")],
    });

    expect(report.coverage).toMatchObject({ percent: 87.4, delta: 0.6, previousAttemptSeq: 2 });
  });

  it("has no coverage at all when no report was readable", async () => {
    const { service } = harness({ attemptSeq: 2, linesCovered: 1, linesTotal: 2 });
    const report = await service.parseAttempt({
      organizationId: "org",
      testRunId: "t3",
      files: [fixtureFile("lcov-empty.info")],
    });

    expect(report).not.toHaveProperty("coverage");
    expect(report.warnings.map((w) => w.code)).toEqual(["coverage_unreadable"]);
  });
});

describe("summarizeCoverage", () => {
  it("sums reports and rounds the delta once, from the unrounded ratios", () => {
    const summary = summarizeCoverage(
      [
        { file: "a", linesCovered: 1, linesTotal: 3 },
        { file: "b", linesCovered: 1, linesTotal: 3 },
      ],
      { attemptSeq: 1, linesCovered: 2, linesTotal: 3 },
    );

    // 33.33…% vs 66.66…%: each rounds to .3/.7, but the delta is -33.3, not -33.4.
    expect(summary).toMatchObject({ linesCovered: 2, linesTotal: 6, percent: 33.3, delta: -33.3 });
  });

  it("reports a zero delta as zero, and absent only when there is no prior", () => {
    const files = [{ file: "a", linesCovered: 1, linesTotal: 2 }];

    expect(summarizeCoverage(files, { attemptSeq: 1, linesCovered: 1, linesTotal: 2 }).delta).toBe(
      0,
    );
    expect(summarizeCoverage(files, undefined).delta).toBeUndefined();
  });
});

describe("roundTenth", () => {
  it.each([
    [87.45, 87.5],
    [87.44999, 87.4],
    [-0.05, -0.1],
    [0.04, 0],
    [-0.04, 0],
    [100, 100],
  ])("rounds %d half away from zero to %d, as PostgreSQL does", (value, rounded) => {
    expect(roundTenth(value)).toBe(rounded);
  });
});
