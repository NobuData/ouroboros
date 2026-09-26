import { HINT_MATRIX, QUIET } from "./triage.matrix.fixture";
import { HINT_RULES, INFRA_TAXONOMY, evaluateHints, overlappingPath } from "./triage.rules";

/**
 * The heuristic hints (#332, option 5-A): each rule firing and not firing, the precedence, and
 * the honesty property — a hint never carries a confidence.
 */
describe("the hint matrix", () => {
  it.each(HINT_MATRIX)("$name", ({ context, hint, fired }) => {
    const evaluation = evaluateHints(context);

    expect(evaluation.hint?.ruleId ?? null).toBe(hint);
    expect(evaluation.rules.filter((rule) => rule.fired).map((rule) => rule.ruleId)).toEqual(fired);
  });

  it("covers every rule both firing and not firing", () => {
    const outcomes = new Set(
      HINT_MATRIX.flatMap(({ context }) =>
        evaluateHints(context).rules.map((rule) => `${rule.ruleId}:${String(rule.fired)}`),
      ),
    );

    for (const rule of Object.values(HINT_RULES)) {
      expect(outcomes).toContain(`${rule}:true`);
      expect(outcomes).toContain(`${rule}:false`);
    }
  });

  it("matches every entry of the infra taxonomy at least once", () => {
    const texts = HINT_MATRIX.map(({ context }) =>
      [context.failure?.message, context.failure?.log_excerpt].filter(Boolean).join("\n"),
    );

    for (const entry of INFRA_TAXONOMY) {
      expect(texts.some((text) => entry.pattern.test(text))).toBe(true);
    }
  });
});

describe("every hint", () => {
  it.each(HINT_MATRIX.filter((row) => row.hint !== null))(
    "carries confidence: null, a rule id and the heuristic actor — $name",
    ({ context }) => {
      const { hint } = evaluateHints(context);

      expect(hint?.confidence).toBeNull();
      expect(hint?.actor).toBe("heuristic");
      expect(Object.values(HINT_RULES)).toContain(hint?.ruleId);
      expect(hint?.reason).toMatch(/\.$/);
    },
  );

  it("suggests the class its rule is named for", () => {
    const suggests = (status: "flaky" | "failed", overrides = {}) =>
      evaluateHints({ ...QUIET, status, ...overrides }).hint?.suggestedClass;

    expect(suggests("flaky", { retryOutcomes: ["failed", "passed"] })).toBe("flake_retry");
    expect(suggests("failed", { job: { status: "retried", runnerStatus: null } })).toBe(
      "infra_rig",
    );
    expect(
      suggests("failed", { previous: "passed", failure: { path: "drivers/can/telemetry_buf.c" } }),
    ).toBe("product_bug");
  });

  it("gives every rule's reason, including the ones that did not fire", () => {
    const { rules } = evaluateHints(QUIET);

    expect(rules.map((rule) => rule.ruleId)).toEqual([
      HINT_RULES.passOnRetry,
      HINT_RULES.rigError,
      HINT_RULES.newFailureInDiff,
    ]);
    expect(rules.every((rule) => rule.reason.length > 0)).toBe(true);
  });

  it("says which try passed", () => {
    const { hint } = evaluateHints({
      ...QUIET,
      status: "flaky",
      retryOutcomes: ["failed", "passed", "passed"],
    });

    expect(hint?.reason).toBe("Passed on retry 2 of 3.");
  });
});

describe("a path overlapping the diff", () => {
  it("prefers the exact file", () => {
    expect(overlappingPath("src/a.c", ["src/b.c", "src/a.c"])).toBe("src/a.c");
  });

  it("falls back to a file in the same directory", () => {
    expect(overlappingPath("src/a.c", ["lib/a.c", "src/b.c"])).toBe("src/b.c");
  });

  it("does not reach a parent or a sibling directory", () => {
    expect(overlappingPath("src/can/a.c", ["src/b.c", "src/usb/a.c"])).toBeUndefined();
  });
});
