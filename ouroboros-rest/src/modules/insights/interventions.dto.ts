/**
 * The shapes the intervention routes accept: the re-categorization (BI.3,
 * [#434](https://github.com/NobuData/ouroboros/issues/434)) and the list behind each bar of the
 * interventions card (BK.4, [#445](https://github.com/NobuData/ouroboros/issues/445)).
 *
 * The cause vocabulary is V079's, closed: an unknown cause is a `422` naming the field. The reason
 * is required and never blank — V079's `intervention_overrides_reason_present` — because a
 * correction nobody can explain is not auditable.
 */

import { IsIn, IsOptional, IsString, IsUUID, Length, Matches } from "class-validator";

import { INTERVENTION_CAUSES, type InterventionCause } from "../db/schema";
import { METRIC_RANGES, type MetricRange } from "./metrics/metrics.window";

/** V079's `intervention_overrides_reason_present`. */
export const MAX_RECATEGORIZE_REASON_LENGTH = 2000;

/**
 * The most events one list answers — far more than a card's bar holds in a month, and few enough
 * that a page of them is one small read. `total` says when there were more.
 */
export const INTERVENTION_LIST_LIMIT = 50;

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

/** `GET /api/v1/insights/interventions?range=&cause=`. */
export class InterventionListQuery {
  /** `7d`, `30d` or `90d` — the Insights page's windows; `30d` when absent. */
  @IsOptional()
  @IsIn(METRIC_RANGES)
  range?: MetricRange;

  /** One cause — one bar of the card; every cause when absent. */
  @IsOptional()
  @IsIn(INTERVENTION_CAUSES)
  cause?: InterventionCause;
}
