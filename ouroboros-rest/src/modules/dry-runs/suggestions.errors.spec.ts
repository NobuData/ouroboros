import { HttpStatus } from "@nestjs/common";

import {
  DRY_RUN_SUGGESTION_ERRORS,
  suggestionConflict,
  suggestionNotApplicable,
  suggestionNotFound,
  suggestionResolved,
} from "./suggestions.errors";

describe("the suggestion errors", () => {
  it("answers a missing suggestion as a 404 naming what was asked for", () => {
    const missing = suggestionNotFound("s-1");

    expect(missing.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(missing.code).toBe(DRY_RUN_SUGGESTION_ERRORS.notFound);
    expect(missing.details).toEqual({ suggestionId: "s-1" });
  });

  it("answers a settled and an advisory suggestion as 409s", () => {
    const settled = suggestionResolved("s-1", "ignored");
    expect(settled.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(settled.message).toBe("This suggestion was already ignored.");
    expect(settled.details).toEqual({ suggestionId: "s-1", status: "ignored" });

    const advisory = suggestionNotApplicable("s-1");
    expect(advisory.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(advisory.code).toBe(DRY_RUN_SUGGESTION_ERRORS.notApplicable);
  });

  it("answers a moved-on draft as a 409 saying which operation no longer fits, and what to do", () => {
    const conflict = suggestionConflict("s-1", {
      operation: 1,
      kind: "remove_edge",
      reason: 'remove_edge: no edge "test" → "exploit-verify".',
      testedDraftRev: 3,
      draftRev: 5,
    });

    expect(conflict.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(conflict.code).toBe(DRY_RUN_SUGGESTION_ERRORS.conflict);
    expect(conflict.message).toBe(
      'The draft has changed since this suggestion was made, and it no longer fits: remove_edge: no edge "test" → "exploit-verify". Run the dry run again to get suggestions for the draft as it is now.',
    );
    expect(conflict.details).toEqual({
      suggestionId: "s-1",
      operation: 1,
      kind: "remove_edge",
      reason: 'remove_edge: no edge "test" → "exploit-verify".',
      testedDraftRev: 3,
      draftRev: 5,
    });
  });
});
