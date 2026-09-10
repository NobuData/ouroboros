/**
 * Every statement the estimation pipeline issues — the claim, the versioned write, and the
 * read that finds a row nothing is estimating.
 *
 * L.3 ([#107](https://github.com/NobuData/ouroboros/issues/107)).
 *
 * ## The reads are unscoped, for `backlog-sync.repository.ts`'s reason
 *
 * {@link EstimationRepository.staleIssues} takes no workspace. Every repository serving a
 * *request* takes an `organizationId` first, because the caller is a person; this module's
 * callers are a timer and a committed transaction, and the work is *every* workspace's
 * stranded rows. What keeps it safe is written into the statements: they select no credential,
 * they answer nobody, and the workspace each row belongs to travels with it so that the
 * routing resolution the orchestrator then performs is scoped to the right one.
 *
 * {@link EstimationRepository.claim} and {@link EstimationRepository.persist} are addressed by
 * `github_issues.id`, which is a uuid the caller got from one of those reads or from the sync's
 * own handoff. There is nothing to scope: the id *is* the scope.
 *
 * ## The write is one transaction, and the version is guessed rather than assigned
 *
 * {@link EstimationRepository.persist} inserts the estimate and moves the issue's status
 * together, so the acceptance criterion *"every persisted estimate carries non-null trace
 * provenance"* is never observed half-true — there is no instant in which an issue reads
 * `sized` and its newest estimate is the previous one.
 *
 * The version is `max(version) + 1`, computed inside that transaction, and V026 is emphatic
 * about why it is not a default: *"a default of `max(version) + 1` would read as a convenience
 * and would hide the one case a writer must handle — two callers re-estimating the same issue
 * at once, which resolves as a unique violation on the key above and is a retry rather than a
 * corruption."* So this file does exactly that. It computes the number it wants, and a second
 * writer that got there first is a `23505` on `issue_estimates_issue_version_key` that
 * {@link EstimationRepository.persist} retries — which is the acceptance criterion *"concurrent
 * estimation of the same issue produces sequential versions with no deadlock"*, answered by the
 * database's own guarantee rather than by a lock this service takes.
 *
 * **No `select … for update`, deliberately.** Locking the issue row would serialise the whole
 * estimate — engine call included — behind whoever got the row first, and would put a lock
 * across a network hop, which is how a deadlock is built rather than avoided. The unique key
 * already refuses the only outcome worth refusing, and it does it without holding anything.
 *
 * ## Nothing here decides anything
 *
 * The floor, the translation and the failure policy are `estimation.outcome.ts`'s and
 * `estimation.orchestrator.ts`'s. This file holds statements, which is what makes
 * `estimation.repository.spec.ts` able to assert the SQL — where a missing `where` shows up —
 * without a server.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";

import { UNIQUE_VIOLATION, isDatabaseFailure } from "../tenancy/constraints";
import { DatabaseService } from "../db/db.service";
import type { Database, NewIssueEstimate, SizingStatus } from "../db/schema";
import type { EstimatedStatus } from "./estimation.outcome";

/**
 * The constraint two writers racing the same issue collide on.
 *
 * Named from the migration rather than matched loosely, so a renamed constraint fails this
 * lookup — and therefore stops being retried — instead of quietly changing what is retried.
 */
export const VERSION_CONSTRAINT = "issue_estimates_issue_version_key";

/**
 * How many times a version collision is recomputed before giving up.
 *
 * Each attempt reads the highest version and writes the next one, so an attempt only fails if
 * *another* writer committed in the window between the two — and every failure means somebody
 * else's version landed, which moves the count forward. Five is far past any real contention:
 * it would take five other writers finishing inside one transaction's window, on one issue.
 * Beyond that, the honest answer is that something is wrong, and a bounded loop says so where
 * an unbounded one would spin.
 */
export const MAX_VERSION_ATTEMPTS = 5;

/** One issue, with everything the estimation request is built from. */
export interface EstimableIssueRow {
  /** `github_issues.id` — what an estimate is versioned against. */
  readonly issueId: string;
  /** The workspace, so the routing resolution behind `model_defaults` is scoped correctly. */
  readonly organizationId: string;
  /** The issue number within its repository — GitHub's, and what the engine is told. */
  readonly number: number;
  /** The title, as GitHub currently has it. */
  readonly title: string;
  /** The description in full, or null for an issue opened without one. */
  readonly body: string | null;
  /** GitHub's label names — the heuristic estimator's strongest signal. */
  readonly labels: string[];
  /** `owner/name`, assembled from `github_orgs.login` and `github_repos.name`. */
  readonly repo: string;
  /** Where the issue is in the pipeline right now. */
  readonly sizingStatus: SizingStatus;
}

