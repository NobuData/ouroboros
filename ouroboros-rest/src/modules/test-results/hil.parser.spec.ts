import { HilParser, hilVerdict } from "./hil.parser";
import { textFile } from "./test-results.fixture";

/**
 * The HIL parser's edges (#329) — what the fixture matrix does not already pin.
 */
describe("HilParser", () => {
  const parser = new HilParser();
  const doc = (measurement: string): string =>
    `{"schema":"ouro-hil-results","schema_version":1,"rig":"r1","suites":[{"name":"s","cases":[
      {"name":"c","procedure":"p","measurements":[${measurement},
        {"metric":"ok_ms","value":1,"unit":"ms","limit":2,"direction":"max"}]}]}]}`;

  it("detects by name or by a head that names the schema", () => {
    expect(parser.detect(textFile("rig/ouro-hil-results.json", "{}"))).toBe(true);
    expect(parser.detect(textFile("x.json", '{ "schema" : "ouro-hil-results" }'))).toBe(true);
    expect(parser.detect(textFile("x.json", '{"schema":"other"}'))).toBe(false);
  });

  it("drops a measurement whose number is not finite, keeping its siblings", () => {
    const { suites, warnings } = parser.parse(
      textFile(
        "h.json",
        doc('{"metric":"huge","value":1e400,"unit":"ms","limit":2,"direction":"max"}'),
      ),
    );

    expect(warnings).toEqual([
      expect.objectContaining({
        code: "hil_measurement_incomplete",
        at: "/suites/0/cases/0/measurements/0",
      }),
    ]);
    expect(suites[0].cases[0].hil?.measurements.map((m) => m.metric)).toEqual(["ok_ms"]);
  });

  it("refuses a JSON document of another kind whole", () => {
    expect(parser.parse(textFile("h.json", '{"schema":"other"}')).warnings[0]).toMatchObject({
      code: "hil_schema_invalid",
      at: "/schema",
    });
    expect(parser.parse(textFile("h.json", "[1, 2]")).warnings[0].code).toBe("hil_schema_invalid");
  });

  it("takes the rig's own status over the measurements' verdicts", () => {
    const text = doc('{"metric":"x_ms","value":9,"unit":"ms","limit":2,"direction":"max"}').replace(
      '"procedure":"p"',
      '"procedure":"p","status":"skipped"',
    );

    expect(parser.parse(textFile("h.json", text)).suites[0].cases[0].outcomes).toEqual(["skipped"]);
  });

  it("computes the verdict inclusively in both directions, as hil_verdict() does", () => {
    expect(hilVerdict(2, 2, "max")).toBe("pass");
    expect(hilVerdict(2.01, 2, "max")).toBe("fail");
    expect(hilVerdict(95, 95, "min")).toBe("pass");
    expect(hilVerdict(94.9, 95, "min")).toBe("fail");
  });
});
