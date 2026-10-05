/**
 * The audit plane's refusals — every one a `422` naming the field it is about (BR.2,
 * [#486](https://github.com/NobuData/ouroboros/issues/486)). Shape errors are the validation
 * pipe's (`422 validation_failed`); these are the ones that need the whole request.
 */

import { InvalidRequestError } from "../errors/error.envelope";

/** The stable codes. */
export const AUDIT_PLANE_ERRORS = {
  /** `to` is not after `from`. */
  rangeInvalid: "audit_range_invalid",
  /** An export without both ends of its range. */
  exportRangeRequired: "audit_export_range_required",
  /** An export range longer than {@link AUDIT_EXPORT_MAX_DAYS}. */
  exportRangeTooLong: "audit_export_range_too_long",
  /** A cursor this service did not mint. */
  cursorInvalid: "audit_cursor_invalid",
  /** A `pr:` reference whose number is not a positive integer. */
  referenceInvalid: "audit_reference_invalid",
} as const;

/**
 * The longest range one export may cover, in days — a year and a leap day. A longer history is
 * several exports: building a decade of rows into one response is how an export endpoint becomes
 * an availability problem, and *give me last quarter* is the request this serves.
 */
export const AUDIT_EXPORT_MAX_DAYS = 366;

/**
 * One refusal, bound to its field.
 *
 * @param code - One of {@link AUDIT_PLANE_ERRORS}.
 * @param field - The query parameter it is about.
 * @param message - What to tell the person.
 * @returns The error to throw.
 */
function refusal(code: string, field: string, message: string): InvalidRequestError {
  return new InvalidRequestError(code, message, { fields: { [field]: [message] } });
}

/** @returns `422 audit_range_invalid` — `to` must be after `from`. */
export function auditRangeInvalid(): InvalidRequestError {
  return refusal(AUDIT_PLANE_ERRORS.rangeInvalid, "to", "to must be after from.");
}

/**
 * @param field - The missing end, `from` or `to`.
 * @returns `422 audit_export_range_required`.
 */
export function auditExportRangeRequired(field: "from" | "to"): InvalidRequestError {
  return refusal(
    AUDIT_PLANE_ERRORS.exportRangeRequired,
    field,
    `An export needs a bounded range: ${field} is required.`,
  );
}

/** @returns `422 audit_export_range_too_long`. */
export function auditExportRangeTooLong(): InvalidRequestError {
  return refusal(
    AUDIT_PLANE_ERRORS.exportRangeTooLong,
    "to",
    `An export covers at most ${String(AUDIT_EXPORT_MAX_DAYS)} days; export a longer history in parts.`,
  );
}

/** @returns `422 audit_cursor_invalid`. */
export function auditCursorInvalid(): InvalidRequestError {
  return refusal(
    AUDIT_PLANE_ERRORS.cursorInvalid,
    "cursor",
    "cursor is not one this service issued; start again from the first page.",
  );
}

/** @returns `422 audit_reference_invalid`. */
export function auditReferenceInvalid(): InvalidRequestError {
  return refusal(
    AUDIT_PLANE_ERRORS.referenceInvalid,
    "ref",
    "A pr: reference must name a positive pull request number.",
  );
}
