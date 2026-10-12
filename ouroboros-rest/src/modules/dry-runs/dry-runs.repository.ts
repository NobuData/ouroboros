/**
 * The statements behind the dry-run orchestration (CD.4,
 * [#562](https://github.com/NobuData/ouroboros/issues/562)).
 *
 * V111's three tables — `dry_runs`, `dry_run_stages`, `dry_run_artifacts` — and the few rows of
 * other planes a dry run is made from: the workflow and its draft, the canonical ticket with the
 * repository it names, the workspace's cap, and the copilot replies a draft's spend guard is
 * recorded on.
 *
 * **Every read reachable from a request names the workspace**, so an id that is another
 * workspace's matches nothing and the service answers it with the same `404` as an id that names
 * nothing. The writes that advance a run name it by id alone: they are reached only through a
 * run this service already resolved.
 *
 * **Nothing here reads or writes the run plane** (decision W4). A dry run's cost is
 * `dry_runs.cost_cents` and nowhere else — the workspace's dry-run accounting is a sum over this
 * table ({@link DryRunsRepository.spend}), and no `runs`, `token_usage` or stage row is touched.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import {
  DRY_RUN_TERMINAL_STATUSES,
  SCHEMA_NAME,
  type CopilotToolTrace,
  type DryRun,
  type DryRunArtifact,
  type DryRunGuardAuditEntry,
  type DryRunStage,
  type DryRunStatus,
  type Workflow,
} from "../db/schema";
import type { EngineDryRunArtifact, EngineDryRunStage } from "../engine/engine.dryruns";
import type { ReplayPolicy } from "../replay-estimates/replay.estimate";
import type { Effort, SourceKind } from "../workflows/dsl.schema";

/** How many copilot replies a spend-guard lookup reads, newest first. */
export const GUARD_TRACE_WINDOW = 200;

/** How many candidates the picker ranks, at most — the newest-updated open, sized tickets. */
export const MAX_PICKER_CANDIDATES = 200;

/** The trackers a dry-run ticket may come from — the DSL's `source` vocabulary. */
const DRY_RUN_SOURCE_KINDS: readonly SourceKind[] = ["github", "gitlab", "jira", "linear"];

/** One canonical ticket, with what a dry run needs of it. */
export interface DryRunTicketRow {
  readonly id: string;
  readonly external_key: string;
  readonly external_url: string;
  readonly title: string;
  readonly body: string | null;
  readonly state: "open" | "closed";
  readonly labels: readonly string[];
  readonly source_updated_at: Date;
  /** `ticket_sources.kind`. */
  readonly source_kind: string;
  /** The effort of the estimate in force — the ticket's own, else its mirrored issue's. */
  readonly effort: Effort | null;
  /** The mirrored repository the ticket names (`meta.github`), or `null`s when there is none. */
  readonly repo_owner: string | null;
  readonly repo_name: string | null;
  readonly repo_default_branch: string | null;
}

/** What starting a dry run records. */
export interface NewDryRun {
  readonly organizationId: string;
  readonly workflowId: string;
  readonly baseVersion: number | null;
  readonly draftRev: number;
  readonly sessionId: string | null;
  readonly ticketId: string;
  readonly pinnedSha: string;
}

/** How a dry run ended. */
export interface DryRunEnding {
  readonly status: Exclude<DryRunStatus, "precheck" | "running">;
  readonly failureReason: string | null;
  /** The harness's own wall time, or `null` to measure from `started_at`. */
  readonly durationMs: number | null;
  readonly costCents: number | null;
  readonly tokens: number | null;
  readonly guardAudit: readonly DryRunGuardAuditEntry[];
}

/** A workspace's dry-run accounting for one workflow. */
export interface DryRunSpendRow {
  readonly runs: number;
  /** The sum of priced runs' cost, or `null` when none was priced. */
  readonly cost_cents: number | null;
  /** How many finished runs carry no price. */
  readonly unpriced: number;
}

