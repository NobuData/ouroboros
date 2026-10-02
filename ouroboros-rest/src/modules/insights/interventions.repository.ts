/**
 * `intervention_events` statements — the re-categorization (V079,
 * [#434](https://github.com/NobuData/ouroboros/issues/434)) and the list behind each bar of mockup
 * 15's interventions card (BK.4, [#445](https://github.com/NobuData/ouroboros/issues/445)).
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
import type { Day } from "./rollup/rollup.types";

/** An event and the override that just set its cause. */
export interface Recategorized {
  readonly event: InterventionEvent;
  readonly override: InterventionOverride;
}

/** One listed event and its latest override, when a person has corrected it. */
export interface ListedIntervention {
  readonly event: InterventionEvent;
  readonly override: InterventionOverride | undefined;
}

/** What {@link InterventionStore.list} asks for. */
export interface InterventionListQuery {
  /** The first UTC day, inclusive. */
  readonly from: Day;
  /** The last UTC day, inclusive. */
  readonly to: Day;
  /** One cause, or undefined for every cause. */
  readonly cause?: InterventionCause;
  /** The most events to answer. */
  readonly limit: number;
}

/** A page of events and how many matched in all. */
export interface InterventionListPage {
  /** Every event that matched, however many were answered. */
  readonly total: number;
  /** The newest {@link InterventionListQuery.limit} of them, newest first. */
  readonly items: readonly ListedIntervention[];
}

/** The intervention statements, as the service reaches them. */
export interface InterventionStore {
  /**
   * A workspace's intervention events detected over a span of UTC days — **the events the
   * interventions card counts**: bucketed by `detected_at`'s UTC day and joined to the run's
   * repository exactly as `intervention_cause_daily` is, so a bar of `8` lists eight events.
   *
   * @param organizationId - The workspace.
   * @param query - The days, the cause and the bound.
   * @returns The matching total and the newest events, each with its latest override.
   */
  list(organizationId: string, query: InterventionListQuery): Promise<InterventionListPage>;

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
  async list(organizationId: string, query: InterventionListQuery): Promise<InterventionListPage> {
    // `intervention_cause_daily`'s day and repository joins, so the list and the bar agree.
    const matching = sql`
      from ouroboros.intervention_events e
      join ouroboros.runs r on r.id = e.run_id
      join ouroboros.github_repos gr on gr.id = r.github_repo_id
      join ouroboros.github_orgs gor on gor.id = gr.org_id
     where e.organization_id = ${organizationId}
       and (e.detected_at at time zone 'UTC')::date between ${query.from}::date and ${query.to}::date
       ${query.cause === undefined ? sql`` : sql`and e.cause = ${query.cause}`}`;

    const db = this.database.db;
    const counted = await sql<{ total: string }>`select count(*) as total ${matching}`.execute(db);
    const { rows: events } = await sql<InterventionEvent>`
      select e.* ${matching}
       order by e.detected_at desc, e.id desc
       limit ${query.limit}`.execute(db);

    const overrides =
      events.length === 0
        ? []
        : await db
            .selectFrom("intervention_overrides")
            .selectAll()
            .where(
              "event_id",
              "in",
              events.map((event) => event.id),
            )
            .orderBy("created_at", "desc")
            .orderBy("id", "desc")
            .execute();

    return {
      total: Number(counted.rows[0]?.total ?? 0),
      items: events.map((event) => ({
        event,
        // Newest first, so the first match is the override that set the current cause.
        override: overrides.find((override) => override.event_id === event.id),
      })),
    };
  }

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
