import { HttpStatus } from "@nestjs/common";

import { InvalidRequestError } from "../errors/error.envelope";
import {
  ALIAS_FIELD,
  IMPORT_ERRORS,
  IMPORT_MESSAGES,
  MODEL_ID_FIELD,
  importInvalid,
  type BatchProblems,
} from "./import.errors";

/**
 * The one refusal bulk import has ([#587](https://github.com/NobuData/ouroboros/issues/587)).
 *
 * Three things are asserted, and each is a promise the ticket makes rather than a property of
 * the code: the status and the code are the ones documented beside the operation; the message
 * says **nothing was created**, because *partial creation is worse than none* is only a
 * guarantee if the answer states it; and the details are keyed so #594 can mark a row.
 */

const PROBLEMS: BatchProblems = {
  "0": { [ALIAS_FIELD]: [IMPORT_MESSAGES.nameTaken] },
  "2": { [MODEL_ID_FIELD]: [IMPORT_MESSAGES.notDiscovered] },
};

describe("the import refusal", () => {
  it("is a 422 carrying the documented code", () => {
    const error = importInvalid(PROBLEMS);

    expect(error).toBeInstanceOf(InvalidRequestError);
    expect(error.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(error.code).toBe(IMPORT_ERRORS.invalid);
  });

  it("says that nothing was created", () => {
    // The sentence is the contract's, not decoration: an operator reading this has to know
    // whether to go and clean up seven aliases before trying again.
    expect(importInvalid(PROBLEMS).message).toContain("Nothing was created");
  });

  it("points at where the itemized list is", () => {
    expect(importInvalid(PROBLEMS).message).toContain("details.items");
  });

  it("carries every item's complaints, keyed by its position in the request", () => {
    // The index and not the model id: a batch may legally name one model twice, and that is
    // itself one of the things complained about here — so the model id is not a key.
    expect(importInvalid(PROBLEMS).details).toEqual({ items: PROBLEMS });
  });

  it("names no constraint, table or driver in any message it can produce", () => {
    // `docs/ARCHITECTURE.md` § 5.3. Every sentence this surface can answer with is here, so
    // this is the whole set rather than a sample.
    for (const message of Object.values(IMPORT_MESSAGES)) {
      expect(message).not.toMatch(/constraint|violates|pg_|ouroboros\./i);
      expect(message).toMatch(/[.!]$/);
    }
  });

  it("sends somebody somewhere in the message about an undiscovered model", () => {
    // Decision R7's refusal is the one a person is most likely to meet and least likely to
    // understand — they typed nothing, they ticked a row — so it has to say what to do.
    expect(IMPORT_MESSAGES.notDiscovered).toContain("Providers & keys");
  });

  it("refuses to describe a refusal that did not happen", () => {
    expect(() => importInvalid({})).toThrow(RangeError);
  });
});
