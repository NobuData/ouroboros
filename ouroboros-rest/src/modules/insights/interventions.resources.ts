/**
 * What the intervention routes answer (BI.3, [#434](https://github.com/NobuData/ouroboros/issues/434)).
 */

import type {
  InterventionCause,
  InterventionEvent,
  InterventionOverride,
  InterventionSource,
} from "../db/schema";

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
