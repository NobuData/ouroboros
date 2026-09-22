/**
 * Evidence, made safe to write — the service's half of decision **R5**.
 *
 * V048 enforces what evidence may look like with CHECK constraints, and it says plainly where
 * the other half lives: *"the defence against the payload ever being built is #305's"*. This is
 * that defence, and it exists for two reasons.
 *
 * **1. A refused row would refuse the report.** Guardrail verdicts are written inside the
 * change-set report's transaction (AP.1), so evidence the database rejects is a `500` for the
 * whole report — and it would be rejected for the path the run *reported*, which is not
 * something the executor can fix by retrying. A repository with a file named
 * `fixtures/AKIAIOSFODNN7EXAMPLEKEYS.json` is a real repository.
 *
 * **2. The constraints describe the row, not the error.** PostgreSQL reports a check violation
 * with the failing row in its `DETAIL`, so a value that trips `evidence_no_opaque_token` has
 * already been sent to the error log on its way to being refused. Screening here means the
 * database never sees it.
 *
 * So every string field is held to V048's shape before it is written, and a field that fails is
 * **withheld** rather than truncated or masked — a masked credential is still most of a
 * credential, and a truncated path points at the wrong file.
 */

import type { GuardrailEvidence } from "../db/schema";

/** V048's `guardrail_evaluations_evidence_no_opaque_token`, verbatim. */
const OPAQUE_TOKEN = /[A-Za-z0-9+=]{20,}/;

/** V048's per-key length bounds. */
const MAX_LENGTH = { path: 1024, rule_id: 64, glob: 256, detail: 512 } as const;

/** V048's `rule_id` grammar. */
const RULE_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * What a withheld path is replaced with — a sentence, so the verdict still says *why*.
 *
 * In practice the reason is an opaque token in the file name; the sentence does not say which
 * rule the path broke, because that would be describing the thing withheld.
 */
export const PATH_WITHHELD = "path withheld because it cannot be stored as evidence";

/**
 * Is this string safe to store as an evidence value?
 *
 * @param value - The candidate.
 * @param max - The key's length bound.
 * @returns `true` when it is non-empty, unpadded, within bounds, and free of an opaque token.
 */
function storable(value: string, max: number): boolean {
  return value.trim() === value && value !== "" && value.length <= max && !OPAQUE_TOKEN.test(value);
}

/**
 * Hold evidence to V048's shape, withholding any field that would not survive it.
 *
 * @param evidence - What a check produced.
 * @returns The evidence with every unsafe field removed, a note in `detail` when a path had to
 *   be withheld, or `null` when nothing storable remains.
 */
export function safeEvidence(evidence: GuardrailEvidence): GuardrailEvidence | null {
  const safe: GuardrailEvidence = {};

  if (evidence.path !== undefined) {
    if (storable(evidence.path, MAX_LENGTH.path)) {
      safe.path = evidence.path;
    } else {
      safe.detail = PATH_WITHHELD;
    }
  }

  if (evidence.line !== undefined && Number.isInteger(evidence.line) && evidence.line >= 1) {
    safe.line = evidence.line;
  }

  if (
    evidence.rule_id !== undefined &&
    storable(evidence.rule_id, MAX_LENGTH.rule_id) &&
    RULE_ID.test(evidence.rule_id)
  ) {
    safe.rule_id = evidence.rule_id;
  }

  if (evidence.glob !== undefined && storable(evidence.glob, MAX_LENGTH.glob)) {
    safe.glob = evidence.glob;
  }

  // A withheld path's note wins over the check's own sentence: the sentence describes a place
  // the row no longer names, and the note is what tells a reader why.
  if (
    safe.detail === undefined &&
    evidence.detail !== undefined &&
    storable(evidence.detail, MAX_LENGTH.detail)
  ) {
    safe.detail = evidence.detail;
  }

  return Object.keys(safe).length === 0 ? null : safe;
}
