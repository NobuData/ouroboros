import { CoverageParser } from "./coverage.parser";
import { parseFlakePolicy } from "./flake-policy";
import { HilParser } from "./hil.parser";
import { JunitParser } from "./junit.parser";
import { TestResultParserRegistry } from "./parser.registry";
import {
  EMPTY_OUTPUT,
  headOf,
  textOf,
  type NormalizedCase,
  type ParseOutput,
  type ResultFile,
  type TestResultParser,
} from "./parser.spi";
import { InMemoryTestResultsStore } from "./test-results.store.fixture";
import { TestResultIngestService } from "./test-results.service";
import { fixtureFile, textFile } from "./test-results.fixture";

/**
 * A TAP parser that exists only in this suite — **the SPI proof** (#329): a new format registers
 * by being handed to the registry, with no change to the registry, the orchestrator or the tree.
 */
class StubTapParser implements TestResultParser {
  readonly id = "tap";

  /** @inheritdoc */
  detect(file: ResultFile): boolean {
    return /^TAP version \d+/.test(headOf(file));
  }

  /** @inheritdoc */
  parse(file: ResultFile): ParseOutput {
    const cases: NormalizedCase[] = [];

    for (const line of textOf(file).split("\n")) {
      const match = /^(not ok|ok) \d+ - (.+?)(?: # (SKIP|RETRY FAILED))?$/.exec(line.trim());

      if (match === null) {
        continue;
      }
      const outcome = match[3] === "SKIP" ? "skipped" : match[1] === "ok" ? "passed" : "failed";
      const outcomes: NormalizedCase["outcomes"] =
        match[3] === "RETRY FAILED" ? ["failed", outcome] : [outcome];

      cases.push({
        name: match[2],
        classname: null,
        outcomes,
        durationMs: null,
        failure: null,
        meta: {},
      });
    }

    return {
      ...EMPTY_OUTPUT,
      suites: [
        {
          name: "tap",
          platform: "native_sim",
          kind: "sim",
          format: "junit",
          durationMs: null,
          meta: {},
          cases,
        },
      ],
    };
  }
}

const TAP = `TAP version 14
1..3
ok 1 - boots
not ok 2 - reads sensor
ok 3 - reconnects # RETRY FAILED
`;

describe("TestResultParserRegistry", () => {
  const builtIn = (): TestResultParser[] => [
    new HilParser(),
    new CoverageParser(),
    new JunitParser(),
  ];

  it("asks parsers in order and answers the first that detects", () => {
    const registry = new TestResultParserRegistry(builtIn());

    expect(registry.ids()).toEqual(["hil", "coverage", "junit"]);
    expect(registry.detect(fixtureFile("twister-reruns.xml"))?.id).toBe("junit");
    expect(registry.detect(fixtureFile("cobertura.xml"))?.id).toBe("coverage");
    expect(registry.detect(fixtureFile("lcov.info"))?.id).toBe("coverage");
    expect(registry.detect(fixtureFile("hil-valid.json"))?.id).toBe("hil");
    expect(registry.detect(fixtureFile("notes.txt"))).toBeNull();
    expect(registry.detect(textFile("report.tap", TAP))).toBeNull();
  });

  it("refuses two parsers with one id at construction", () => {
    expect(() => new TestResultParserRegistry([new JunitParser(), new JunitParser()])).toThrow(
      /two test result parsers are registered as "junit"/,
    );
  });

  it("registers a new format without any core change — the SPI proof", async () => {
    const registry = new TestResultParserRegistry([...builtIn(), new StubTapParser()]);
    const attempt = {
      id: "t1",
      organizationId: "org",
      runId: "r1",
      attemptSeq: 1,
      githubRepoId: "repo",
    };
    const store = new InMemoryTestResultsStore([attempt]);
    const service = new TestResultIngestService(registry, store);

    const report = await service.parseAttempt({
      organizationId: "org",
      testRunId: "t1",
      files: [textFile("report.tap", TAP), fixtureFile("pytest.xml")],
      flakePolicy: parseFlakePolicy("retry-once"),
    });

    expect(report.parsedBy).toEqual({ "report.tap": "tap", "pytest.xml": "junit" });
    expect(
      store.writes[0].suites.find((s) => s.name === "tap")?.cases.map((c) => c.status),
    ).toEqual(["passed", "failed", "flaky"]);
    expect(report.totals).toEqual({ total: 7, passed: 3, failed: 2, flaky: 1, skipped: 1 });
  });
});
