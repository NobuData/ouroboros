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
 */

import { Inject, Injectable } from "@nestjs/common";

import { violatesConstraint } from "../tenancy/constraints";
import {
  INTERVENTION_CONSTRAINTS,
  interventionCauseUnchanged,
  interventionNotFound,
} from "./interventions.errors";
import type { RecategorizeInterventionBody } from "./interventions.dto";
import { InterventionRepository, type InterventionStore } from "./interventions.repository";
import { interventionResource, type InterventionResource } from "./interventions.resources";

@Injectable()
export class InterventionsService {
  /** @param store - The intervention statements. */
  constructor(@Inject(InterventionRepository) private readonly store: InterventionStore) {}

  /**
   * Re-categorize one intervention event, for a person the route already held to member and above.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who — `user.id`.
   * @param eventId - The event.
   * @param body - The cause and the reason.
   * @returns The event, now `causeOrigin: "human"`, with the override that set it.
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

    return interventionResource(written.event, written.override);
  }
}
