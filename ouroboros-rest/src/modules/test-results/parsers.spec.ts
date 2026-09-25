import { GoldenFile } from "../../testing/golden.fixture";
import { CoverageParser } from "./coverage.parser";
import { parseFlakePolicy } from "./flake-policy";
import { HilParser } from "./hil.parser";
import { JunitParser } from "./junit.parser";
import { TestResultParserRegistry } from "./parser.registry";
import { PARSE_WARNING_CODES, type ParseOutput } from "./parser.spi";
import { GOLDEN_PATH, MATRIX, REGENERATE, fixtureFile } from "./test-results.fixture";
import { assembleTree } from "./tree";

/**
 * The fixture matrix parses to golden trees (AT.1, [#329](https://github.com/NobuData/ouroboros/issues/329)).
 *
 * Every fixture is detected by the registry the module builds, parsed, and assembled under the
 * `retry-twice` policy; the output and the tree are held to `fixtures/golden.json`. A change that
 * moves any count, platform, retry, measurement or warning fails here naming the fixture.
 */
describe("the parser fixture matrix", () => {
  const registry = new TestResultParserRegistry([
    new HilParser(),
    new CoverageParser(),
    new JunitParser(),
  ]);
  const policy = parseFlakePolicy("retry-twice");
  const golden = new GoldenFile(
    GOLDEN_PATH,
    `Every fixture's parse output and its tree under retry-twice. Regenerate with: ${REGENERATE}`,
    REGENERATE,
  );
  const outputs = new Map<string, ParseOutput>();

  afterAll(() => {
    golden.save();
  });

  it.each(Object.entries(MATRIX))("%s parses to its golden tree", (label, name) => {
    const file = fixtureFile(name);
    const parser = registry.detect(file);
    const output = parser === null ? null : parser.parse(file, { flakePolicy: policy });

    if (output !== null) {
      outputs.set(label, output);
    }
    golden.hold(label, {
      parser: parser?.id ?? null,
      output,
      tree: output === null ? null : assembleTree(output.suites, policy),
    });
  });

  it("covers every warning code but format_unrecognized, which only the orchestrator raises", () => {
    const raised = new Set(
      [...outputs.values()].flatMap((output) => output.warnings.map((w) => w.code)),
    );

    expect(PARSE_WARNING_CODES.filter((code) => !raised.has(code))).toEqual([
      "format_unrecognized",
    ]);
  });

  it("keeps partial results beside every warning of a truncated report", () => {
    const output = outputs.get("truncatedXml") as ParseOutput;

    expect(output.warnings.map((w) => w.code)).toEqual(["xml_truncated"]);
    expect(output.suites[0].cases).toHaveLength(4);
  });
});
