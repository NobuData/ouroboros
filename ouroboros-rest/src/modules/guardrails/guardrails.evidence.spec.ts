import { AWS_ACCESS_KEY_ID } from "./guardrails.fixture";
import { PATH_WITHHELD, safeEvidence } from "./guardrails.evidence";

/**
 * Evidence, screened against V048's constraints before it is written — so a refused row can
 * never refuse the change-set report it rides in, and a credential never reaches the database's
 * error log on its way to being refused.
 */

/** V048's no-opaque-token rule, as a predicate over every string in an evidence object. */
function storable(evidence: object | null): boolean {
  return Object.values(evidence ?? {}).every(
    (value) => typeof value !== "string" || !/[A-Za-z0-9+=]{20,}/.test(value),
  );
}

describe("safeEvidence", () => {
  it("keeps evidence that already has V048's shape", () => {
    const evidence = {
      path: "drivers/can/telemetry_buf.c",
      line: 214,
      rule_id: "aws-access-key-id",
      glob: "drivers/can/**",
      detail: "1 finding in 1 file.",
    };

    expect(safeEvidence(evidence)).toEqual(evidence);
  });

  it("withholds a path carrying an opaque token, and says why", () => {
    const evidence = safeEvidence({ path: `fixtures/${AWS_ACCESS_KEY_ID}.json`, line: 3 });

    expect(evidence).toEqual({ line: 3, detail: PATH_WITHHELD });
    expect(storable(evidence)).toBe(true);
  });

  it("withholds a detail or glob carrying an opaque token", () => {
    expect(
      safeEvidence({ detail: `stage ${AWS_ACCESS_KEY_ID}`, glob: `${AWS_ACCESS_KEY_ID}/**` }),
    ).toBeNull();
  });

  it.each([
    ["a rule id outside the grammar", { rule_id: "AWS_Key" }],
    ["a line that is not a positive whole number", { line: 0 }],
    ["a fractional line", { line: 1.5 }],
    ["an empty detail", { detail: "" }],
    ["an over-long glob", { glob: `${"a/".repeat(200)}**` }],
  ])("drops %s", (_name, evidence) => {
    expect(safeEvidence(evidence)).toBeNull();
  });

  it("withholds a padded path the same way, since V047 would never have admitted it", () => {
    expect(safeEvidence({ path: " a.c" })).toEqual({ detail: PATH_WITHHELD });
  });

  it("is null when there is nothing to show", () => {
    expect(safeEvidence({})).toBeNull();
  });
});
