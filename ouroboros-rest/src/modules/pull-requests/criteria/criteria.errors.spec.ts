import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CRITERIA_ERRORS,
  criteriaOrderInvalid,
  criterionEvidenceRequired,
  criterionNotFound,
  criterionSourceInvalid,
  criterionWaived,
  criterionWaiverNeedsRun,
  evidenceNotFound,
  evidenceUnresolved,
  hunkOutsideSnapshot,
  planContextMissing,
  planCriteriaMissing,
  pullRequestNotFound,
} from "./criteria.errors";

/**
 * The criteria service's refusals (#359): every code is in `openapi.yaml`, which is the registry a
 * client reads, and each constructor answers the status its meaning is.
 */

/** The module root, as every error suite in this service resolves it. */
const MODULE_ROOT = join(__dirname, "..", "..", "..", "..");

const SPECIFICATION = readFileSync(join(MODULE_ROOT, "openapi.yaml"), "utf8");

describe("the codes", () => {
  it.each(Object.values(CRITERIA_ERRORS))("documents %s in openapi.yaml", (code) => {
    expect(SPECIFICATION).toContain(code);
  });

  it("has no duplicates, so a client cannot match one code to two meanings", () => {
    const codes = Object.values(CRITERIA_ERRORS);

    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("the statuses", () => {
  it.each([
    [pullRequestNotFound("p"), 404, "pull_request_not_found"],
    [criterionNotFound("p", "c"), 404, "criterion_not_found"],
    [evidenceNotFound("c", "e"), 404, "evidence_not_found"],
    [criterionSourceInvalid("extracted"), 422, "criterion_source_invalid"],
    [criteriaOrderInvalid(["a"], []), 422, "criteria_order_invalid"],
    [evidenceUnresolved("hunk", {}, "why"), 422, "evidence_unresolved"],
    [hunkOutsideSnapshot("r", "a.c"), 422, "hunk_outside_snapshot"],
    [criterionEvidenceRequired("c"), 409, "criterion_evidence_required"],
    [criterionWaived("c"), 409, "criterion_waived"],
    [criterionWaiverNeedsRun("p"), 409, "criterion_waiver_needs_run"],
    [planContextMissing("p", null), 409, "plan_context_missing"],
    [planCriteriaMissing("p", "d"), 409, "plan_criteria_missing"],
  ])("%# answers %i %s", (error, status, code) => {
    expect(error.getStatus()).toBe(status);
    expect(error.code).toBe(code);
  });

  it("says why an extracted claim and a plan claim are refused differently", () => {
    expect(criterionSourceInvalid("extracted").message).toMatch(/AZ\.2/);
    expect(criterionSourceInvalid("plan").message).toMatch(/plan import/);
  });

  it("carries the kind and the reference of a dangling citation", () => {
    expect(evidenceUnresolved("test_case", { caseKey: "k" }, "why").details).toEqual({
      kind: "test_case",
      reference: { caseKey: "k" },
    });
  });
});
