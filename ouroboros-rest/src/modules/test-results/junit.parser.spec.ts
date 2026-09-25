import { JunitParser, LOG_EXCERPT_CHARS } from "./junit.parser";
import { textFile } from "./test-results.fixture";

/**
 * The JUnit parser's edges (#329) — what the fixture matrix does not already pin.
 */
describe("JunitParser", () => {
  const parser = new JunitParser();
  const parse = (xml: string) => parser.parse(textFile("report.xml", xml));

  it("detects testsuites and testsuite roots, and nothing else", () => {
    expect(parser.detect(textFile("a.xml", "<?xml version='1.0'?><testsuites/>"))).toBe(true);
    expect(parser.detect(textFile("a.xml", "<testsuite name='x'></testsuite>"))).toBe(true);
    expect(parser.detect(textFile("a.xml", "<coverage lines-valid='1'/>"))).toBe(false);
    expect(parser.detect(textFile("a.json", "{}"))).toBe(false);
  });

  it("splits a suite whose cases name different platforms", () => {
    const { suites } = parse(`<testsuite name="kernel">
      <testcase name="a"><properties><property name="platform" value="native_sim"/></properties></testcase>
      <testcase name="b"><properties><property name="platform" value="qemu_x86"/></properties></testcase>
    </testsuite>`);

    expect(suites.map((s) => [s.name, s.platform, s.cases.map((c) => c.name)])).toEqual([
      ["kernel", "native_sim", ["a"]],
      ["kernel", "qemu_x86", ["b"]],
    ]);
  });

  it("reads the platform from the suite attribute when there is no property", () => {
    const { suites, warnings } = parse(
      `<testsuite name="k" platform="nrf52840dk/nrf52840"><testcase name="a"/></testsuite>`,
    );

    expect(suites[0].platform).toBe("nrf52840dk_nrf52840");
    expect(warnings).toEqual([]);
  });

  it("makes a rig platform physical", () => {
    const { suites } = parse(
      `<testsuite name="hil"><properties><property name="platform" value="rig:helios-rig-02"/></properties><testcase name="a"/></testsuite>`,
    );

    expect(suites[0]).toMatchObject({
      platform: "rig:helios-rig-02",
      kind: "physical",
      format: "junit",
    });
  });

  it("reads nested suites as suites of their own", () => {
    const { suites } = parse(`<testsuites><testsuite name="outer" platform="native_sim">
      <testcase name="o"/>
      <testsuite name="inner" platform="native_sim"><testcase name="i"/></testsuite>
    </testsuite></testsuites>`);

    expect(suites.map((s) => [s.name, s.cases.map((c) => c.name)])).toEqual([
      ["inner", ["i"]],
      ["outer", ["o"]],
    ]);
  });

  it("caps the log excerpt, keeps the path and falls back to the body's first line", () => {
    const body = "boom\n" + "x".repeat(LOG_EXCERPT_CHARS * 2);
    const { suites } = parse(
      `<testsuite name="s" platform="native_sim"><testcase name="a" file="t.py" line="9"><failure>${body}</failure></testcase></testsuite>`,
    );
    const failure = suites[0].cases[0].failure;

    expect(failure?.message).toBe("boom");
    expect(failure?.path).toBe("t.py:9");
    expect(failure?.log_excerpt?.length).toBeLessThanOrEqual(LOG_EXCERPT_CHARS);
  });

  it("drops a case with no name and ignores a nonsense time", () => {
    const { suites } = parse(
      `<testsuite name="s" platform="native_sim"><testcase name=" "/><testcase name="a" time="soon"/></testsuite>`,
    );

    expect(suites[0].cases).toEqual([
      {
        name: "a",
        classname: null,
        outcomes: ["passed"],
        durationMs: null,
        failure: null,
        meta: {},
      },
    ]);
    expect(suites[0].durationMs).toBeNull();
  });

  it("returns nothing, and no warning, for a report with no suites", () => {
    expect(parse("<testsuites></testsuites>")).toEqual({ suites: [], coverage: [], warnings: [] });
  });

  it("never throws on garbage", () => {
    expect(() => parse("<testsuites><<<>>>")).not.toThrow();
    expect(parse("<testsuites><<<>>>").warnings[0].code).toBe("xml_malformed");
  });
});
