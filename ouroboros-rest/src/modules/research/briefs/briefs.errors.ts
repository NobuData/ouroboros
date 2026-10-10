/**
 * Why a brief cannot be read, and why a matrix cannot be built (CM.2,
 * [#621](https://github.com/NobuData/ouroboros/issues/621)).
 *
 * Each code is stable and is what a client branches on; the sentences are for people.
 */

import { InvalidRequestError, NotFoundError } from "../../errors/error.envelope";

/** The stable codes. */
export const BRIEF_ERRORS = {
  /** The investigation exists but has delivered no brief yet. `404`. */
  briefNotFound: "brief_not_found",
  /** The matrix input is not the shape a gap analysis produces. `422`. */
  matrixInputInvalid: "matrix_input_invalid",
  /** A cell states a status other than `unknown` and cites nothing. `422`. */
  matrixCellUncited: "matrix_cell_uncited",
  /** A row lacks a cell for us or for a rival column, or has one for a column twice. `422`. */
  matrixRowIncomplete: "matrix_row_incomplete",
  /** A cell cites a source the investigation's ledger does not hold. `422`. */
  matrixSourceUnknown: "matrix_source_unknown",
} as const;

/**
 * @param investigation - `RS-127`.
 * @returns `404 brief_not_found`.
 */
export function briefNotFound(investigation: string): NotFoundError {
  return new NotFoundError(
    BRIEF_ERRORS.briefNotFound,
    "This investigation has not delivered a brief.",
    { investigation },
  );
}

/**
 * @param reason - What is wrong with the input, as a sentence fragment.
 * @returns `422 matrix_input_invalid`.
 */
export function matrixInputInvalid(reason: string): InvalidRequestError {
  return new InvalidRequestError(
    BRIEF_ERRORS.matrixInputInvalid,
    `The matrix input is not well-formed: ${reason}.`,
    { reason },
  );
}

/**
 * @param capability - The row.
 * @param subject - The column whose cell is uncited.
 * @param status - The status it states.
 * @returns `422 matrix_cell_uncited`.
 */
export function matrixCellUncited(
  capability: string,
  subject: string,
  status: string,
): InvalidRequestError {
  return new InvalidRequestError(
    BRIEF_ERRORS.matrixCellUncited,
    "A matrix cell states a status with no citation — an uncited cell is unknown.",
    { capability, subject, status },
  );
}

/**
 * @param capability - The row.
 * @param missing - The columns it has no cell for.
 * @param repeated - The columns it has more than one cell for.
 * @returns `422 matrix_row_incomplete`.
 */
export function matrixRowIncomplete(
  capability: string,
  missing: readonly string[],
  repeated: readonly string[],
): InvalidRequestError {
  return new InvalidRequestError(
    BRIEF_ERRORS.matrixRowIncomplete,
    "A matrix row needs exactly one cell for us and for every rival column — a blank is not an answer.",
    { capability, missing: [...missing], repeated: [...repeated] },
  );
}

/**
 * @param sources - The ids the ledger does not hold.
 * @returns `422 matrix_source_unknown`.
 */
export function matrixSourceUnknown(sources: readonly string[]): InvalidRequestError {
  return new InvalidRequestError(
    BRIEF_ERRORS.matrixSourceUnknown,
    "A matrix cell cites a source that is not in this investigation's ledger.",
    { sources: [...sources] },
  );
}
