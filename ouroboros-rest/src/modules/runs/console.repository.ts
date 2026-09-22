/**
 * Every statement the Run Console's reads issue beyond finding the run
 * ([#304](https://github.com/NobuData/ouroboros/issues/304), AP.2).
 *
 * ## How tenancy reaches these statements
 *
 * The run itself is found by `RunsRepository.find`, which is scoped to the workspace and is the
 * whole of the `404`-not-`403` rule. Everything here runs **after** that, and falls into two
 * kinds:
 *
 *   * **Keyed by the run.** `run_stages`, `run_files`, `run_commits`, `run_events` and the
 *     guardrail view have no `organization_id` of their own — V045–V048's choice, since a row has
 *     no meaning apart from its run — so a run the caller may read is the scope, and these take
 *     the run's id and nothing else.
 *   * **Keyed by the workspace.** The repository, the pinned document, the route and the build
 *     job are workspace rows, and each statement filters on the workspace the run was found in.
 *     A pin naming another workspace's workflow slug, or a route of another workspace's task
 *     kind, is therefore absent rather than borrowed. `console.repository.spec.ts` asserts the
 *     predicate on each.
 *
 * ## The transcript cursor is bounded above, and that is the exactness argument
 *
 * {@link ConsoleRepository.events} and {@link ConsoleRepository.jsonl} take an upper bound —
 * the run's `event_seq` as the caller read it — as well as the cursor. `run_events_append()`
 * allocates `seq` under a lock on the run row and moves `runs.event_seq` in the same
 * transaction, so every `seq` at or below a committed `event_seq` is itself committed: a read
 * bounded by it can never see *7* and *9* while *8* is still in flight. Without the bound a
 * page could end on a row that committed out of order with its neighbour, and a client
 * advancing its cursor past it would skip one entry for ever.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import type {
  RunCommit,
  RunEvent,
  RunEventJsonlLine,
  RunFile,
  RunGuardrailsLatest,
  RunStage,
} from "../db/schema";
import type { ReservationRow, RouteCap, RunRepository } from "./console.resources";
import { readSpendTotals, type SpendTotals } from "./run.spend";

@Injectable()
export class ConsoleRepository {
  /**
   * @param database - The typed connection. Injected, never constructed.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The repository a run works in, named as GitHub names it.
   *
   * @param organizationId - The run's workspace.
   * @param githubRepoId - `runs.github_repo_id`.
   * @returns `{owner, name}`, or `undefined` when it is not this workspace's.
   */
  async repository(
    organizationId: string,
    githubRepoId: string,
  ): Promise<RunRepository | undefined> {
    const row = await this.database.db
      .selectFrom("github_repos")
      .innerJoin("github_orgs", "github_orgs.id", "github_repos.org_id")
      .select(["github_orgs.login as owner", "github_repos.name as name"])
      .where("github_orgs.organization_id", "=", organizationId)
      .where("github_repos.id", "=", githubRepoId)
      .executeTakeFirst();

    return row === undefined ? undefined : { owner: row.owner, name: row.name };
  }

  /**
   * Every stage attempt the run has, in stepper order.
   *
   * @param run - `runs.id`, already found in the caller's workspace.
   * @returns The rows, by position then attempt.
   */
  async stages(run: string): Promise<RunStage[]> {
    return this.database.db
      .selectFrom("run_stages")
      .selectAll()
      .where("run_id", "=", run)
      .orderBy("position", "asc")
      .orderBy("stage_key", "asc")
      .orderBy("attempt", "asc")
      .execute();
  }

  /**
   * The change-set's files, in the order they entered it.
   *
   * `created_at` is when a path first joined the change-set; `id` breaks the tie between files
   * a single report introduced together, so the order is the same on every read.
   *
   * @param run - `runs.id`.
   * @returns The rows.
   */
  async files(run: string): Promise<RunFile[]> {
    return this.database.db
      .selectFrom("run_files")
      .selectAll()
      .where("run_id", "=", run)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
  }

  /**
   * The run's commits, in the writer's order.
   *
   * @param run - `runs.id`.
   * @returns The rows, by `seq`.
   */
  async commits(run: string): Promise<RunCommit[]> {
    return this.database.db
      .selectFrom("run_commits")
      .selectAll()
      .where("run_id", "=", run)
      .orderBy("seq", "asc")
      .execute();
  }

  /**
   * What the run has spent — the shared statement AP.1 answers with too.
   *
   * @param run - `runs.id`.
   * @returns The sums.
   */
  async spend(run: string): Promise<SpendTotals> {
    return readSpendTotals(this.database.db, run);
  }

  /**
   * The pinned version's stored document.
   *
   * @param organizationId - The run's workspace.
   * @param tag - `runs.workflow_tag` — `workflows.slug`.
   * @param version - `runs.workflow_version_pin`.
   * @returns The definition wrapped in its row, or `undefined` when there is no such version.
   */
  async pinnedDefinition(
    organizationId: string,
    tag: string,
    version: number,
  ): Promise<{ definition: unknown } | undefined> {
    return this.database.db
      .selectFrom("workflow_versions")
      .innerJoin("workflows", "workflows.id", "workflow_versions.workflow_id")
      .select("workflow_versions.definition")
      .where("workflows.organization_id", "=", organizationId)
      .where("workflows.slug", "=", tag)
      .where("workflow_versions.version", "=", version)
      .executeTakeFirst();
  }

  /**
   * The route a task kind resolves through, and its cost cap.
   *
   * @param organizationId - The run's workspace.
   * @param taskKind - `task_kinds.name`, as the stage's `inherit_task` names it.
   * @returns The route's tag and cap, or `undefined` when the workspace has no such kind.
   */
  async routeCap(organizationId: string, taskKind: string): Promise<RouteCap | undefined> {
    const row = await this.database.db
      .selectFrom("routes")
      .innerJoin("task_kinds", "task_kinds.id", "routes.task_kind_id")
      .select(["routes.tag", "routes.max_cost_cents_per_run"])
      .where("routes.organization_id", "=", organizationId)
      .where("task_kinds.name", "=", taskKind)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : { tag: row.tag, maxCostCentsPerRun: row.max_cost_cents_per_run };
  }

  /**
   * The build job a run holds, and the runner holding it.
   *
   * @param organizationId - The run's workspace.
   * @param jobId - `runs.reserved_build_job_id`.
   * @returns The reservation, or `undefined` when the job is not this workspace's.
   */
  async reservation(organizationId: string, jobId: string): Promise<ReservationRow | undefined> {
    const row = await this.database.db
      .selectFrom("build_jobs")
      .leftJoin("runners", "runners.id", "build_jobs.runner_id")
      .select([
        "build_jobs.id",
        "build_jobs.number",
        "build_jobs.status",
        "runners.name as runner_name",
      ])
      .where("build_jobs.organization_id", "=", organizationId)
      .where("build_jobs.id", "=", jobId)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : { id: row.id, number: row.number, status: row.status, runnerName: row.runner_name };
  }

  /**
   * The latest verdict per check — what the Guardrails card reads.
   *
   * @param run - `runs.id`.
   * @returns At most four rows.
   */
  async guardrails(run: string): Promise<RunGuardrailsLatest[]> {
    return this.database.db
      .selectFrom("v_run_guardrails_latest")
      .selectAll()
      .where("run_id", "=", run)
      .execute();
  }

  /**
   * One page of the transcript after a cursor.
   *
   * @param run - `runs.id`.
   * @param after - Entries with a greater `seq` than this.
   * @param upTo - The run's `event_seq` as the caller read it — the bound that makes the cursor
   *   exact (see the file header).
   * @param limit - The most entries to return.
   * @returns The rows, in `seq` order.
   */
  async events(run: string, after: number, upTo: number, limit: number): Promise<RunEvent[]> {
    return this.database.db
      .selectFrom("run_events")
      .selectAll()
      .where("run_id", "=", run)
      .where("seq", ">", after)
      .where("seq", "<=", upTo)
      .orderBy("seq", "asc")
      .limit(limit)
      .execute();
  }

  /**
   * One batch of the JSONL projection after a cursor — the export's read.
   *
   * The lines are `ouroboros.run_events_jsonl`'s, byte for byte: the export writes what the view
   * renders and never re-serializes it, so the file and AO.2's fixture cannot disagree.
   *
   * @param run - `runs.id`.
   * @param after - Lines with a greater `seq` than this.
   * @param upTo - The run's `event_seq` when the export began, so a transcript still growing
   *   exports as it stood when the download started.
   * @param limit - The batch size.
   * @returns `{seq, line}` rows, in `seq` order.
   */
  async jsonl(
    run: string,
    after: number,
    upTo: number,
    limit: number,
  ): Promise<Pick<RunEventJsonlLine, "seq" | "line">[]> {
    return this.database.db
      .selectFrom("run_events_jsonl")
      .select(["seq", "line"])
      .where("run_id", "=", run)
      .where("seq", ">", after)
      .where("seq", "<=", upTo)
      .orderBy("seq", "asc")
      .limit(limit)
      .execute();
  }
}
