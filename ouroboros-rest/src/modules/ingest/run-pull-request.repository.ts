/**
 * The rows the draft pull-request publisher reads and the link it writes (DI.3,
 * [#1311](https://github.com/NobuData/ouroboros/issues/1311)).
 *
 * Reads: the PR already linked to the run (the idempotent path), whether DI.2 recorded a
 * successful push of the run's branch, the git-host source that mirrors the run's issue, and the
 * stage history and latest farm job the body is composed from. Write: the link — the PR's
 * `run_id`, `ticket_id` and `draft`, and the run's `pr_number` — inside the receipt's transaction.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { RUN_BRANCH_PUSHED_EVENT } from "../audit/audit.events";
import type { Run, TicketSourceKind } from "../db/schema";
import type { Writer } from "./ingest.repository";
import type { PullRequestBodyBuild, PullRequestBodyStage } from "./run-pull-request.body";

/** A PR the run is already linked to. */
export interface LinkedPullRequest {
  /** `pull_requests.id`. */
  readonly id: string;
  /** The host's number. */
  readonly number: number;
  /** The PR's page. */
  readonly url: string;
}

/** The canonical ticket a run works on, and the git-host source that mirrors it. */
export interface RunTicketSource {
  /** `tickets.id`. */
  readonly ticketId: string;
  /** `ticket_sources.id` — the source a PR for this issue is opened through. */
  readonly sourceId: string;
  /** `ticket_sources.kind` — which provider opens the PR. */
  readonly kind: TicketSourceKind;
}

/** What the link writes. */
export interface PullRequestLink {
  /** The run. */
  readonly run: Pick<Run, "id" | "organization_id">;
  /** The mirror row the sync wrote. */
  readonly prId: string;
  /** The host's number — `runs.pr_number`. */
  readonly number: number;
  /** The canonical ticket — `pull_requests.ticket_id`. */
  readonly ticketId: string;
}

@Injectable()
export class RunPullRequestRepository {
  /**
   * The PR this run is linked to, if any — `pull_requests.run_id`.
   *
   * @param writer - The connection or the open transaction.
   * @param run - The run.
   * @returns The PR, or `undefined`. A run has at most one: the publisher links one and finds it
   *   on every later request.
   */
  async linked(
    writer: Writer,
    run: Pick<Run, "id" | "organization_id">,
  ): Promise<LinkedPullRequest | undefined> {
    const row = await writer
      .selectFrom("pull_requests")
      .select(["id", "external_number", "external_url"])
      .where("organization_id", "=", run.organization_id)
      .where("run_id", "=", run.id)
      .orderBy("created_at")
      .orderBy("id")
      .limit(1)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : { id: row.id, number: row.external_number, url: row.external_url };
  }

  /**
   * Whether DI.2 recorded a successful push of the run's branch — a `run.branch_pushed` audit row
   * with outcome `pushed`, the push-result record `POST …/push/result` writes (#1310).
   *
   * @param writer - The connection or the open transaction.
   * @param run - The run.
   * @returns True when at least one push of the run's branch reached the host.
   */
  async pushed(writer: Writer, run: Pick<Run, "id" | "organization_id">): Promise<boolean> {
    const row = await writer
      .selectFrom("audit_events")
      .select(sql<number>`1`.as("one"))
      .where("organization_id", "=", run.organization_id)
      .where("action", "=", RUN_BRANCH_PUSHED_EVENT)
      .where("subject_type", "=", "run")
      .where("subject_id", "=", run.id)
      .where(sql<boolean>`${sql.ref("detail")}->>'outcome' = 'pushed'`)
      .limit(1)
      .executeTakeFirst();

    return row !== undefined;
  }

