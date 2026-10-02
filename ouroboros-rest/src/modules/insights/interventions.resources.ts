/**
 * What the intervention routes answer (BI.3, [#434](https://github.com/NobuData/ouroboros/issues/434);
 * the list, BK.4, [#445](https://github.com/NobuData/ouroboros/issues/445)).
 */

import type {
  InterventionCause,
  InterventionEvent,
  InterventionOverride,
  InterventionSource,
} from "../db/schema";
import type { MetricRange } from "./metrics/metrics.window";
import type { Day } from "./rollup/rollup.types";

/** One re-categorization, as its audit row records it. */
export interface InterventionOverrideResource {
  /** Who — `user.id`; null once the person is removed. */
  readonly actorId: string | null;
  readonly fromCause: InterventionCause;
  readonly toCause: InterventionCause;
  readonly reason: string;
  /** ISO 8601. */
  readonly createdAt: string;
}

/** One intervention event. */
export interface InterventionResource {
  readonly id: string;
  readonly runId: string;
  readonly source: InterventionSource;
  readonly sourceRef: string;
  /** ISO 8601. */
  readonly detectedAt: string;
  /** What the rules read. */
  readonly signals: readonly string[];
  readonly cause: InterventionCause;
  /** `rule` or `human` — a human cause is never overwritten by a rule run. */
  readonly causeOrigin: "rule" | "human";
  /** The rule that assigned the cause, or null when a person set it. */
  readonly ruleId: string | null;
  readonly ruleVersion: number | null;
  /** The re-categorization that set the cause, when a person did. */
  readonly override: InterventionOverrideResource | null;
}

/** The events behind the interventions card's bars, over the page's window. */
export interface InterventionListResource {
  readonly range: MetricRange;
  /** The UTC days listed — the page's own window for the range. */
  readonly window: { readonly from: Day; readonly to: Day };
  /** The cause listed, or null for every cause. */
  readonly cause: InterventionCause | null;
  /** How many events matched — the bar's value — however many are listed. */
  readonly total: number;
  /** The newest matching events, newest first, at most `INTERVENTION_LIST_LIMIT`. */
  readonly interventions: readonly InterventionResource[];
}

/**
 * The resource for an event and its latest override.
 *
 * @param event - The row.
 * @param override - The latest override of it, or undefined when it has none.
 * @returns The resource.
 */
export function interventionResource(
  event: InterventionEvent,
  override: InterventionOverride | undefined,
): InterventionResource {
  return {
    id: event.id,
    runId: event.run_id,
    source: event.source,
    sourceRef: event.source_ref,
    detectedAt: event.detected_at.toISOString(),
    signals: event.signals,
    cause: event.cause,
    causeOrigin: event.cause_origin,
    ruleId: event.rule_id,
    ruleVersion: event.rule_version,
    override:
      override === undefined
        ? null
        : {
            actorId: override.actor_id,
            fromCause: override.from_cause,
            toCause: override.to_cause,
            reason: override.reason,
            createdAt: override.created_at.toISOString(),
          },
  };
}
