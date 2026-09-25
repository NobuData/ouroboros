import { NO_RETRIES, parseFlakePolicy } from "./flake-policy";
import type { NormalizedCase, NormalizedSuite } from "./parser.spi";
import { assembleTree, durationSplit } from "./tree";

/** A JUnit case. */
function junitCase(
  name: string,
  outcomes: NormalizedCase["outcomes"],
  classname: string | null = "c",
): NormalizedCase {
  return { name, classname, outcomes, durationMs: 10, failure: null, meta: {} };
}

/** A suite. */
function suite(overrides: Partial<NormalizedSuite>): NormalizedSuite {
  return {
    name: "s",
    platform: "native_sim",
    kind: "sim",
    format: "junit",
    durationMs: 100,
    meta: {},
    cases: [],
    ...overrides,
  };
}

const HIL = { procedure: "dyno", measurements: [] };

describe("assembleTree", () => {
  it("marks a pass-on-retry flaky only under a policy that sanctioned it (T5)", () => {
    const input = [suite({ cases: [junitCase("a", ["failed", "passed"])] })];

    expect(assembleTree(input, parseFlakePolicy("retry-once"))[0].cases[0].status).toBe("flaky");

    const unsanctioned = assembleTree(input, NO_RETRIES)[0].cases[0];

    expect(unsanctioned).toMatchObject({
      status: "failed",
      retries: 0,
      outcomes: ["failed"],
      meta: { unsanctioned_outcomes: ["passed"] },
    });
  });

  it("merges two JUnit reports of one suite into successive attempts", () => {
    const tree = assembleTree(
      [
        suite({ cases: [junitCase("a", ["failed"])] }),
        suite({ cases: [junitCase("a", ["passed"]), junitCase("b", ["passed"])] }),
      ],
      parseFlakePolicy("retry-once"),
    );

    expect(tree).toHaveLength(1);
    expect(tree[0].durationMs).toBe(200);
    expect(tree[0].cases.map((c) => [c.name, c.status, c.outcomes])).toEqual([
      ["a", "flaky", ["failed", "passed"]],
      ["b", "passed", ["passed"]],
    ]);
  });

  it("keeps suites on different platforms apart", () => {
    const tree = assembleTree(
      [suite({ platform: "native_sim" }), suite({ platform: "qemu_x86" })],
      NO_RETRIES,
    );

    expect(tree.map((s) => s.platform)).toEqual(["native_sim", "qemu_x86"]);
  });

  it("gives a rig's JUnit cases their HIL measurements, keeping JUnit's retry truth", () => {
    const rig = { platform: "rig:r", kind: "physical" as const };
    const tree = assembleTree(
      [
        suite({
          ...rig,
          durationMs: 5,
          cases: [junitCase("m", ["failed", "passed"]), junitCase("n", ["passed"])],
        }),
        suite({
          ...rig,
          format: "hil",
          durationMs: 999,
          meta: { bench: "b" },
          cases: [
            { ...junitCase("m", ["failed"]), hil: HIL },
            { ...junitCase("n", ["passed"], null), hil: HIL },
            { ...junitCase("only-hil", ["passed"]), hil: HIL },
          ],
        }),
      ],
      parseFlakePolicy("retry-once"),
    );

    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ format: "hil", durationMs: 5, meta: { bench: "b" } });
    expect(tree[0].cases.map((c) => [c.name, c.status, c.hil !== undefined])).toEqual([
      ["m", "flaky", true],
      ["n", "passed", true],
      ["only-hil", "passed", true],
    ]);
  });

  it("does not match a classname-less HIL case to an ambiguous name", () => {
    const rig = { platform: "rig:r", kind: "physical" as const };
    const tree = assembleTree(
      [
        suite({
          ...rig,
          cases: [junitCase("m", ["passed"], "x"), junitCase("m", ["passed"], "y")],
        }),
        suite({
          ...rig,
          format: "hil",
          cases: [{ ...junitCase("m", ["passed"], null), hil: HIL }],
        }),
      ],
      NO_RETRIES,
    );

    expect(tree[0].cases.map((c) => [c.classname, c.hil !== undefined])).toEqual([
      ["x", false],
      ["y", false],
      [null, true],
    ]);
  });

  it("clears the failure payload of a passed case", () => {
    const failing = { ...junitCase("a", ["failed", "passed"]), failure: { message: "m" } };

    expect(
      assembleTree([suite({ cases: [failing] })], parseFlakePolicy("retry-once"))[0].cases[0]
        .failure,
    ).toEqual({ message: "m" });
    expect(
      assembleTree([suite({ cases: [{ ...failing, outcomes: ["passed"] }] })], NO_RETRIES)[0]
        .cases[0].failure,
    ).toBeNull();
  });
});

describe("durationSplit", () => {
  it("sums sim and physical suites so wall = sim + physical", () => {
    const tree = assembleTree(
      [
        suite({ name: "a", durationMs: 240_000 }),
        suite({ name: "b", durationMs: null }),
        suite({ name: "r", platform: "rig:r", kind: "physical", durationMs: 132_000 }),
      ],
      NO_RETRIES,
    );

    expect(durationSplit(tree)).toEqual({ wallMs: 372_000, simMs: 240_000, physicalMs: 132_000 });
  });

  it("is all null when no suite has a duration", () => {
    expect(durationSplit(assembleTree([suite({ durationMs: null })], NO_RETRIES))).toEqual({
      wallMs: null,
      simMs: null,
      physicalMs: null,
    });
    expect(durationSplit([])).toEqual({ wallMs: null, simMs: null, physicalMs: null });
  });
});
