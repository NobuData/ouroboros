/**
 * Every statement the dashboard issues — eight of them, all scoped to one workspace.
 *
 * ## Why eight and not one
 *
 * The payload is six card surfaces over four tables and two views, and a single statement
 * producing all of it would be four lateral joins and a `json_build_object` — one query plan
 * nobody can read, whose cost is impossible to attribute when it slows down, and which
 * cannot be reused by the endpoints #71, #73 and #74 publish over the same rows. Eight
 * statements against indexed, org-scoped predicates cost less than the round trip that
 * carries them, and the service issues them concurrently.
 *
 * What *is* one statement is each **question**: every windowed number over `runs` is
 * computed in one pass with filtered aggregates, so the eleven figures the pulse card and
 * the stat row need are one index scan rather than eleven
 * ([#72](https://github.com/NobuData/ouroboros/issues/72)).
 *
 * ## Org scoping is not optional and is not the client's
 *
 * Every method takes `organizationId` as its first parameter and every statement filters on
 * it. The value comes from the tenant context — the session's active organization, resolved
 * and membership-checked by `tenancy/tenant.guard.ts` — and never from anything the caller
 * wrote. `dashboard.repository.spec.ts` asserts the predicate is present in every compiled
 * statement, because the failure it guards against is silent: a query that forgot it would
 * answer, and would answer with somebody else's numbers mixed in.
 *
 * ## Casts, and why they are in the SQL rather than in TypeScript
 *
 * `pg` hands back `bigint` and `numeric` as **strings**, because neither fits a JavaScript
 * number in general. Rather than convert in the mapper — where the decision is invisible and
 * the precision loss is nobody's — every aggregate below says what it is: `::int` for a
 * count, `::float8` for a mean of seconds, `::numeric` for money that then becomes a number
 * exactly once, in the service. A cast is a claim that the value fits, and it belongs where
 * the value is produced.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import { ACTIVE_RUN_STATUSES, type ActiveRunStatus, type QueueItem, type Run } from "../db/schema";
import type { DashboardWindows } from "./windows";

/** How many runs in flight the aggregate carries. The card draws what it has room for. */
export const ACTIVE_RUNS_LIMIT = 10;

/** How many closed runs it carries. The card draws four; the rest are the drill-in's head start. */
export const RECENT_RUNS_LIMIT = 8;

/** How many queued issues it carries — exactly what the *Up next in queue* card draws. */
export const QUEUE_HEAD_LIMIT = 5;

/** The windowed numbers over `runs`, as one pass of filtered aggregates returns them. */
export interface RunStatistics {
  /**
   * How many runs hold each active status.
   *
   * A full record rather than a partial one: adding a status to the lifecycle is a compile
   * error here, which is the only place it can be caught before it becomes a card silently
   * missing a column.
   */
  readonly live: Readonly<Record<ActiveRunStatus, number>>;
  /** Runs merged in the trailing seven days. */
  readonly mergedThisWeek: number;
  /** Runs merged in the seven days before those — what the delta is measured against. */
  readonly mergedPriorWeek: number;
  /** Runs that reached `needs_human` in the trailing seven days. */
  readonly interventionsThisWeek: number;
  /** Runs merged over the merge rate's fourteen-day window. */
  readonly mergedOverRateWindow: number;
  /** Runs that reached any terminal status over the same fourteen days — the rate's denominator. */
  readonly closedOverRateWindow: number;
  /** Mean `finished_at − started_at` over runs closed this week, in seconds. `0` for an empty window. */
  readonly avgCycleSeconds: number;
  /** Runs merged since midnight — the page head's *since this morning*. */
  readonly mergedSinceMorning: number;
}

/** The day's token ledger, rolled up across providers. */
export interface TokenTotals {
  /** Input plus output across the day, as text: a `bigint` `pg` will not narrow on its own. */
  readonly tokens: string;
  /** What the day's priced events cost, in cents, as `numeric` text. */
  readonly costCents: string;
  readonly providers: number;
  readonly unpricedEvents: number;
}

/** The queue's size and the sum of what it is expected to cost. */
export interface QueueTotals {
  readonly count: number;
  readonly estMinutes: number;
}

