/**
 * `intervention_events` statements — the re-categorization (V079,
 * [#434](https://github.com/NobuData/ouroboros/issues/434)).
 *
 * The write itself is `ouroboros.recategorize_intervention()` in the migration: it locks the event,
 * writes the `intervention_overrides` audit row from the event's current cause and sets the
 * person's cause in one transaction, and the event's trigger refuses a human cause without that
 * row. `tests/constraints.sql` proves both halves, and that a later rule run leaves it alone. This
 * file calls it and reads back what it wrote.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { InterventionCause, InterventionEvent, InterventionOverride } from "../db/schema";

/** An event and the override that just set its cause. */
export interface Recategorized {
  readonly event: InterventionEvent;
  readonly override: InterventionOverride;
}

/** The intervention statements, as the service reaches them. */
export interface InterventionStore {
  /**
   * Re-categorize one event of a workspace, audited.
   *
   * @param organizationId - The workspace.
   * @param eventId - `intervention_events.id`.
   * @param actorId - Who — `user.id`.
   * @param cause - The person's cause.
   * @param reason - Why.
   * @returns The event and its new override, or undefined when the event is not the workspace's.
   * @throws The database's refusal — `intervention_overrides_changes_cause` when the cause is
   *   already the one asked for.
   */
  recategorize(
    organizationId: string,
    eventId: string,
    actorId: string,
    cause: InterventionCause,
    reason: string,
  ): Promise<Recategorized | undefined>;
}

@Injectable()
export class InterventionRepository implements InterventionStore {
  /** @param database - The connection. */
  constructor(private readonly database: DatabaseService) {}

  /** @inheritdoc */
  async recategorize(
    organizationId: string,
    eventId: string,
    actorId: string,
    cause: InterventionCause,
    reason: string,
  ): Promise<Recategorized | undefined> {
    return this.database.db.transaction().execute(async (trx) => {
      const { rows } = await sql<InterventionEvent>`
        select * from ouroboros.recategorize_intervention(
          ${organizationId}, ${eventId}::uuid, ${actorId}, ${cause}, ${reason})`.execute(trx);
      const event = rows[0];

      if (event === undefined) {
        return undefined;
      }

      const override = await trx
        .selectFrom("intervention_overrides")
        .selectAll()
        .where("event_id", "=", event.id)
        .orderBy("created_at", "desc")
        .orderBy("id", "desc")
        .limit(1)
        .executeTakeFirstOrThrow();

      return { event, override };
    });
  }
}
