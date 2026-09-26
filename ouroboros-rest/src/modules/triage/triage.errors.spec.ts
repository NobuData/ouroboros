import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  TRIAGE_ERRORS,
  classificationNoteRequired,
  classificationToggleInvalid,
  rerunNothingSelected,
  rerunSourceMissing,
  testCaseNotFailing,
  testCaseNotFound,
  testRunNotFound,
  waiverCasesInvalid,
} from "./triage.errors";

/**
 * The routing service's refusals (#332): every code is in `openapi.yaml`, which is the registry a
 * client reads, and each constructor answers the status its meaning is.
 */

/** The module root, as every error suite in this service resolves it. */
const MODULE_ROOT = join(__dirname, "..", "..", "..");

const SPECIFICATION = readFileSync(join(MODULE_ROOT, "openapi.yaml"), "utf8");

describe("the codes", () => {
  it.each(Object.values(TRIAGE_ERRORS))("documents %s in openapi.yaml", (code) => {
    expect(SPECIFICATION).toContain(code);
  });

  it("has no duplicates, so a client cannot match one code to two meanings", () => {
    const codes = Object.values(TRIAGE_ERRORS);

    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("the statuses", () => {
  it.each([
    [testRunNotFound("t"), 404, "test_run_not_found"],
    [testCaseNotFound("t", "c"), 404, "test_case_not_found"],
    [testCaseNotFailing("c", "passed"), 409, "test_case_not_failing"],
    [classificationNoteRequired("product_bug"), 422, "classification_note_required"],
    [classificationToggleInvalid("requeue", "flake_retry"), 422, "classification_toggle_invalid"],
    [rerunNothingSelected("t", "failed"), 409, "rerun_nothing_selected"],
    [rerunSourceMissing("t"), 409, "rerun_source_missing"],
    [waiverCasesInvalid(["c"]), 422, "waiver_cases_invalid"],
  ])("%# answers %i %s", (error, status, code) => {
    expect(error.getStatus()).toBe(status);
    expect(error.code).toBe(code);
  });

  it("says what an empty re-run is empty of", () => {
    expect(rerunNothingSelected("t", "failed").message).toBe("Nothing failed in this test run.");
    expect(rerunNothingSelected("t", "full").message).toBe("This test run has no cases.");
  });
});