/**
 * Whether a `ticket_sources.kind` is one a dry run can name.
 *
 * @param kind - The stored kind.
 * @returns `true` for the DSL's four trackers.
 */
export function isDryRunSource(kind: string): kind is SourceKind {
  return (DRY_RUN_SOURCE_KINDS as readonly string[]).includes(kind);
}

@Injectable()
export class DryRunsRepository {
  /** @param database - The typed connection; its pool's lifecycle is `DatabaseService`'s. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * A workflow, org-scoped.
   *
   * @param organizationId - The workspace.
   * @param id - The workflow.
   * @returns The row, or `undefined` when there is none this caller may see.
   */
  async workflow(organizationId: string, id: string): Promise<Workflow | undefined> {
    return this.database.db
      .selectFrom("workflows")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  /**
   * The stored draft's document.
   *
   * @param workflowId - A workflow already resolved through {@link workflow}.
   * @returns The definition, or `undefined` when the workflow has no draft open.
   */
  async draftDefinition(workflowId: string): Promise<unknown> {
    const row = await this.database.db
      .selectFrom("workflow_versions")
      .select("definition")
      .where("workflow_id", "=", workflowId)
      .where("version", "is", null)
      .executeTakeFirst();

    return row?.definition;
  }

  /**
   * One canonical ticket of this workspace, with its effort and the repository it names.
   *
   * @param organizationId - The workspace.
   * @param ticketId - `tickets.id`.
   * @returns The ticket, or `undefined` when the id names nothing this workspace holds.
   */
  async ticket(organizationId: string, ticketId: string): Promise<DryRunTicketRow | undefined> {
    const rows = await this.tickets(organizationId, sql`t.id = ${ticketId}::uuid`, 1);

    return rows[0];
  }

  /**
   * The picker's candidates: open, sized tickets from a tracker a trigger can name, the most
   * recently updated first.
   *
   * @param organizationId - The workspace.
   * @param limit - How many, at most {@link MAX_PICKER_CANDIDATES}.
   * @returns The candidates.
   */
  async candidates(organizationId: string, limit: number): Promise<DryRunTicketRow[]> {
    return this.tickets(
      organizationId,
      sql`t.state = 'open' and t.sizing_status = 'sized' and src.kind in (${sql.join(DRY_RUN_SOURCE_KINDS)})`,
      Math.min(limit, MAX_PICKER_CANDIDATES),
    );
  }

  /**
   * Tickets of one workspace matching a filter, newest-updated first.
   *
   * The effort is the ticket's own estimate in force (V038) and, for a ticket nobody has sized
   * directly, the estimate of the GitHub issue it mirrors — the same issue, sized once. The
   * repository is the one `meta.github` names, matched case-insensitively against the mirror as
   * `replay.repository.ts` does.
   *
   * @param organizationId - The workspace.
   * @param filter - A boolean SQL fragment over `t` (tickets) and `src` (ticket_sources).
   * @param limit - How many rows.
   * @returns The rows.
   */
  private async tickets(
    organizationId: string,
    filter: ReturnType<typeof sql>,
    limit: number,
  ): Promise<DryRunTicketRow[]> {
    const schema = sql.id(SCHEMA_NAME);
    const { rows } = await sql<DryRunTicketRow>`
      select t.id, t.external_key, t.external_url, t.title, t.body, t.state, t.labels,
             t.source_updated_at, src.kind as source_kind,
             coalesce(own.effort, mirrored.effort) as effort,
             gh.login as repo_owner, repo.name as repo_name,
             repo.default_branch as repo_default_branch
        from ${schema}.tickets t
        join ${schema}.ticket_sources src on src.id = t.source_id
        left join ${schema}.github_orgs gh
               on gh.organization_id = t.organization_id
              and lower(gh.login) = lower(t.meta #>> '{github,owner}')
        left join ${schema}.github_repos repo
               on repo.org_id = gh.id
              and lower(repo.name) = lower(t.meta #>> '{github,repo}')
        left join lateral (
               select e.effort from ${schema}.issue_estimates e
                where e.ticket_id = t.id
                order by e.version desc limit 1) own on true
        left join lateral (
               select e.effort
                 from ${schema}.github_issues issue
                 join ${schema}.issue_estimates e on e.github_issue_id = issue.id
                where issue.github_repo_id = repo.id
                  and issue.number::text = t.external_id
                order by e.version desc limit 1) mirrored on true
       where t.organization_id = ${organizationId}
         and ${filter}
       order by t.source_updated_at desc, t.external_key
       limit ${limit}
    `.execute(this.database.db);

    return rows;
  }

  /**
   * The workspace's dry-run cap, defaults resolved.
   *
   * @param organizationId - The workspace.
   * @returns `workspace_settings_effective.dry_run_cap_cents`.
   */
  async workspaceCapCents(organizationId: string): Promise<number> {
    const row = await this.database.db
      .selectFrom("workspace_settings_effective")
      .select("dry_run_cap_cents")
      .where("organization_id", "=", organizationId)
      .executeTakeFirstOrThrow();

    return row.dry_run_cap_cents;
  }

  /**
   * The tool traces of the copilot's replies about one workflow, newest first — where a draft's
   * spend guard is recorded (`dry-runs.budget.ts`).
   *
   * Only sessions that could have shaped the draft as it stands: the active one and promoted
   * ones. A discarded conversation's proposals were discarded with it.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @returns At most {@link GUARD_TRACE_WINDOW} traces.
   */
  async guardTraces(organizationId: string, workflowId: string): Promise<CopilotToolTrace[]> {
    const rows = await this.database.db
      .selectFrom("copilot_messages as m")
      .innerJoin("copilot_sessions as s", "s.id", "m.session_id")
      .select("m.tool_trace as tool_trace")
      .where("s.organization_id", "=", organizationId)
      .where("s.workflow_id", "=", workflowId)
      .where("s.status", "<>", "discarded")
      .where("m.role", "=", "copilot")
      .orderBy("m.created_at", "desc")
      .orderBy("m.seq", "desc")
      .limit(GUARD_TRACE_WINDOW)
      .execute();

    return rows.map((row) => row.tool_trace);
  }

  /**
   * Whether a copilot session is a conversation about this workflow, in this workspace.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @param sessionId - The session a dry run says proposed it.
   * @returns `true` when it is.
   */
  async sessionIsAbout(
    organizationId: string,
    workflowId: string,
    sessionId: string,
  ): Promise<boolean> {
    const row = await this.database.db
      .selectFrom("copilot_sessions")
      .select("id")
      .where("organization_id", "=", organizationId)
      .where("workflow_id", "=", workflowId)
      .where("id", "=", sessionId)
      .executeTakeFirst();

    return row !== undefined;
  }

  /**
   * Record a dry run, in `precheck`.
   *
   * @param run - What is being tested.
   * @returns The row.
   */
  async insert(run: NewDryRun): Promise<DryRun> {
    return this.database.db
      .insertInto("dry_runs")
      .values({
        organization_id: run.organizationId,
        workflow_id: run.workflowId,
        base_version: run.baseVersion,
        draft_rev: run.draftRev,
        session_id: run.sessionId,
        ticket_id: run.ticketId,
        pinned_sha: run.pinnedSha,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Record a passed pre-check and open the run.
   *
   * @param id - The dry run.
   * @returns The row, `running`.
   */
  async markRunning(id: string): Promise<DryRun> {
    return this.database.db
      .updateTable("dry_runs")
      .set({ status: "running", precheck_findings: "[]" })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Record a failed pre-check: the findings, and the run ended before anything was invoked.
   *
   * @param id - The dry run.
   * @param findings - The anchored findings.
   * @param reason - Why, as a sentence.
   * @returns The row, `failed`.
   */
  async failPrecheck(id: string, findings: readonly object[], reason: string): Promise<DryRun> {
    return this.database.db
      .updateTable("dry_runs")
      .set({
        status: "failed",
        precheck_findings: JSON.stringify(findings),
        failure_reason: reason,
        finished_at: sql<Date>`greatest(now(), started_at)`,
        duration_ms: sql<number>`greatest(0, (extract(epoch from now() - started_at) * 1000)::bigint)`,
      })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Record one stage row, once. A row already recorded at that position is left as it is — the
   * harness's final result repeats every row it streamed.
   *
   * @param run - The dry run.
   * @param stage - The row, as the harness produced it.
   * @returns When it is stored.
   */
  async insertStage(run: Pick<DryRun, "id" | "organization_id">, stage: EngineDryRunStage) {
    await this.database.db
      .insertInto("dry_run_stages")
      .values({
        organization_id: run.organization_id,
        dry_run_id: run.id,
        seq: stage.seq,
        stage_key: stage.stageKey,
        display_name: stage.displayName,
        verdict: stage.verdict,
        how: stage.how,
        note: stage.note,
        metrics: JSON.stringify(stage.metrics),
        skip_reason: stage.skipReason,
        skip_kind: stage.skipKind,
        skip_input: stage.skipInput,
        started_at: stage.startedAt === null ? null : new Date(stage.startedAt),
        finished_at: stage.finishedAt === null ? null : new Date(stage.finishedAt),
      })
      .onConflict((conflict) => conflict.columns(["dry_run_id", "seq"]).doNothing())
      .execute();
  }

  /**
   * Record a run's artifacts.
   *
   * @param run - The dry run.
   * @param artifacts - The overlay diff and excerpts.
   * @returns When they are stored.
   */
  async insertArtifacts(
    run: Pick<DryRun, "id" | "organization_id">,
    artifacts: readonly EngineDryRunArtifact[],
  ): Promise<void> {
    if (artifacts.length === 0) return;

    await this.database.db
      .insertInto("dry_run_artifacts")
      .values(
        artifacts.map((artifact) => ({
          organization_id: run.organization_id,
          dry_run_id: run.id,
          kind: artifact.kind,
          content: artifact.content,
          truncated: artifact.truncated,
          original_bytes: artifact.originalBytes,
          path_summary:
            artifact.kind === "overlay_diff" ? JSON.stringify(artifact.pathSummary) : null,
        })),
      )
      .execute();
  }

  /**
   * End a running dry run. A run that is no longer `running` is left alone — somebody else
   * ended it first, and a finished run is a record.
   *
   * @param id - The dry run.
   * @param ending - How it ended.
   * @returns The row as it now stands, or `undefined` when no run has this id.
   */
  async finish(id: string, ending: DryRunEnding): Promise<DryRun | undefined> {
    const finished = await this.database.db
      .updateTable("dry_runs")
      .set({
        status: ending.status,
        failure_reason: ending.failureReason,
        cost_cents: ending.costCents,
        tokens: ending.tokens,
        guard_audit: JSON.stringify(ending.guardAudit),
        finished_at: sql<Date>`greatest(now(), started_at)`,
        duration_ms:
          ending.durationMs ??
          sql<number>`greatest(0, (extract(epoch from now() - started_at) * 1000)::bigint)`,
      })
      .where("id", "=", id)
      .where("status", "=", "running")
      .returningAll()
      .executeTakeFirst();

    return (
      finished ??
      this.database.db.selectFrom("dry_runs").selectAll().where("id", "=", id).executeTakeFirst()
    );
  }

  /**
   * One dry run of one workflow, org-scoped.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @param id - The dry run.
   * @returns The row, or `undefined`.
   */
  async find(organizationId: string, workflowId: string, id: string): Promise<DryRun | undefined> {
    return this.database.db
      .selectFrom("dry_runs")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("workflow_id", "=", workflowId)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  /**
   * The dry run of a workflow that has not ended, if there is one.
   *
   * @param workflowId - A workflow already resolved through {@link workflow}.
   * @returns The open run, or `undefined`.
   */
  async open(workflowId: string): Promise<DryRun | undefined> {
    return this.database.db
      .selectFrom("dry_runs")
      .selectAll()
      .where("workflow_id", "=", workflowId)
      .where("status", "not in", DRY_RUN_TERMINAL_STATUSES)
      .orderBy("started_at", "desc")
      .executeTakeFirst();
  }

  /**
   * A dry run's stage rows, in card order.
   *
   * @param dryRunId - The dry run.
   * @returns The rows.
   */
  async stages(dryRunId: string): Promise<DryRunStage[]> {
    return this.database.db
      .selectFrom("dry_run_stages")
      .selectAll()
      .where("dry_run_id", "=", dryRunId)
      .orderBy("seq", "asc")
      .execute();
  }

  /**
   * The window and sample floor every replay estimate is held to — `replay_estimate_policy()`
   * (V121), read rather than repeated here so a stage's estimate names the floor the estimator
   * used.
   *
   * @returns The policy.
   * @throws {Error} When the function answers no row — which its definition makes impossible.
   */
  async replayPolicy(): Promise<ReplayPolicy> {
    const { rows } = await sql<{ window_days: number; sample_floor: number }>`
      select policy.window_days, policy.sample_floor
        from ${sql.id(SCHEMA_NAME)}.replay_estimate_policy() policy
    `.execute(this.database.db);
    const [row] = rows;

    if (row === undefined) throw new Error("replay_estimate_policy() answered no row");

    return { windowDays: row.window_days, sampleFloor: row.sample_floor };
  }

  /**
   * A dry run's artifacts — the diff first.
   *
   * @param dryRunId - The dry run.
   * @returns The rows.
   */
  async artifacts(dryRunId: string): Promise<DryRunArtifact[]> {
    return this.database.db
      .selectFrom("dry_run_artifacts")
      .selectAll()
      .where("dry_run_id", "=", dryRunId)
      .orderBy("kind", "asc")
      .orderBy("created_at", "asc")
      .execute();
  }

  /**
   * A workflow's dry-run history, newest first — `dry_runs_workflow_history_idx`.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @param limit - How many.
   * @returns Each run with the key of the ticket it ran against.
   */
  async history(
    organizationId: string,
    workflowId: string,
    limit: number,
  ): Promise<(DryRun & { ticket_key: string; ticket_title: string })[]> {
    return this.database.db
      .selectFrom("dry_runs as r")
      .innerJoin("tickets as t", "t.id", "r.ticket_id")
      .selectAll("r")
      .select(["t.external_key as ticket_key", "t.title as ticket_title"])
      .where("r.organization_id", "=", organizationId)
      .where("r.workflow_id", "=", workflowId)
      .orderBy("r.started_at", "desc")
      .limit(limit)
      .execute();
  }

  /**
   * A workflow's dry-run accounting: how many dry runs, and what they cost.
   *
   * This is the whole of it — `dry_runs.cost_cents`, summed. Dry-run spend is recorded nowhere
   * in the run plane (decision W4).
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @returns The count, the priced total and how many finished runs are unpriced.
   */
  async spend(organizationId: string, workflowId: string): Promise<DryRunSpendRow> {
    const row = await this.database.db
      .selectFrom("dry_runs")
      .select((eb) => [
        eb.fn.countAll<string>().as("runs"),
        eb.fn.sum<string | null>("cost_cents").as("cost_cents"),
        eb.fn
          .count<string>("id")
          .filterWhere("finished_at", "is not", null)
          .filterWhere("cost_cents", "is", null)
          .as("unpriced"),
      ])
      .where("organization_id", "=", organizationId)
      .where("workflow_id", "=", workflowId)
      .executeTakeFirstOrThrow();

    return {
      runs: Number(row.runs),
      cost_cents: row.cost_cents === null ? null : Number(row.cost_cents),
      unpriced: Number(row.unpriced),
    };
  }
}