@Injectable()
export class EstimationRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's lifecycle
   *   belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Read one issue and everything an estimation request needs.
   *
   * @param issueId - `github_issues.id`.
   * @returns The issue, or `undefined` when the row is gone — which is an ordinary outcome
   *   rather than an error: the sync hands work over after its transaction commits, and a
   *   repository that left scope in between takes its issues with it (`on delete cascade`).
   */
  async issue(issueId: string): Promise<EstimableIssueRow | undefined> {
    return this.estimable().where("github_issues.id", "=", issueId).executeTakeFirst();
  }

  /**
   * Read one issue **in this workspace**, and everything an estimation request needs.
   *
   * L.4 ([#108](https://github.com/NobuData/ouroboros/issues/108))'s read. The workspace is a
   * predicate in the statement rather than a comparison the caller makes afterwards, which is
   * this service's rule for every tenant-scoped read: an id belonging to another workspace
   * returns nothing here, and *nothing* is what the caller answers `404` to — never a `403`,
   * which would confirm that the id names a real issue somewhere.
   *
   * Unscoped {@link issue} stays beside it and is the pipeline's own: the orchestrator is
   * driven by a queue, a sweep and a committed transaction — none of which has a workspace to
   * be scoped to — and re-reading the row when the work starts is what makes a minute in the
   * queue safe.
   *
   * @param organizationId - The workspace, established by the tenant guard.
   * @param issueId - `github_issues.id`.
   * @returns The issue, or `undefined` when this workspace has no such row.
   */
  async issueIn(organizationId: string, issueId: string): Promise<EstimableIssueRow | undefined> {
    return this.estimable()
      .where("github_issues.id", "=", issueId)
      .where("github_issues.organization_id", "=", organizationId)
      .executeTakeFirst();
  }

  /**
   * How many issues this workspace mirrors, and how many are already being estimated.
   *
   * What L.4's *Re-estimate all* reports its scope from, read **before** the claim below so
   * the two numbers describe the backlog the caller asked about rather than the one their own
   * request has just changed.
   *
   * @param organizationId - The workspace.
   * @returns The totals. A workspace that mirrors nothing answers zeros, which is a state to
   *   render rather than a failure.
   */
  async backlogCounts(organizationId: string): Promise<{ total: number; estimating: number }> {
    const row = await this.database.db
      .selectFrom("github_issues")
      .select(({ fn, eb }) => [
        fn.countAll<string>().as("total"),
        // `count(*) filter (where …)` in one pass rather than a second statement: the two
        // numbers have to describe the same instant, and two reads cannot promise that.
        fn
          .countAll<string>()
          .filterWhere(eb("sizing_status", "=", "estimating"))
          .as("estimating"),
      ])
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();

    // `count()` comes back as a string from `pg` — bigint is wider than a JS number, and the
    // driver refuses to lose that quietly. A backlog is not, so the cast is safe and stated.
    return { total: Number(row?.total ?? 0), estimating: Number(row?.estimating ?? 0) };
  }

  /**
   * Move every issue in this workspace that is **not** already `estimating` into `estimating`.
   *
   * L.4's fan-out, and the whole of its *"touches only non-`estimating` rows"* criterion: the
   * scope and the claim are **one statement**, so no row can be read as eligible and then
   * claimed by somebody else's request a moment later. `returning id` is what makes the count
   * a fact rather than an estimate of one.
   *
   * Deliberately *not* {@link claim} in a loop. A loop would be one round trip per issue and,
   * worse, a window between each read and its write in which a second *Re-estimate all* could
   * claim the same rows — which is the duplicate work this endpoint is guarded against.
   *
   * **Every mirrored issue, `closed` ones included**, which is L.4's scope as written — *only
   * non-`estimating` rows* and no other predicate. It is worth knowing rather than assuming:
   * `github_issues` keeps an issue that closed after it was mirrored, so a long-lived workspace
   * re-estimates some rows nobody is going to work on. Narrowing to `state = 'open'` would be
   * this file inventing a scope the ticket did not ask for, and it would take the estimate a
   * *reopened* issue arrives with; if the cost ever matters, the place to decide it is the
   * confirmation dialog's own count (N.1, [#115](https://github.com/NobuData/ouroboros/issues/115)),
   * which is what tells somebody how many issues they are about to size.
   *
   * @param organizationId - The workspace.
   * @returns The ids it claimed, which the caller then queues. Empty when everything is
   *   already in flight, which is the answer that makes a double-fire a `409` rather than a
   *   second fan-out.
   */
  async claimBacklog(organizationId: string): Promise<string[]> {
    const rows = await this.database.db
      .updateTable("github_issues")
      .set({ sizing_status: "estimating" })
      .where("organization_id", "=", organizationId)
      .where("sizing_status", "!=", "estimating")
      .returning("id")
      .execute();

    return rows.map((row) => row.id);
  }

  /**
   * The issue read every estimation request is built from, without a `where` yet.
   *
   * The shared half of {@link issue} and {@link issueIn}, so *what an estimate is built from*
   * is answered in one place and the two reads cannot drift into disagreeing about it.
   *
   * @returns The select, ready for the predicate that scopes it.
   */
  private estimable() {
    return this.database.db
      .selectFrom("github_issues")
      .innerJoin("github_repos", "github_repos.id", "github_issues.github_repo_id")
      .innerJoin("github_orgs", "github_orgs.id", "github_repos.org_id")
      .select([
        "github_issues.id as issueId",
        "github_issues.organization_id as organizationId",
        "github_issues.number as number",
        "github_issues.title as title",
        "github_issues.body as body",
        "github_issues.labels as labels",
        "github_issues.sizing_status as sizingStatus",
        // `owner/name`, which is the one shape the L.1 contract's `issue.repo` accepts. Built
        // in the statement rather than in TypeScript so the read is one round trip and the
        // mapping has nowhere else to live.
        sql<string>`${sql.ref("github_orgs.login")} || '/' || ${sql.ref("github_repos.name")}`.as(
          "repo",
        ),
      ]);
  }

  /**
   * Move an issue into `estimating`.
   *
   * Unconditional on the current status, and that is the decision this method is: the sweep's
   * whole purpose is to re-claim rows that are *already* `estimating`, so a claim that refused
   * one would make recovery impossible. What stops two workers estimating the same issue at
   * once is {@link EstimationQueue}'s dedupe within a process and — across processes — the
   * versioned insert, which cannot produce two rows for one version.
   *
   * It moves `updated_at` through V014's `github_issues_touch_updated_at` trigger, which is
   * exactly what {@link staleIssues} then measures the claim's age by.
   *
   * @param issueId - `github_issues.id`.
   * @returns `true` when a row was claimed, `false` when the issue no longer exists — see
   *   {@link issue} on why that is ordinary.
   */
  async claim(issueId: string): Promise<boolean> {
    const result = await this.database.db
      .updateTable("github_issues")
      .set({ sizing_status: "estimating" })
      .where("id", "=", issueId)
      .executeTakeFirst();

    return result.numUpdatedRows > 0n;
  }

  /**
   * Store one estimate and move the issue with it, in one transaction.
   *
   * @param issueId - `github_issues.id`.
   * @param status - What the issue becomes: `sized`, or `needs_human` for an estimate under
   *   the floor. Decided by `estimation.outcome.ts`, never here.
   * @param build - Turns a version number into the row to insert. A function rather than a
   *   row, because the version is only known inside the transaction and a retry needs a
   *   *different* one — see this file's header.
   * @returns The version that was written.
   * @throws Whatever the database refused, once the retries are spent. A check violation is
   *   an estimator producing something V026 forbids, and it reaches the orchestrator as a
   *   failure — which is the honest outcome, because there is no estimate to show.
   */
  async persist(
    issueId: string,
    status: EstimatedStatus,
    build: (version: number) => NewIssueEstimate,
  ): Promise<number> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.database.transaction(async (trx) => {
          const version = await this.nextVersion(trx, issueId);

          await trx.insertInto("issue_estimates").values(build(version)).execute();

          await trx
            .updateTable("github_issues")
            .set({ sizing_status: status })
            .where("id", "=", issueId)
            .execute();

          return version;
        });
      } catch (error) {
        if (attempt >= MAX_VERSION_ATTEMPTS || !isVersionCollision(error)) {
          throw error;
        }
      }
    }
  }

  /**
   * Move an issue to a terminal status without writing an estimate.
   *
   * The failure path, and the one write in this module that stores no row. There is
   * deliberately no fabricated `issue_estimates` row behind it: the table has no nullable
   * effort and no *unknown*, so a failure row would render an effort chip on the backlog table
   * for an issue nothing sized. The failure itself is named in the service log by
   * `estimation.orchestrator.ts`, which is the only place that knows what actually went wrong.
   *
   * @param issueId - `github_issues.id`.
   * @param status - Where to leave it. `needs_human` for an issue the engine could not size;
   *   see the orchestrator for why nothing else is ever passed.
   * @returns `true` when a row was moved, `false` when the issue no longer exists.
   */
  async settle(issueId: string, status: EstimatedStatus): Promise<boolean> {
    const result = await this.database.db
      .updateTable("github_issues")
      .set({ sizing_status: status })
      .where("id", "=", issueId)
      .executeTakeFirst();

    return result.numUpdatedRows > 0n;
  }

  /**
   * The ids of every issue that has been `estimating` for too long, across every workspace.
   *
   * The recovery sweep's read, and the answer to *"no stuck rows"*. A process killed between
   * the claim and the write is the case it exists for: the row says `estimating`, no queue
   * holds it, and nothing else would ever look at it again.
   *
   * Age is measured on `updated_at`, which V014's unconditional touch trigger moved when
   * {@link claim} wrote the status — so it is the age of the *claim* rather than of the issue.
   *
   * **Ids and nothing else**, deliberately: re-queueing is all the sweep does, the queue
   * de-duplicates on the id alone, and {@link issue} re-reads the row when the work actually
   * starts — which it has to, because minutes may pass in the queue and the title, the labels
   * and the status may all have moved by then. Selecting the estimation payload here would be
   * two joins per sweep to fetch a copy that is thrown away.
   *
   * @param olderThan - The instant a claim has to predate to count as stale. The caller
   *   computes it from `OURO_ESTIMATION_STALE_SECONDS` against its own clock rather than this
   *   statement using `now()`, so a spec can state the boundary instead of waiting for it.
   * @param limit - Most rows to return. The sweep runs on a cadence and its queue de-duplicates
   *   what is already in flight, so a bounded batch that repeats beats an unbounded one that
   *   reads a whole backlog into memory to discover it is already working on it.
   * @returns The ids, oldest claim first — the row that has been stranded longest is the one
   *   somebody is most likely to be looking at.
   */
  async staleIssues(olderThan: Date, limit: number): Promise<string[]> {
    const rows = await this.database.db
      .selectFrom("github_issues")
      .select("id")
      .where("sizing_status", "=", "estimating")
      .where("updated_at", "<", olderThan)
      .orderBy("updated_at", "asc")
      .limit(limit)
      .execute();

    return rows.map((row) => row.id);
  }

  /**
   * The version this issue's next estimate should be.
   *
   * @param trx - The write's transaction. Read inside it, because a number read outside would
   *   be a number that was true a moment ago.
   * @param issueId - `github_issues.id`.
   * @returns `max(version) + 1`, or 1 for an issue with no estimate yet. Monotonic rather than
   *   dense is all V026 asks for — gaps are legal, and the only question asked of these
   *   numbers is which is largest.
   */
  private async nextVersion(trx: Transaction<Database>, issueId: string): Promise<number> {
    const row = await trx
      .selectFrom("issue_estimates")
      .select(({ fn }) => fn.max<number>("version").as("highest"))
      .where("github_issue_id", "=", issueId)
      .executeTakeFirst();

    // `max()` over no rows is a single row holding null, not an empty result — so both
    // fallbacks are reachable and neither is defensive: the first is an issue whose estimates
    // were all deleted with it, the second is the ordinary first estimate.
    return (row?.highest ?? 0) + 1;
  }
}

/**
 * Did another writer take this version first?
 *
 * @param error - Whatever the transaction rejected with.
 * @returns `true` only for a unique violation on {@link VERSION_CONSTRAINT}. Narrow on
 *   purpose: a check violation is an estimator producing something V026 forbids and would
 *   fail identically on every retry, and a foreign-key violation is an issue that was deleted
 *   mid-flight. Retrying either would turn a clear failure into a slow one.
 */
export function isVersionCollision(error: unknown): boolean {
  return (
    isDatabaseFailure(error) &&
    error.code === UNIQUE_VIOLATION &&
    error.constraint === VERSION_CONSTRAINT
  );
}
