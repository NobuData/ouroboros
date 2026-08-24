/**
 * Every statement the audit trail issues — an `insert`, and a paged `select`. There is no
 * third.
 *
 * AD.4 ([#225](https://github.com/NobuData/ouroboros/issues/225)).
 *
 * **That there are only two is the point of the file rather than a description of it.**
 * V022 makes `audit_events` append-only in the database — `audit_events_no_update` refuses a
 * revision from any role, and the application role holds `select` and `insert` and nothing
 * else — and this class is the shape of that rule in TypeScript. There is no `update` method
 * to call, no `delete` method to call, and `db/schema.ts` publishes no `UpdateableAuditEvent`
 * for one to be written against. A reader who wants to know whether this service can rewrite
 * its own audit trail can answer the question by reading the method list.
 *
 * **Org scoping is not optional and is not the client's.** {@link AuditRepository.page} takes
 * `organizationId` first and its statement carries it, the same rule
 * `provider-connections.repository.ts` states — and load-bearing in the same way: an event
 * names who revealed which credential and from where, so a `where action = $1` without the
 * workspace beside it is one request away from another tenant's security history. The value
 * comes from the tenant context; there is no `{orgId}` in the trail's path.
 *
 * **The actor's name is joined here rather than looked up by the caller.** A trail of ids is
 * a trail nobody can read, and the alternative — the service resolving each distinct actor
 * through another module — is one query per page plus a coupling to tenancy for a display
 * string. The join is a left one because the two cases where it finds nothing are both
 * ordinary: a lease grant has no actor at all, and a deleted person leaves `actor_id` null
 * behind by V022's own set-null.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import type { NewAuditEvent } from "../db/schema";
import type { PageWindow } from "../tenancy/pagination";

/**
 * One row of the trail, as the endpoint reads it: the event, plus the actor's name.
 *
 * Not `AuditEvent` from the schema mirror, deliberately. That type is the *row*; this is what
 * one `select` returns, and it carries a column no row has — `actor_name`, from the join. The
 * workspace is absent for the reason `provider-connections.repository.ts` omits it: the
 * caller supplied it and would only be reading its own argument back.
 */
export interface AuditEventRow {
  id: string;
  actor_id: string | null;
  /** `"user"."name"`, or `null` when there is no actor or the person has been deleted. */
  actor_name: string | null;
  action: string;
  subject_type: string;
  subject_id: string | null;
  ip: string | null;
  detail: Record<string, string | number | boolean | null>;
  occurred_at: Date;
}

/** What a caller may narrow a page of the trail by. */
export interface AuditFilter {
  /** One connection — `audit_events.subject_id`. */
  readonly subjectId?: string;
  /** One person — `audit_events.actor_id`. */
  readonly actorId?: string;
  /** One action name. */
  readonly action?: string;
}

@Injectable()
export class AuditRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's
   *   lifecycle belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Append one event.
   *
   * **No transaction, and no caller may put one around it.** An audit write that shared a
   * transaction with the operation it records would be rolled back by that operation's
   * failure — which is precisely the case AD.4 exists to cover, since *a failed rotation is
   * still an event*. The event is a separate statement so that it survives the failure it
   * describes.
   *
   * @param event - The row. Its shape is `db/schema.ts`'s `NewAuditEvent`, which has no
   *   column a credential could be passed to.
   * @returns The event's id, so a caller can correlate its own answer with the trail.
   */
  async append(event: NewAuditEvent): Promise<string> {
    const inserted = await this.database.db
      .insertInto("audit_events")
      .values(event)
      .returning("id")
      .executeTakeFirstOrThrow();

    return inserted.id;
  }

  /**
   * One page of a workspace's trail, newest first.
   *
   * Ordered by `occurred_at desc, id desc` — the index V022 creates, and the id is the
   * tiebreaker rather than decoration: two events inside the same millisecond would otherwise
   * page in whatever order the planner felt like, which is how a row appears on two pages and
   * another on none.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param filter - What to narrow by. Every field is optional; an absent one adds no
   *   predicate at all rather than a `true`, so the plan is the same shape as the unfiltered
   *   read.
   * @param window - The `limit`/`offset`, per the #31 convention.
   * @returns The rows and the workspace's total *under the same filter* — because a page
   *   count computed against a different set is a page count that lies.
   */
  async page(
    organizationId: string,
    filter: AuditFilter,
    window: PageWindow,
  ): Promise<{ rows: AuditEventRow[]; total: number }> {
    const rows = await this.scoped(organizationId, filter)
      .leftJoin("user", "user.id", "audit_events.actor_id")
      .select([
        "audit_events.id",
        "audit_events.actor_id",
        "user.name as actor_name",
        "audit_events.action",
        "audit_events.subject_type",
        "audit_events.subject_id",
        "audit_events.ip",
        "audit_events.detail",
        "audit_events.occurred_at",
      ])
      .orderBy("audit_events.occurred_at", "desc")
      .orderBy("audit_events.id", "desc")
      .limit(window.limit)
      .offset(window.offset)
      .execute();

    const counted = await this.scoped(organizationId, filter)
      .select((builder) => builder.fn.countAll<string>().as("total"))
      .executeTakeFirstOrThrow();

    // `count(*)` is a `bigint`, which `pg` hands over as a string and is right to — see
    // `db/schema.ts`. A workspace's event count is far inside a double; it is a credential
    // trail, not a token ledger.
    return { rows, total: Number(counted.total) };
  }

  /**
   * The workspace's events, narrowed by whatever the caller asked for and selecting nothing
   * yet.
   *
   * **Shared by the page and its total**, which is the whole reason it exists: two copies of
   * these four predicates would be a `total` that stops matching `items` the first time a
   * fifth filter is added to one of them and not the other. Kysely's builders are immutable,
   * so one call can be joined onto for the rows and aggregated for the count without either
   * seeing the other's shape.
   *
   * The predicates are assembled inside a `where` callback rather than chained, so each one
   * is written with the column's real type — no cast, and a filter naming a column that does
   * not exist is a compile error rather than a run-time surprise.
   *
   * @param organizationId - The workspace, from the tenant context. Always present, and
   *   always first: see this file's header on why that is not a redundancy.
   * @param filter - What to narrow by. An absent field adds no predicate at all rather than a
   *   `true`, so the plan is the same shape as the unfiltered read.
   * @returns The scoped query, ready for a selection.
   */
  private scoped(organizationId: string, filter: AuditFilter) {
    return this.database.db.selectFrom("audit_events").where((eb) => {
      const predicates = [eb("audit_events.organization_id", "=", organizationId)];

      if (filter.subjectId !== undefined) {
        predicates.push(eb("audit_events.subject_id", "=", filter.subjectId));
      }

      if (filter.actorId !== undefined) {
        predicates.push(eb("audit_events.actor_id", "=", filter.actorId));
      }

      if (filter.action !== undefined) {
        predicates.push(eb("audit_events.action", "=", filter.action));
      }

      return eb.and(predicates);
    });
  }
}
