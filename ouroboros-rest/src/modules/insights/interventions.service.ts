/**
 * `InterventionsService` — a person's correction of an intervention's cause (BI.3,
 * [#434](https://github.com/NobuData/ouroboros/issues/434), decision **I5**).
 *
 * ```
 * POST /insights/interventions/{id}/recategorize {cause, reason}
 *   ─▶ recategorize_intervention()   override row (actor, from, to, reason) + cause_origin = human
 * ```
 *
 * The rules map every intervention to a cause, and they will sometimes be wrong — a rig timeout
 * that was really an ambiguous ticket. A person (member and above, held at the route) corrects it
 * here; the database writes the audit row with the change and never lets a later rule run undo it.
 *
 * ```
 * POST …/recategorize  ─▶ … ─▶ RollupService.refillDay(interventions, detected day)
 * GET  /insights/interventions?range=&cause=  ─▶ the events behind one bar of the card
 * ```
 *
 * BK.4 ([#445](https://github.com/NobuData/ouroboros/issues/445)) adds both halves of the card's
 * round trip: the list is how a person reaches an event from a bar, and the re-fill is what makes
 * the bars — and the line computed from them — move with the correction at once rather than never
 * (the rollup re-reads only today and a trailing window).
 */

import { Inject, Injectable, Logger } from "@nestjs/common";

import { violatesConstraint } from "../tenancy/constraints";
import {
  INTERVENTION_CONSTRAINTS,
  interventionCauseUnchanged,
  interventionNotFound,
} from "./interventions.errors";
import { INTERVENTION_LIST_LIMIT, type RecategorizeInterventionBody } from "./interventions.dto";
import { InterventionRepository, type InterventionStore } from "./interventions.repository";
import {
  interventionResource,
  type InterventionListResource,
  type InterventionResource,
} from "./interventions.resources";
import { METRICS_CLOCK } from "./metrics/metrics.service";
import { resolveWindow, type MetricRange } from "./metrics/metrics.window";
import { utcDay } from "./rollup/rollup.days";
import { RollupService } from "./rollup/rollup.service";
import type { InterventionCause } from "../db/schema";

/** The rollup family the interventions card's bars are filled by. */
export const INTERVENTIONS_FAMILY = "interventions";

/** The rollup, as a correction reaches it. */
export type InterventionRefill = Pick<RollupService, "refillDay">;

@Injectable()
export class InterventionsService {
  private readonly logger = new Logger(InterventionsService.name);

  /**
   * @param store - The intervention statements.
   * @param rollup - The rollup, re-filled for a corrected event's day.
   * @param clock - The wall clock — the page's own, so the list's window is the page's.
   */
  constructor(
    @Inject(InterventionRepository) private readonly store: InterventionStore,
    @Inject(RollupService) private readonly rollup: InterventionRefill,
    @Inject(METRICS_CLOCK) private readonly clock: () => number,
  ) {}

  /**
   * The events behind the interventions card over a range — every cause, or one bar's.
   *
   * @param organizationId - The workspace.
   * @param range - The page's range.
   * @param cause - One cause, or undefined for all of them.
   * @returns The window, how many matched and the newest of them.
   */
  async list(
    organizationId: string,
    range: MetricRange,
    cause?: InterventionCause,
  ): Promise<InterventionListResource> {
    const { current } = resolveWindow(range, new Date(this.clock()));
    const page = await this.store.list(organizationId, {
      from: current.from,
      to: current.to,
      cause,
      limit: INTERVENTION_LIST_LIMIT,
    });

    return {
      range,
      window: { from: current.from, to: current.to },
      cause: cause ?? null,
      total: page.total,
      interventions: page.items.map((item) => interventionResource(item.event, item.override)),
    };
  }

  /**
   * Re-categorize one intervention event, for a person the route already held to member and above.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who — `user.id`.
   * @param eventId - The event.
   * @param body - The cause and the reason.
   * @returns The event, now `causeOrigin: "human"`, with the override that set it — and the day it
   *   was detected re-filled, so the card's bars and line move with it.
   * @throws {NotFoundError} `intervention_not_found` when the event is not this workspace's.
   * @throws {ConflictError} `intervention_cause_unchanged` when it already has that cause.
   */
  async recategorize(
    organizationId: string,
    actorId: string,
    eventId: string,
    body: RecategorizeInterventionBody,
  ): Promise<InterventionResource> {
    let written;

    try {
      written = await this.store.recategorize(
        organizationId,
        eventId,
        actorId,
        body.cause,
        body.reason,
      );
    } catch (error) {
      if (violatesConstraint(error, INTERVENTION_CONSTRAINTS.changesCause)) {
        throw interventionCauseUnchanged(eventId, body.cause);
      }
      throw error;
    }

    if (written === undefined) {
      throw interventionNotFound(eventId);
    }

    // The correction is committed whatever the re-fill does; a failed re-fill is recorded on the
    // family's bookkeeping and the next consolidation of that day mends it.
    const refill = await this.rollup.refillDay(
      organizationId,
      INTERVENTIONS_FAMILY,
      utcDay(written.event.detected_at),
      new Date(this.clock()),
    );

    if (refill.status === "failed") {
      this.logger.warn(
        `intervention ${eventId} was re-categorized but its day was not re-filled: ${refill.error ?? "unknown error"}`,
      );
    }

    return interventionResource(written.event, written.override);
  }
}
