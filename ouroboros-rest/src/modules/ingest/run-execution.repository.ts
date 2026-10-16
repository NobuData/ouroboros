/**
 * The statements behind #160's execution routes and the run supervisor.
 *
 * Every write here runs inside a transaction that already holds the run's lock
 * (`IngestRepository.lockRun`), so the epoch a statement reads is the epoch it commits under —
 * `ingest.fence.ts` is where that argument is made.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Kysely } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { Database, QueueEffort, Run, RunStatus } from "../db/schema";
import type { Writer } from "./ingest.repository";

/** The two statuses a run executes in (#160). */
export const EXECUTABLE_RUN_STATUSES = [
  "coding",
  "building",
] as const satisfies readonly RunStatus[];

/** The effort a requeued item carries when the issue was never estimated — the middle chip. */
export const REQUEUE_FALLBACK_EFFORT: QueueEffort = "m";

/** The run's repository, as the start answers it. */
export interface RunRepositoryFacts {
  /** `github_repos.id`. */
  readonly id: string;
  /** `owner/name`. */
  readonly slug: string;
  /** The bare name. */
  readonly name: string;
  /** The default branch, when known. */
  readonly defaultBranch: string | null;
}

/** What the run's canonical ticket says, as the start answers it. */
export interface RunTicketFacts {
  /** The ticket's body, or `null`. */
  readonly body: string | null;
  /** The ticket's labels; empty when it has none or no source mirrored it. */
  readonly labels: readonly string[];
}

/** A queue row a `back_to_queue` finish writes. */
export interface RequeuedItem {
  /** `queue_items.id`, or `null` when the issue is already queued and keeps that item. */
  readonly id: string | null;
}

@Injectable()
export class RunExecutionRepository {
  /** @param database - The tenancy database. */
  constructor(private readonly database: DatabaseService) {}

  /** The connection, for reads outside a transaction. */
  get db(): Kysely<Database> {
    return this.database.db;
  }