/**
 * A cheap statement of *what this workspace's dashboard is made of right now*.
 *
 * One string per source table: its row count and the newest `updated_at` in it, concatenated
 * and never parsed. It is hashed into the `ETag` and nothing reads its parts, which is why
 * the shape is text rather than a structure — the only property it needs is that two
 * different states cannot produce the same one.
 *
 * Every field is nullable because a *scalar subquery* is nullable in general — one that
 * matched no rows returns nothing — and Kysely is right to say so even though an aggregate
 * subquery always returns exactly one row. Nothing here coalesces it away: `strongEtag`
 * hashes a null distinctly from every string, so the unreachable case needs no invented
 * value to stand in for it.
 */
export interface DashboardVersion {
  readonly runs: string | null;
  readonly queueItems: string | null;
  readonly tokenUsage: string | null;
  readonly workspaceSettings: string | null;
}

@Injectable()
export class DashboardRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's
   *   lifecycle belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * What the workspace's dashboard is made of, cheaply enough to ask on every poll.
   *
   * Four aggregate subqueries over indexed, org-scoped predicates, and no row is returned
   * from any of them — this is the statement a `304` costs, and the whole reason the tag is
   * derived from a version source rather than from the rendered payload.
   *
   * **`token_usage` is fingerprinted on `created_at`.** It is append-only and carries no
   * `updated_at` (V010), and `occurred_at` would be the wrong column: an event back-filled
   * from a provider's usage export is *new* while its `occurred_at` is old, so a fingerprint
   * over it would hold a stale tag through exactly the write it exists to notice.
   *
   * **What it deliberately does not notice.** Rows aging out of a rolling window change the
   * numbers without changing any row, so a workspace where nothing is written holds one tag
   * while its seven-day counts drift. The calendar day is mixed into the tag by the service,
   * which closes the boundary that moves with no writes at all; the rest is the trade a
   * cheap version source makes, and it is bounded by the fact that a dashboard whose numbers
   * are moving is a dashboard whose rows are being written. The polling contract settled on
   * top of this — interval, `Cache-Control`, the backoff hint — is `docs/ARCHITECTURE.md`
   * § 5.4 ([#75](https://github.com/NobuData/ouroboros/issues/75)).
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns One fingerprint per source table.
   */
  async version(organizationId: string): Promise<DashboardVersion> {
    // `count || newest timestamp` in one aggregate pass per table: an insert or a delete
    // moves the count, an update moves the timestamp, and a delete-plus-insert moves both.
    const fingerprint = sql<string>`count(*)::text || ' ' || coalesce(max(updated_at)::text, '')`;

    return this.database.db
      .selectNoFrom((eb) => [
        eb
          .selectFrom("runs")
          .select(fingerprint.as("v"))
          .where("organization_id", "=", organizationId)
          .as("runs"),
        eb
          .selectFrom("queue_items")
          .select(fingerprint.as("v"))
          .where("organization_id", "=", organizationId)
          .as("queueItems"),
        eb
          .selectFrom("token_usage")
          .select(sql<string>`count(*)::text || ' ' || coalesce(max(created_at)::text, '')`.as("v"))
          .where("organization_id", "=", organizationId)
          .as("tokenUsage"),
        eb
          .selectFrom("workspace_settings")
          .select(fingerprint.as("v"))
          .where("organization_id", "=", organizationId)
          .as("workspaceSettings"),
      ])
      .executeTakeFirstOrThrow();
  }

  /**
   * Every windowed number over `runs`, in one pass.
   *
   * Filtered aggregates rather than one statement per figure: PostgreSQL reads the
   * workspace's rows once and evaluates eleven predicates as it goes, which is both faster
   * than eleven scans and — the property that actually matters — *consistent*, because every
   * figure is computed from the same snapshot of the same rows.
   *
   * Each window boundary arrives as a parameter from {@link DashboardWindows}, computed once
   * per request, so the count and the mean cannot disagree about where the week starts.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param windows - The instants this request's numbers are measured between.
   * @returns The statistics. Every field is a number: an empty workspace's row is zeros,
   *   which the `coalesce` on the mean and the `::int` on every count guarantee.
   */
  async runStatistics(organizationId: string, windows: DashboardWindows): Promise<RunStatistics> {
    const { weekStart, priorWeekStart, dayStart } = windows;

    const row = await this.database.db
      .selectFrom("runs")
      .where("organization_id", "=", organizationId)
      .select([
        // The live split. Three explicit aliases rather than a `group by`, so the shape is
        // known to the compiler and a status with no runs is a zero rather than a missing
        // row — see `resources.ts` on why every status has to be a key.
        sql<number>`count(*) filter (where status = ${"coding"})::int`.as("live_coding"),
        sql<number>`count(*) filter (where status = ${"building"})::int`.as("live_building"),
        sql<number>`count(*) filter (where status = ${"review"})::int`.as("live_review"),

        // `finished_at >= …` is what "in the window" means, and it doubles as "is terminal":
        // `runs_terminal_finished_at` (V008) makes the two the same condition, so nothing
        // here has to enumerate the terminal statuses to ask whether a run has stopped.
        sql<number>`count(*) filter (
          where status = ${"merged"} and finished_at >= ${weekStart}
        )::int`.as("merged_this_week"),
        sql<number>`count(*) filter (
          where status = ${"merged"}
            and finished_at >= ${priorWeekStart}
            and finished_at < ${weekStart}
        )::int`.as("merged_prior_week"),
        sql<number>`count(*) filter (
          where status = ${"needs_human"} and finished_at >= ${weekStart}
        )::int`.as("interventions_this_week"),
        sql<number>`count(*) filter (
          where status = ${"merged"} and finished_at >= ${priorWeekStart}
        )::int`.as("merged_over_rate_window"),
        sql<number>`count(*) filter (where finished_at >= ${priorWeekStart})::int`.as(
          "closed_over_rate_window",
        ),

        // The mean is over *every* run that closed this week, merged or not — see
        // `LoopPulse.avgCycleSeconds`. `coalesce` is what makes an empty window `0` rather
        // than the `null` an average over no rows is, and the cast is what makes it a number
        // rather than the text `pg` returns a `numeric` as.
        sql<number>`coalesce(avg(
          extract(epoch from (finished_at - started_at))
        ) filter (where finished_at >= ${weekStart}), 0)::float8`.as("avg_cycle_seconds"),

        sql<number>`count(*) filter (
          where status = ${"merged"} and finished_at >= ${dayStart}
        )::int`.as("merged_since_morning"),
      ])
      .executeTakeFirstOrThrow();

    return {
      // The object literal is the completeness check: widen `ActiveRunStatus` and this stops
      // compiling until the query and this mapping both learn the new status.
      live: {
        coding: row.live_coding,
        building: row.live_building,
        review: row.live_review,
      },
      mergedThisWeek: row.merged_this_week,
      mergedPriorWeek: row.merged_prior_week,
      interventionsThisWeek: row.interventions_this_week,
      mergedOverRateWindow: row.merged_over_rate_window,
      closedOverRateWindow: row.closed_over_rate_window,
      avgCycleSeconds: row.avg_cycle_seconds,
      mergedSinceMorning: row.merged_since_morning,
    };
  }

  /**
   * The runs in flight, in the order the *Active loops* card draws them.
   *
   * **Lifecycle order, then longest-running first.** `array_position` ranks a row by where
   * its status sits in {@link ACTIVE_RUN_STATUSES}, so the card reads down the pipeline —
   * coding, building, review — rather than in whatever order the rows were written; within
   * one stage the oldest is first, because the run that has been in a stage longest is the
   * one somebody wants to see. `id` breaks the remaining tie, so two runs started in the same
   * millisecond do not swap places between polls and change the payload for no reason.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns At most {@link ACTIVE_RUNS_LIMIT} rows.
   */
  async activeRuns(organizationId: string): Promise<Run[]> {
    return this.database.db
      .selectFrom("runs")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("status", "in", [...ACTIVE_RUN_STATUSES])
      .orderBy(sql<number>`array_position(${[...ACTIVE_RUN_STATUSES]}::text[], status)`)
      .orderBy("started_at", "asc")
      .orderBy("id", "asc")
      .limit(ACTIVE_RUNS_LIMIT)
      .execute();
  }

  /**
   * The runs that have stopped, newest first — the *Recently closed by the loop* card.
   *
   * Ordered on `finished_at`, which is `runs_organization_finished_at_idx`'s own order, and
   * filtered on it being present rather than on the three terminal statuses: V008's
   * `runs_terminal_finished_at` makes those the same set, and asking the shorter question
   * lets the index answer it.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns At most {@link RECENT_RUNS_LIMIT} rows.
   */
  async recentRuns(organizationId: string): Promise<Run[]> {
    return this.database.db
      .selectFrom("runs")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("finished_at", "is not", null)
      .orderBy("finished_at", "desc")
      .orderBy("id", "asc")
      .limit(RECENT_RUNS_LIMIT)
      .execute();
  }

  /**
   * How much is queued, and how long it is expected to take.
   *
   * `sum(est_minutes)` skips the nulls without being asked, which is the behaviour the
   * nullable column exists for: an item nobody has sized yet contributes to the count and
   * not to the total. `coalesce` covers the empty queue, where the sum itself is null.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns The count and the total. Zeros for a workspace with nothing queued.
   */
  async queueTotals(organizationId: string): Promise<QueueTotals> {
    return this.database.db
      .selectFrom("queue_items")
      .where("organization_id", "=", organizationId)
      .select([
        sql<number>`count(*)::int`.as("count"),
        sql<number>`coalesce(sum(est_minutes), 0)::int`.as("estMinutes"),
      ])
      .executeTakeFirstOrThrow();
  }

  /**
   * The head of the queue, in queue order.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns At most {@link QUEUE_HEAD_LIMIT} rows, position 1 first.
   */
  async queueHead(organizationId: string): Promise<QueueItem[]> {
    return this.database.db
      .selectFrom("queue_items")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .orderBy("position", "asc")
      .limit(QUEUE_HEAD_LIMIT)
      .execute();
  }

  /**
   * The day's token spend, read through `token_usage_daily`.
   *
   * The view rather than the ledger, because the view is what fixes the day to **UTC** —
   * "so that the same ledger yields the same days to every caller" (V010) — and a second
   * opinion about where a day starts is exactly the kind of nearly-agreeing pair that makes
   * a stat row disagree with the sentence above it.
   *
   * **The day is compared as text cast to `date`, deliberately.** `pg` parses a `date`
   * column into a `Date` at the *process's* local midnight, so a `Date` computed in UTC and
   * handed to this predicate would select the wrong day on any machine whose `TZ` is not
   * UTC — silently, and only for part of the day. `windows.ts` produces the `YYYY-MM-DD`
   * string that has no such opinion.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param day - The UTC calendar day, `YYYY-MM-DD`.
   * @returns The totals. A day with no events is zeros and no providers.
   */
  async tokenTotals(organizationId: string, day: string): Promise<TokenTotals> {
    return this.database.db
      .selectFrom("token_usage_daily")
      .where("organization_id", "=", organizationId)
      .where("day", "=", sql<Date>`${day}::date`)
      .select([
        // A `bigint` and a `numeric` are handed back as text and stay text until the service
        // converts them once — see this file's header on where a cast belongs.
        sql<string>`coalesce(sum(tokens_total), 0)::bigint::text`.as("tokens"),
        sql<string>`coalesce(sum(cost_cents), 0)::numeric(14, 4)::text`.as("costCents"),
        sql<number>`count(distinct provider)::int`.as("providers"),
        sql<number>`coalesce(sum(unpriced_events), 0)::int`.as("unpricedEvents"),
      ])
      .executeTakeFirstOrThrow();
  }

  /**
   * Whether this workspace merges on green checks without asking.
   *
   * Read through `workspace_settings_effective`, which answers for a workspace that has
   * never written a settings row — the read half of V011's lazy-creation decision, and the
   * reason this cannot return `undefined` for a workspace that exists.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns The switch's position, or `false` for a workspace the view has no row for at
   *   all. The tenant guard has already established that the workspace exists, so the
   *   fallback is unreachable through the pipeline; it is here because a setting the
   *   dashboard could not read must read as *off* rather than as *on*, and the safe default
   *   for "merge without review" is never yes.
   */
  async autoMerge(organizationId: string): Promise<boolean> {
    const row = await this.database.db
      .selectFrom("workspace_settings_effective")
      .select("auto_merge_on_checks")
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();

    return row?.auto_merge_on_checks ?? false;
  }
}