  /**
   * The canonical ticket the run works on and the GitHub source that mirrors it — the same match
   * `RunExecutionRepository.ticketOf` names the run's ticket by (the source's kind is `github`,
   * the issue number and the repository's owner and name agree), keeping the source.
   *
   * @param writer - The connection or the open transaction.
   * @param run - The run.
   * @returns The ticket and its source, or `undefined` when no GitHub source mirrors the issue.
   */
  async ticketSource(
    writer: Writer,
    run: Pick<Run, "organization_id" | "github_repo_id" | "issue_number">,
  ): Promise<RunTicketSource | undefined> {
    const row = await writer
      .selectFrom("tickets")
      .innerJoin("ticket_sources", "ticket_sources.id", "tickets.source_id")
      .innerJoin("github_repos", (join) => join.on("github_repos.id", "=", run.github_repo_id))
      .innerJoin("github_orgs", "github_orgs.id", "github_repos.org_id")
      .select(["tickets.id as ticket_id", "ticket_sources.id as source_id", "ticket_sources.kind"])
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

    return row === undefined
      ? undefined
      : { ticketId: row.ticket_id, sourceId: row.source_id, kind: row.kind };
  }

  /**
   * Every stage attempt the run recorded — the body's summary.
   *
   * @param writer - The connection or the open transaction.
   * @param run - The run's id.
   * @returns The attempts, by position then attempt.
   */
  async stages(writer: Writer, run: string): Promise<PullRequestBodyStage[]> {
    const rows = await writer
      .selectFrom("run_stages")
      .select([
        "stage_key",
        "stage_label",
        "position",
        "attempt",
        "status",
        "returned_from_stage_key",
        "return_reason",
      ])
      .where("run_id", "=", run)
      .orderBy("position")
      .orderBy("attempt")
      .execute();

    return rows.map((row) => ({
      stageKey: row.stage_key,
      label: row.stage_label,
      position: row.position,
      attempt: row.attempt,
      status: row.status,
      returnedFromStageKey: row.returned_from_stage_key,
      returnReason: row.return_reason,
    }));
  }

  /**
   * The run's latest farm job — one recorded against the run (`build_jobs.run_id`) or the one it
   * reserved (`runs.reserved_build_job_id`) — with its pool's name.
   *
   * @param writer - The connection or the open transaction.
   * @param run - The run.
   * @returns The job, or `null` when none ran.
   */
  async latestBuild(
    writer: Writer,
    run: Pick<Run, "id" | "organization_id" | "reserved_build_job_id">,
  ): Promise<PullRequestBodyBuild | null> {
    const row = await writer
      .selectFrom("build_jobs as j")
      .innerJoin("runner_pools as p", "p.id", "j.pool_id")
      .select(["j.number", "p.name as pool", "j.status", "j.exit_code"])
      .where("j.organization_id", "=", run.organization_id)
      .where((eb) =>
        run.reserved_build_job_id === null
          ? eb("j.run_id", "=", run.id)
          : eb.or([eb("j.run_id", "=", run.id), eb("j.id", "=", run.reserved_build_job_id)]),
      )
      .orderBy("j.queued_at", "desc")
      .orderBy("j.number", "desc")
      .limit(1)
      .executeTakeFirst();

    return row === undefined
      ? null
      : { number: row.number, pool: row.pool, status: row.status, exitCode: row.exit_code };
  }

  /**
   * Link the PR to the run: the PR's run, ticket and draft flag, and the run's PR number — the
   * caller's transaction, beside the receipt.
   *
   * @param trx - The open transaction.
   * @param link - The run, the PR, its number and the ticket.
   */
  async link(trx: Writer, link: PullRequestLink): Promise<void> {
    await trx
      .updateTable("pull_requests")
      .set({ run_id: link.run.id, ticket_id: link.ticketId, draft: true })
      .where("id", "=", link.prId)
      .where("organization_id", "=", link.run.organization_id)
      .execute();

    await trx
      .updateTable("runs")
      .set({ pr_number: link.number })
      .where("id", "=", link.run.id)
      .where("organization_id", "=", link.run.organization_id)
      .execute();
  }
}
