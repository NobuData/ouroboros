/**
 * The shapes the intervention re-categorization accepts (BI.3,
 * [#434](https://github.com/NobuData/ouroboros/issues/434)).
 *
 * The cause vocabulary is V079's, closed: an unknown cause is a `422` naming the field. The reason
 * is required and never blank — V079's `intervention_overrides_reason_present` — because a
 * correction nobody can explain is not auditable.
 */

import { IsIn, IsString, IsUUID, Length, Matches } from "class-validator";

import { INTERVENTION_CAUSES, type InterventionCause } from "../db/schema";

/** V079's `intervention_overrides_reason_present`. */
export const MAX_RECATEGORIZE_REASON_LENGTH = 2000;

/** A value that is not only whitespace. */
const NON_BLANK = /\S/;

/** `:id` — an intervention event. */
export class InterventionIdParams {
  @IsUUID()
  id!: string;
}

/** `POST /api/v1/insights/interventions/{id}/recategorize`. */
export class RecategorizeInterventionBody {
  /** The cause the person says it was. */
  @IsIn(INTERVENTION_CAUSES)
  cause!: InterventionCause;

  /** Why — 1–2 000 characters, not only whitespace. */
  @IsString()
  @Length(1, MAX_RECATEGORIZE_REASON_LENGTH)
  @Matches(NON_BLANK, { message: "reason must not be blank" })
  reason!: string;
}