  /**
   * Start the run: raise its epoch, name the worker, stamp the heartbeat, and give it a branch
   * when it has none — `ouro/run-<id>-<issue>`.
   *
   * @param writer - The start's transaction, holding the run's lock.
   * @param run - The run.
   * @param worker - The worker starting it.
   * @returns The run as it now stands.
   */
  async start(writer: Writer, run: string, worker: string): Promise<Run> {
    return writer
      .updateTable("runs")
      .set({
        exec_epoch: sql<number>`exec_epoch + 1`,
        exec_worker: worker,
        exec_heartbeat_at: sql<Date>`now()`,
        branch_name: sql<string>`coalesce(branch_name, 'ouro/run-' || id || '-' || issue_number)`,
      })
      .where("id", "=", run)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Record that the worker holding the epoch is still executing. Moves only
   * `exec_heartbeat_at`, which V147's touch trigger leaves out of `updated_at`.
   *
   * @param writer - The transaction, holding the run's lock.
   * @param run - The run.
   * @returns When the heartbeat was stamped — the database's clock.
   */
  async heartbeat(writer: Writer, run: string): Promise<Date> {
    const row = await writer
      .updateTable("runs")
      .set({ exec_heartbeat_at: sql<Date>`now()` })
      .where("id", "=", run)
      .returning("exec_heartbeat_at")
      .executeTakeFirstOrThrow();

    return row.exec_heartbeat_at ?? new Date();
  }

  /**
   * Save the interpreter's state, refresh the heartbeat, and set the base commit when it is not
   * set yet.
   *
   * @param writer - The transaction, holding the run's lock.
   * @param run - The run.
   * @param state - The interpreter's opaque state.
   * @param baseCommit - The base commit to set, or `undefined` to leave it as it is. The caller
   *   has already refused one that differs from a commit already set.
   * @returns When the checkpoint was written — the database's clock.
   */
  async checkpoint(
    writer: Writer,
    run: string,
    state: Record<string, unknown>,
    baseCommit: string | undefined,
  ): Promise<Date> {
    const row = await writer
      .updateTable("runs")
      .set({
        exec_checkpoint: state,
        exec_checkpoint_at: sql<Date>`now()`,
        exec_heartbeat_at: sql<Date>`now()`,
        ...(baseCommit === undefined ? {} : { exec_base_commit: baseCommit }),
      })
      .where("id", "=", run)
      .returning("exec_checkpoint_at")
      .executeTakeFirstOrThrow();

    return row.exec_checkpoint_at ?? new Date();
  }

  /**
   * Move the run to where its terminal sends it. A resting status stamps `finished_at`;
   * `review` is still in flight and leaves it null (V008's `runs_finished_iff_terminal`).
   *
   * @param writer - The transaction, holding the run's lock.
   * @param run - The run.
   * @param status - `review`, `needs_human` or `failed`.
   */
  async finish(
    writer: Writer,
    run: string,
    status: Extract<RunStatus, "review" | "needs_human" | "failed">,
  ): Promise<void> {
    await writer
      .updateTable("runs")
      .set({
        status,
        ...(status === "review" ? {} : { finished_at: sql<Date>`now()` }),
      })
      .where("id", "=", run)
      .execute();
  }

  /**
   * Write the finish's reason onto the transcript as the store's own line (`system`), since
   * `runs` has no reason column. Stage-less, because V046 pairs a stage with an attempt and the
   * finish names no attempt; the stage it ended at goes in the payload.
   *
   * @param writer - The transaction, holding the run's lock.
   * @param run - The run.
   * @param reason - Why the run ended.
   * @param payload - The outcome and the stage, for a reader that wants them structured.
   */
  async appendFinishEvent(
    writer: Writer,
    run: string,
    reason: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await writer
      .insertInto("run_events")
      .values({
        run_id: run,
        actor: "system",
        stage_key: null,
        attempt: null,
        tool_tag: null,
        model_id: null,
        body: reason,
        payload,
      })
      .execute();
  }

  /**
   * The run's repository — read whether or not it is still enabled, because a run already
   * admitted keeps executing against the repository it was opened for.
   *
   * @param writer - The connection.
   * @param run - The run.
   * @returns The repository, or `undefined` when it is not in the run's workspace any more.
   */
  async repositoryOf(
    writer: Writer,
    run: Pick<Run, "organization_id" | "github_repo_id">,
  ): Promise<RunRepositoryFacts | undefined> {
    const row = await writer
      .selectFrom("github_repos")
      .innerJoin("github_orgs", "github_orgs.id", "github_repos.org_id")
      .select([
        "github_repos.id as id",
        "github_orgs.login as login",
        "github_repos.name as name",
        "github_repos.default_branch as defaultBranch",
      ])
      .where("github_repos.id", "=", run.github_repo_id)
      .where("github_orgs.organization_id", "=", run.organization_id)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : {
          id: row.id,
          slug: `${row.login}/${row.name}`,
          name: row.name,
          defaultBranch: row.defaultBranch,
        };
  }

  /**
   * The issue's body and labels, as the canonical ticket holds them — the GitHub-sourced ticket
   * mirroring the run's repository and issue number, the same match the queue claim names its
   * ticket by.
   *
   * @param writer - The connection.
   * @param run - The run.
   * @returns The body (`null` when the ticket has none) and the labels; `null` and `[]` when no
   *   source has mirrored the issue.
   */
  async ticketOf(
    writer: Writer,
    run: Pick<Run, "organization_id" | "github_repo_id" | "issue_number">,
  ): Promise<RunTicketFacts> {
    const row = await writer
      .selectFrom("tickets")
      .innerJoin("ticket_sources", "ticket_sources.id", "tickets.source_id")
      .innerJoin("github_repos", (join) => join.on("github_repos.id", "=", run.github_repo_id))
      .innerJoin("github_orgs", "github_orgs.id", "github_repos.org_id")
      .select(["tickets.body", "tickets.labels"])
      .where("tickets.organization_id", "=", run.organization_id)
      .where("github_orgs.organization_id", "=", run.organization_id)
      .where("ticket_sources.kind", "=", "github")
      .where("tickets.external_id", "=", String(run.issue_number))
      .where(
        sql<boolean>`lower(${sql.ref("tickets.meta")}->'github'->>'owner') = lower(${sql.ref("github_orgs.login")})`,
      )
      .where(
        sql<boolean>`lower(${sql.ref("tickets.meta")}->'github'->>'repo') = lower(${sql.ref("github_repos.name")})`,
      )
      .orderBy("tickets.created_at")
      .orderBy("tickets.id")
      .limit(1)
      .executeTakeFirst();

    return { body: row?.body ?? null, labels: row?.labels ?? [] };
  }

  /**
   * The issue's current size estimate — its latest `issue_estimates` version, the effort chip
   * the backlog and the queue show.
   *
   * @param writer - The connection.
   * @param run - The run.
   * @returns The effort and the estimated minutes, or `undefined` when the issue was never sized.
   */
  async latestEstimate(
    writer: Writer,
    run: Pick<Run, "organization_id" | "github_repo_id" | "issue_number">,
  ): Promise<{ effort: QueueEffort; estMinutes: number | null } | undefined> {
    return writer
      .selectFrom("issue_estimates")
      .innerJoin("github_issues", "github_issues.id", "issue_estimates.github_issue_id")
      .select([
        "issue_estimates.effort as effort",
        sql<number | null>`(${sql.ref("issue_estimates.breakdown")}->>'est_minutes')::int`.as(
          "estMinutes",
        ),
      ])
      .where("github_issues.organization_id", "=", run.organization_id)
      .where("github_issues.github_repo_id", "=", run.github_repo_id)
      .where("github_issues.number", "=", run.issue_number)
      .orderBy("issue_estimates.version", "desc")
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * Put the run's issue back at the tail of its workspace's queue — **unconfirmed**, so a
   * person confirms it again before another live run takes it (#1312, decision L5).
   *
   * The item carries the run's repository, issue, title, workflow pin and playbook; its effort
   * and estimate come from the issue's latest estimate, or {@link REQUEUE_FALLBACK_EFFORT} and no
   * estimate when it was never estimated. An issue already queued keeps the item it has
   * (`queue_items_organization_issue_key`): nothing is written and the answer is `null`.
   *
   * @param writer - The finish's transaction.
   * @param run - The run.
   * @returns The new item's id, or `null` when the issue was already queued.
   */
  async requeue(writer: Writer, run: Run): Promise<RequeuedItem> {
    const estimate = await this.latestEstimate(writer, run);

    const tail = await writer
      .selectFrom("queue_items")
      .select(({ fn }) => fn.max<number>("position").as("last"))
      .where("organization_id", "=", run.organization_id)
      .executeTakeFirst();

    const row = await writer
      .insertInto("queue_items")
      .values({
        organization_id: run.organization_id,
        github_repo_id: run.github_repo_id,
        issue_number: run.issue_number,
        issue_title: run.issue_title,
        effort: estimate?.effort ?? REQUEUE_FALLBACK_EFFORT,
        workflow_tag: run.workflow_tag,
        workflow_version: run.workflow_version_pin,
        // The run's own pin, carried forward as an explicit choice rather than re-resolved.
        workflow_pin_reason: run.workflow_version_pin === null ? null : "explicit",
        position: (tail?.last ?? 0) + 1,
        est_minutes: estimate?.estMinutes ?? null,
        playbook_id: run.playbook_id,
      })
      .onConflict((conflict) => conflict.columns(["organization_id", "issue_number"]).doNothing())
      .returning("id")
      .executeTakeFirst();

    return { id: row?.id ?? null };
  }

  /**
   * Live runs whose executor went quiet — the supervisor's first read (#160).
   *
   * A run in `coding`/`building` is stale when a worker started it and its heartbeat is older
   * than `staleBefore`, or when nothing ever started it (`exec_epoch = 0`) and it opened before
   * `staleBefore`.
   *
   * @param staleBefore - The instant a heartbeat (or an opening) must be newer than.
   * @returns The runs' ids, oldest first.
   */
  async staleRuns(staleBefore: Date): Promise<string[]> {
    const rows = await this.database.db
      .selectFrom("runs")
      .select("id")
      .where("origin", "=", "live")
      .where("status", "in", EXECUTABLE_RUN_STATUSES)
      .where((eb) =>
        eb.or([
          eb.and([eb("exec_epoch", ">", 0), eb("exec_heartbeat_at", "<", staleBefore)]),
          eb.and([eb("exec_epoch", "=", 0), eb("started_at", "<", staleBefore)]),
        ]),
      )
      .orderBy("started_at")
      .orderBy("id")
      .execute();

    return rows.map((row) => row.id);
  }

  /**
   * Workspaces with something `/internal/queue/claim` might lease — the supervisor's second read.
   *
   * A cheap superset of what admission admits: an item nobody holds (or whose lease ran out)
   * that a person has confirmed (#1312), in a workspace that is not paused or pending deletion
   * (#489). The claim re-checks everything, so a workspace listed here and refused there costs
   * one call.
   *
   * @param now - The instant a lease is judged against.
   * @returns The workspaces' ids.
   */
  async claimableWorkspaces(now: Date): Promise<string[]> {
    const rows = await this.database.db
      .selectFrom("queue_items")
      .select("queue_items.organization_id")
      .distinct()
      .where("queue_items.confirmed_at", "is not", null)
      .where((eb) =>
        eb.or([
          eb("queue_items.claim_expires_at", "is", null),
          eb("queue_items.claim_expires_at", "<=", now),
        ]),
      )
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom("workspace_lifecycle")
              .select("workspace_lifecycle.organization_id")
              .whereRef("workspace_lifecycle.organization_id", "=", "queue_items.organization_id")
              .where("workspace_lifecycle.state", "<>", "active"),
          ),
        ),
      )
      .orderBy("queue_items.organization_id")
      .execute();

    return rows.map((row) => row.organization_id);
  }
}
