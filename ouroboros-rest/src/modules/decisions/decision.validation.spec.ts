import { SEEDED_PAYLOADS, SHIPPED_KINDS } from "./decision.kinds.fixture";
import type { DecisionRef } from "./decision.types";
import {
  DecisionPayloadValidator,
  MAX_DECISION_REFS,
  keyViolations,
  refViolations,
} from "./decision.validation";

/** Emission validation (#461): which fact is wrong, in a sentence, before anything is written. */

const RUN = "0a1b2c3d-0000-4000-8000-000000001851";
const PR = "0a1b2c3d-0000-4000-8000-000000000509";

describe("DecisionPayloadValidator", () => {
  const validator = new DecisionPayloadValidator();

  it.each(Object.keys(SHIPPED_KINDS))("accepts %s's seeded payload", (kindId) => {
    expect(validator.validate(SHIPPED_KINDS[kindId], SEEDED_PAYLOADS[kindId])).toEqual([]);
  });

  it("names a missing fact, an undeclared fact and a value outside an enum", () => {
    const { matrix_state: _matrix, ...rest } = SEEDED_PAYLOADS.merge_approval;

    expect(
      validator.validate(SHIPPED_KINDS.merge_approval, { ...rest, extra: 1, files: -1 }),
    ).toEqual(
      expect.arrayContaining([
        { field: "payload.matrix_state", message: "is a fact this kind's templates need, and it is missing." },
        { field: "payload.extra", message: "is not a fact this kind declares." },
        expect.objectContaining({ field: "payload.files" }),
      ]),
    );
    expect(
      validator.validate(SHIPPED_KINDS.fact_review, {
        ...SEEDED_PAYLOADS.fact_review,
        reason: "awaiting_review",
      }),
    ).toEqual([
      { field: "payload.reason", message: 'must be one of "awaiting review", "flagged stale".' },
    ]);
  });

  it("holds a pattern — spend in dollars and cents", () => {
    expect(
      validator.validate(SHIPPED_KINDS.spend_approval, { ...SEEDED_PAYLOADS.spend_approval, spent: "2.61" }),
    ).toEqual([expect.objectContaining({ field: "payload.spent" })]);
  });

  it("refuses a payload that is not an object", () => {
    expect(validator.validate(SHIPPED_KINDS.claim_waiver, [])).not.toEqual([]);
  });
});

describe("refViolations", () => {
  const run: DecisionRef = { type: "run", id: RUN, label: "loop #1851" };
  const pr: DecisionRef = { type: "pr", id: PR, label: "PR #509" };

  it("accepts the required refs, in any order", () => {
    expect(refViolations(SHIPPED_KINDS.merge_approval.refShape, [pr, run])).toEqual([]);
  });

  it("names a missing required ref and a ref the kind does not take", () => {
    expect(
      refViolations(SHIPPED_KINDS.merge_approval.refShape, [
        run,
        { type: "path", id: "boot/x.c", label: "boot/x.c" },
      ]),
    ).toEqual([
      { field: "refs[1]", message: "is a path ref, which this kind does not take." },
      { field: "refs", message: "must carry a pr ref." },
    ]);
  });

  it("refuses an id that is not a lower-case uuid, an absolute path, a blank label and a repeat", () => {
    const shape = { required: [], optional: ["run", "path"] as const, tags: [] };

    expect(
      refViolations({ ...shape, optional: [...shape.optional] }, [
        { type: "run", id: RUN.toUpperCase(), label: "loop" },
        { type: "path", id: "/etc/passwd", label: "x" },
        { type: "run", id: RUN, label: " " },
        { type: "run", id: RUN, label: "again" },
      ]),
    ).toEqual([
      { field: "refs[0]", message: "must name its row by lower-case uuid." },
      { field: "refs[1]", message: "must be a repository-relative path." },
      { field: "refs[2]", message: "needs a label — the tag's text." },
      { field: "refs[3]", message: "names a ref the row already carries." },
    ]);
  });

  it("caps a card's tag row", () => {
    const refs = Array.from({ length: MAX_DECISION_REFS + 1 }, (_, index) => ({
      type: "path" as const,
      id: `src/${String(index)}.c`,
      label: `${String(index)}`,
    }));

    expect(refViolations({ required: [], optional: ["path"], tags: [] }, refs)).toContainEqual({
      field: "refs",
      message: `holds at most ${String(MAX_DECISION_REFS)} refs.`,
    });
  });
});

describe("keyViolations", () => {
  it("accepts a plane slug and a trimmed source ref", () => {
    expect(keyViolations("pr.gates", `pr:${PR}`)).toEqual([]);
  });

  it("refuses a plane with a colon, a padded or blank source ref, and one past 500 characters", () => {
    expect(keyViolations("pr:gates", "x")).toHaveLength(1);
    expect(keyViolations("guardrails", " x")).toHaveLength(1);
    expect(keyViolations("guardrails", "")).toHaveLength(1);
    expect(keyViolations("guardrails", "x".repeat(501))).toHaveLength(1);
  });
});
