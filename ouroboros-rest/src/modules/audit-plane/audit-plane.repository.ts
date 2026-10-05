/**
 * The audit plane's reads — one keyset-paged, filtered `select` over `audit_events`, and a count
 * under the same filter (BR.2, [#486](https://github.com/NobuData/ouroboros/issues/486)).
 *
 * **Reads only.** The trail's one writer stays `AuditService` (`audit/`), and the purge's one
 * write is V102's `audit_events_purge()` (`audit-purge.repository.ts`). Nothing here can insert,
 * revise or delete an event.
 *
 * **Org scoping is the first predicate of every statement**, on `audit.repository.ts`'s argument:
 * the workspace comes from the tenant context, never the request.
 *
 * **Each filter maps onto a V102 index.** The statement is built so the planner can enter through
 * the index of whichever dimension is set — the workspace, then one equality, then the page order
 * — and `audit-plane.integration-spec.ts` asserts that with `EXPLAIN` over a seeded history rather
 * than with a stopwatch.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Expression, type ExpressionBuilder, type SqlBool } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { Database } from "../db/schema";
import type { AuditEventRow } from "../audit/audit.repository";
import type { AuditCursor } from "./audit-plane.cursor";
import type { AuditPlaneFilter, AuditReference } from "./audit-plane.filter";

/** One row of the plane: the trail's row, its plane, and its exact instant for the cursor. */
export interface AuditPlaneRow extends AuditEventRow {
  /** The action's family — `policy`. */
  plane: string;
  /** `occurred_at` as UTC microsecond text — the cursor's half that a `Date` would round. */
  cursor_at: string;
}

/** `occurred_at` as UTC text with microseconds, which `AuditCursor.at` carries back. */
const CURSOR_AT = sql<string>`to_char(audit_events.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

@Injectable()
export class AuditPlaneRepository {
  /**
   * @param database - The typed connection.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * One page of a workspace's events, newest first, strictly after a cursor.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param filter - The structured filter.
   * @param after - Where the previous page ended, or `undefined` for the first page.
   * @param limit - The most rows. Callers ask for one more than they show, to know whether a next
   *   page exists without a count.
   * @returns The rows, in page order.
   */
  async page(
    organizationId: string,
    filter: AuditPlaneFilter,
    after: AuditCursor | undefined,
    limit: number,
  ): Promise<AuditPlaneRow[]> {
    return this.pageQuery(organizationId, filter, after, limit).execute();
  }

  /**
   * The page statement, unexecuted — what {@link page} runs and what the integration spec explains.
   *
   * @param organizationId - The workspace.
   * @param filter - The structured filter.
   * @param after - Where the previous page ended.
   * @param limit - The most rows.
   * @returns The Kysely query.
   */
  pageQuery(
    organizationId: string,
    filter: AuditPlaneFilter,
    after: AuditCursor | undefined,
    limit: number,
  ) {
    return this.database.db
      .selectFrom("audit_events")
      .leftJoin("user", "user.id", "audit_events.actor_id")
      .where((eb) => {
        const predicates = filterPredicates(eb, organizationId, filter);

        if (after !== undefined) {
          predicates.push(
            sql<SqlBool>`(audit_events.occurred_at, audit_events.id) < (${after.at}::timestamptz, ${after.id}::uuid)`,
          );
        }

        return eb.and(predicates);
      })
      .select([
        "audit_events.id",
        "audit_events.actor_id",
        "user.name as actor_name",
        "audit_events.actor_service",
        "audit_events.actor_kind",
        "audit_events.action",
        "audit_events.plane",
        "audit_events.subject_type",
        "audit_events.subject_id",
        "audit_events.ip",
        "audit_events.detail",
        "audit_events.occurred_at",
        CURSOR_AT.as("cursor_at"),
      ])
      .orderBy("audit_events.occurred_at", "desc")
      .orderBy("audit_events.id", "desc")
      .limit(limit);
  }

  /**
   * How many events match a filter — the export's row count, taken before its first byte.
   *
   * @param organizationId - The workspace.
   * @param filter - The structured filter.
   * @returns The count.
   */
  async count(organizationId: string, filter: AuditPlaneFilter): Promise<number> {
    const row = await this.database.db
      .selectFrom("audit_events")
      .where((eb) => eb.and(filterPredicates(eb, organizationId, filter)))
      .select((eb) => eb.fn.countAll<string>().as("total"))
      .executeTakeFirstOrThrow();

    // `count(*)` is a bigint, which `pg` hands over as text; an export is bounded far below 2^53.
    return Number(row.total);
  }
}

/**
 * The predicates a filter adds, workspace first. An absent dimension adds nothing, so the plan of
 * an unfiltered read is the plain page.
 *
 * @param eb - The expression builder of the statement being built.
 * @param organizationId - The workspace.
 * @param filter - The structured filter.
 * @returns The predicates, to be `and`ed.
 */
function filterPredicates(
  eb: ExpressionBuilder<Database, "audit_events">,
  organizationId: string,
  filter: AuditPlaneFilter,
): Expression<SqlBool>[] {
  const predicates: Expression<SqlBool>[] = [
    eb("audit_events.organization_id", "=", organizationId),
  ];

  if (filter.from !== undefined) predicates.push(eb("audit_events.occurred_at", ">=", filter.from));
  if (filter.to !== undefined) predicates.push(eb("audit_events.occurred_at", "<", filter.to));
  if (filter.actorKind !== undefined) {
    predicates.push(eb("audit_events.actor_kind", "=", filter.actorKind));
  }
  if (filter.actorId !== undefined)
    predicates.push(eb("audit_events.actor_id", "=", filter.actorId));
  if (filter.actorService !== undefined) {
    predicates.push(eb("audit_events.actor_service", "=", filter.actorService));
  }
  if (filter.plane !== undefined) predicates.push(eb("audit_events.plane", "=", filter.plane));
  if (filter.action !== undefined) predicates.push(eb("audit_events.action", "=", filter.action));
  if (filter.ref !== undefined) predicates.push(referencePredicate(eb, filter.ref));

  return predicates;
}

/**
 * A reference search, as a predicate over the subject or a containment test on `detail` — the
 * two shapes V102 indexes (`audit_events_org_subject_idx`, `audit_events_detail_refs_idx`).
 *
 * @param eb - The expression builder.
 * @param ref - The parsed reference.
 * @returns The predicate.
 */
function referencePredicate(
  eb: ExpressionBuilder<Database, "audit_events">,
  ref: AuditReference,
): Expression<SqlBool> {
  const contains = (fact: Record<string, string | number>) =>
    sql<SqlBool>`audit_events.detail @> ${JSON.stringify(fact)}::jsonb`;

  switch (ref.kind) {
    case "pr":
      return contains({ pr_number: ref.number });
    case "run":
      return eb.or([
        eb("audit_events.subject_id", "=", ref.value),
        contains({ run_id: ref.value }),
      ]);
    case "repo":
      return eb.or([eb("audit_events.subject_id", "=", ref.value), contains({ repo: ref.value })]);
    case "subject":
      return eb("audit_events.subject_id", "=", ref.value);
  }
}
