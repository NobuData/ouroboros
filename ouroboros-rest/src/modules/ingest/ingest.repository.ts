/**
 * Every statement the ingestion contract issues.
 *
 * AP.1 ([#303](https://github.com/NobuData/ouroboros/issues/303)). Two things about this file
 * differ from every other repository in the service, and both are worth reading before any
 * method below.
 *
 * ---------------------------------------------------------------------------
 * **1. Nothing here takes an `organizationId` first, and that is not an omission.**
 *
 * The convention ([#30](https://github.com/NobuData/ouroboros/issues/30)) is that every
 * repository method takes the workspace first and every statement filters on it, because the
 * value comes from the tenant context and a run belonging to another workspace must be
 * *absent* rather than forbidden. This surface has no tenant context: the caller is a worker
 * holding a shared secret, and the workspace is what it is asking for, indirectly, by naming
 * a ticket or a run. `internal.repository.ts` made the same argument for one lookup; this is
 * the same argument for a module.
 *
 * What replaces the predicate is **resolution**: every operation begins by reading the
 * workspace *out of* the row the caller named, and everything it then writes is attributed to
 * that value. The two places a caller could smuggle a second workspace in — the repository a
 * run works on, the build job it reserves — are checked against the resolved one, here and
 * again by V008's and V047's own triggers.
 *
 * **2. Every run-scoped operation locks the run row first.**
 *
 * {@link IngestRepository.lockRun} takes `FOR UPDATE` on `runs`, and it is the first statement
 * of every write below. Four counters are allocated per run — `event_seq`, `event_hint`,
 * `change_set_seq` and `run_commits.seq` — and three of the ticket's acceptance criteria are
 * about what happens when two posts interleave. Serialising per run is what makes *"a dense,
 * correctly ordered `seq` with no gaps and no duplicates"* true under concurrency rather than
 * usually true, and it is the same lock V046's `run_events_append()` takes anyway, so the
 * cost is a lock that was going to be taken one statement later.
 *
 * It is the **run** row rather than a table lock, so two runs ingest in parallel at full
 * speed, which is the only concurrency this surface actually has: one executor drives one run.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Kysely, type Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type {
  Database,
  Run,
  RunFileStatus,
  RunIngestOperation,
  RunStage,
  RunStageReturnKind,
  RunStageReturnReason,
  RunStageStatus,
} from "../db/schema";
import { readSpendTotals, type SpendTotals } from "../runs/run.spend";

/** A connection or a transaction — every method takes whichever the caller is inside. */
export type Writer = Kysely<Database> | Transaction<Database>;

/** The canonical ticket a run is opened for, reduced to what a run needs from it. */
export interface TicketResolution {
  /** The workspace — resolved, never claimed. */
  readonly organizationId: string;
  /** The tracker's own identifier: `482`, `PROJ-142`, a Linear uuid. */
  readonly externalId: string;
  /** The title, which `runs.issue_title` freezes a copy of. */
  readonly title: string;
}

/** What a stage's current row says, or the absence of one. */
export interface StageState {
  /** The highest attempt that exists for this stage, or `undefined` when none does. */
  readonly attempt?: number;
  /** That attempt's status. */
  readonly status?: RunStageStatus;
}

/** One transcript entry, ready for the store. */
export interface EventRow {
  readonly actor: Database["run_events"]["actor"];
  readonly ts?: Date;
  readonly stage_key: string | null;
  readonly attempt: number | null;
  readonly tool_tag: string | null;
  readonly model_id: string | null;
  readonly body: string | null;
  readonly payload: Record<string, unknown> | null;
}

/** One file of a change-set, ready for the upsert. */
export interface FileRow {
  readonly path: string;
  readonly status: RunFileStatus;
  readonly additions: number;
  readonly deletions: number;
}

/** One commit, ready for the append. */
export interface CommitRow {
  readonly sha: string;
  readonly message: string;
  readonly committed_at: Date;
}

/** What one run's change-set adds up to. */
export interface ChangeSetTotals {
  /** How many files it holds. */
  readonly files: number;
  /** Their additions, summed. */
  readonly additions: number;
  /** Their deletions, summed. */
  readonly deletions: number;
}

/** What one run has spent — `runs/run.spend.ts`'s shape, which AP.2's Resources card reads too. */
export type { SpendTotals };

/** What a stage transition writes. */
export interface StageWrite {
  readonly run_id: string;
  readonly stage_key: string;
  readonly stage_label: string;
  readonly position: number;
  readonly attempt: number;
  readonly status: RunStageStatus;
  readonly started_at: Date | null;
  readonly finished_at: Date | null;
  readonly max_attempts: number | null;
  readonly token_budget: number | null;
  readonly returned_from_stage_key: string | null;
  readonly returned_from_kind: RunStageReturnKind | null;
  readonly return_reason: RunStageReturnReason | null;
}

/** A stored receipt, as the replay path reads it. */
export interface Receipt {
  /** The digest of the request it answered. */
  readonly request_digest: string;
  /** The answer, as `jsonb` gave it back. */
  readonly response: unknown;
}

@Injectable()
export class IngestRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's lifecycle
   *   belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /** The connection, for the one caller that opens its own transaction. */
  get db(): Kysely<Database> {
    return this.database.db;
  }

  /**
   * Run several statements as one transaction.
   *
   * @param work - What to run inside it.
   * @returns Whatever `work` resolved to, once committed.
   */
  async transaction<T>(work: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.database.transaction(work);
  }

  // --- resolution ------------------------------------------------------------------------

  /**
   * The canonical ticket a run is being opened for.
   *
   * @param writer - The transaction.
   * @param source - `ticket_sources.id`.
   * @param externalKey - `tickets.external_key`, the display form.
   * @returns Every match, which is normally one. More than one is `ticket_ambiguous` and is
   *   the caller's to refuse: V030 makes `external_key` deliberately non-unique, and picking
   *   a row here would open the run for whichever one sorted first.
   */
  async ticketsByKey(
    writer: Writer,
    source: string,
    externalKey: string,
  ): Promise<TicketResolution[]> {
    const rows = await writer
      .selectFrom("tickets")
      .select(["organization_id", "external_id", "title"])
      .where("source_id", "=", source)
      .where("external_key", "=", externalKey)
      .orderBy("id", "asc")
      .limit(2)
      .execute();

    return rows.map((row) => ({
      organizationId: row.organization_id,
      externalId: row.external_id,
      title: row.title,
    }));
  }

  /**
   * Is this repository the workspace's?
   *
   * @param writer - The transaction.
   * @param organizationId - The workspace, resolved from the ticket.
   * @param repository - `github_repos.id`, as the caller named it.
   * @returns Whether a repository by that id belongs to that workspace. The join through
   *   `github_orgs` is where the workspace lives — V003 put it on the org rather than on the
   *   repository, and `runs_repo_in_organization()` walks the same path.
   */
  async repositoryBelongsTo(
    writer: Writer,
    organizationId: string,
    repository: string,
  ): Promise<boolean> {
    const row = await writer
      .selectFrom("github_repos")
      .innerJoin("github_orgs", "github_orgs.id", "github_repos.org_id")
      .select("github_repos.id")
      .where("github_repos.id", "=", repository)
      .where("github_orgs.organization_id", "=", organizationId)
      .executeTakeFirst();

    return row !== undefined;
  }

  /**
   * The pinned workflow version's stored document.
   *
   * @param writer - The transaction.
   * @param organizationId - The workspace.
   * @param tag - `workflows.slug`.
   * @param version - `workflow_versions.version`.
   * @returns The row holding the definition, or `undefined` when no such published version
   *   exists in that workspace. A *draft* has a null `version` and cannot match, which is the
   *   right answer: a run pins something that was published.
   *
   *   The definition is wrapped in its row rather than returned bare, because bare it would be
   *   `unknown | undefined` — a type that collapses to `unknown`, taking *"there is no such
   *   version"* with it. A caller could then only tell the two apart by guessing.
   */
  async pinnedDefinition(
    writer: Writer,
    organizationId: string,
    tag: string,
    version: number,
  ): Promise<{ definition: unknown } | undefined> {
    const row = await writer
      .selectFrom("workflow_versions")
      .innerJoin("workflows", "workflows.id", "workflow_versions.workflow_id")
      .select("workflow_versions.definition")
      .where("workflows.organization_id", "=", organizationId)
      .where("workflows.slug", "=", tag)
      .where("workflow_versions.version", "=", version)
      .executeTakeFirst();

    return row;
  }

  /**
   * Is this build job the workspace's?
   *
   * @param writer - The transaction.
   * @param organizationId - The workspace.
   * @param buildJob - `build_jobs.id`.
   * @returns Whether it exists there. V047's foreign key is composite and would refuse a
   *   mismatch anyway; asking first is what turns that into `build_job_not_found` rather than
   *   a constraint name.
   */
  async buildJobBelongsTo(
    writer: Writer,
    organizationId: string,
    buildJob: string,
  ): Promise<boolean> {
    const row = await writer
      .selectFrom("build_jobs")
      .select("id")
      .where("id", "=", buildJob)
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();

    return row !== undefined;
  }

  // --- the run ---------------------------------------------------------------------------

  /**
   * Take the run's row, and hold it for the rest of the transaction.
   *
   * The first statement of every run-scoped write — see this file's header for why. `FOR
   * UPDATE` rather than a share lock because every caller is about to move one of the run's
   * counters.
   *
   * @param writer - The transaction. A lock outside one is released immediately and would be
   *   a lock that costs a round trip and guarantees nothing.
   * @param run - The run's id.
   * @returns The row, or `undefined` when there is no such run.
   */
  async lockRun(writer: Writer, run: string): Promise<Run | undefined> {
    return writer
      .selectFrom("runs")
      .selectAll()
      .where("id", "=", run)
      .forUpdate()
      .executeTakeFirst();
  }

  /**
   * Open a run.
   *
   * `loop_seq` is left to the database — `runs_allocate_loop_seq()` assigns it under its own
   * lock, per workspace, and a value chosen here would be a second allocator racing that one.
   *
   * @param writer - The transaction.
   * @param run - Every column the contract sets.
   * @returns The row as it was written, including the allocated `loop_seq`.
   */
  async insertRun(
    writer: Writer,
    run: {
      organization_id: string;
      github_repo_id: string;
      issue_number: number;
      issue_title: string;
      workflow_tag: string;
      workflow_version_pin: number;
      model: string;
      stage_label: string;
      stage_index: number;
      stage_total: number;
      branch_name: string | null;
      merge_strategy: Database["runs"]["merge_strategy"];
      simulated: boolean;
    },
  ): Promise<Run> {
    return writer
      .insertInto("runs")
      .values({ ...run, status: "coding" })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Point a run at a build job, or release the one it holds.
   *
   * @param writer - The transaction.
   * @param run - The run.
   * @param buildJob - The job, or `null` to release.
   */
  async setReservation(writer: Writer, run: string, buildJob: string | null): Promise<void> {
    await writer
      .updateTable("runs")
      .set({ reserved_build_job_id: buildJob })
      .where("id", "=", run)
      .execute();
  }

  // --- receipts --------------------------------------------------------------------------

  /**
   * The receipt for a key, if this workspace has already answered one.
   *
   * @param writer - The transaction.
   * @param organizationId - The workspace the key is unique within.
   * @param operation - Which operation.
   * @param idempotencyKey - The caller's key.
   * @returns The digest and the stored response, or `undefined` for a key never used.
   */
  async findReceipt(
    writer: Writer,
    organizationId: string,
    operation: RunIngestOperation,
    idempotencyKey: string,
  ): Promise<Receipt | undefined> {
    return writer
      .selectFrom("run_ingest_receipts")
      .select(["request_digest", "response"])
      .where("organization_id", "=", organizationId)
      .where("operation", "=", operation)
      .where("idempotency_key", "=", idempotencyKey)
      .executeTakeFirst();
  }

  /**
   * Record what was answered.
   *
   * @param writer - The transaction — the same one that wrote the rows this answer describes,
   *   so a receipt cannot exist for work that rolled back.
   * @param receipt - The workspace, the run, the operation, the key, the digest and the
   *   answer.
   */
  async insertReceipt(
    writer: Writer,
    receipt: {
      organization_id: string;
      run_id: string;
      operation: RunIngestOperation;
      idempotency_key: string;
      request_digest: string;
      response: unknown;
    },
  ): Promise<void> {
    await writer
      .insertInto("run_ingest_receipts")
      .values({ ...receipt, response: receipt.response as never })
      .execute();
  }

  // --- stages ----------------------------------------------------------------------------

  /**
   * Where a stage stands — its highest attempt, and that attempt's status.
   *
   * @param writer - The transaction.
   * @param run - The run.
   * @param stageKey - The DSL node id.
   * @returns The highest attempt and its status, or an empty object when the stage has no rows
   *   yet. Empty rather than `undefined` so the caller writes `state.status ?? null` once
   *   instead of branching twice on the same absence.
   */
  async stageState(writer: Writer, run: string, stageKey: string): Promise<StageState> {
    const row = await writer
      .selectFrom("run_stages")
      .select(["attempt", "status"])
      .where("run_id", "=", run)
      .where("stage_key", "=", stageKey)
      .orderBy("attempt", "desc")
      .limit(1)
      .executeTakeFirst();

    return row === undefined ? {} : { attempt: row.attempt, status: row.status };
  }

  /**
   * One stage attempt's row, if it exists.
   *
   * Asked for the attempt the transition names rather than for the highest one, because a
   * report can legitimately arrive for an earlier attempt — an executor re-sending after a
   * lost response, under a fresh key. The state machine then refuses it on its merits instead
   * of on a status belonging to a different row.
   *
   * @param writer - The transaction.
   * @param run - The run.
   * @param stageKey - The stage.
   * @param attempt - Which attempt.
   * @returns Its status and start, or `undefined` when that attempt has no row.
   */
  async stageAttempt(
    writer: Writer,
    run: string,
    stageKey: string,
    attempt: number,
  ): Promise<{ status: RunStageStatus; started_at: Date | null } | undefined> {
    return writer
      .selectFrom("run_stages")
      .select(["status", "started_at"])
      .where("run_id", "=", run)
      .where("stage_key", "=", stageKey)
      .where("attempt", "=", attempt)
      .executeTakeFirst();
  }

  /**
   * Create a stage attempt.
   *
   * @param writer - The transaction.
   * @param stage - Every column but the generated `note`, which no client may supply.
   * @returns The row, with `note` as the database composed it.
   */
  async insertStage(writer: Writer, stage: StageWrite): Promise<RunStage> {
    return writer.insertInto("run_stages").values(stage).returningAll().executeTakeFirstOrThrow();
  }

  /**
   * Move a stage attempt that already exists.
   *
   * @param writer - The transaction.
   * @param run - The run.
   * @param stageKey - The stage.
   * @param attempt - Which attempt.
   * @param change - The status and whichever clocks the new status requires.
   * @returns The row afterwards.
   */
  async updateStage(
    writer: Writer,
    run: string,
    stageKey: string,
    attempt: number,
    change: {
      status: RunStageStatus;
      started_at?: Date | null;
      finished_at?: Date | null;
    },
  ): Promise<RunStage> {
    return writer
      .updateTable("run_stages")
      .set(change)
      .where("run_id", "=", run)
      .where("stage_key", "=", stageKey)
      .where("attempt", "=", attempt)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // --- the transcript --------------------------------------------------------------------

  /**
   * Append a batch to the transcript.
   *
   * `seq` is not supplied: V046's `run_events_append()` allocates it densely and also applies
   * the two caps, which is why some of these rows may not come back. The returned rows are
   * exactly the ones the store kept.
   *
   * @param writer - The transaction, which already holds the run's lock.
   * @param run - The run.
   * @param events - The batch, in the caller's order. Inserted in that order, which is
   *   load-bearing: the trigger numbers rows as they reach it, so an unordered insert would
   *   hand entries sequence numbers that disagree with their own clocks.
   * @returns One row per stored entry: its `seq` and whether it is the cap's elision marker
   *   rather than one of the caller's entries.
   */
  async appendEvents(
    writer: Writer,
    run: string,
    events: readonly EventRow[],
  ): Promise<{ seq: number; marker: boolean }[]> {
    const stored: { seq: number; marker: boolean }[] = [];

    // One statement per entry rather than one multi-row insert, and the reason is the
    // trigger: `run_events_append()` locks the run, reads its counters and updates them on
    // every row, so the rows have to reach it one at a time in a known order. A multi-row
    // insert promises no order — R__dev_seed_farm.sql found this the hard way (#262) — and
    // the run's lock is already held, so the round trips are the only cost.
    for (const event of events) {
      const row = await writer
        .insertInto("run_events")
        .values({
          run_id: run,
          actor: event.actor,
          stage_key: event.stage_key,
          attempt: event.attempt,
          tool_tag: event.tool_tag,
          model_id: event.model_id,
          body: event.body,
          payload: event.payload as never,
          ...(event.ts === undefined ? {} : { ts: event.ts }),
        })
        .returning(["seq", "elided_events"])
        .executeTakeFirst();

      if (row !== undefined) {
        stored.push({ seq: row.seq, marker: row.elided_events !== null });
      }
    }

    return stored;
  }

  /**
   * Raise the run's accepted ordering hint.
   *
   * @param writer - The transaction.
   * @param run - The run.
   * @param hint - The batch's highest hint. Only ever raised: the caller has already refused a
   *   batch that did not continue the order, so this is monotonic by construction and the
   *   `greatest` is a belt against a future caller that forgets.
   */
  async raiseEventHint(writer: Writer, run: string, hint: number): Promise<void> {
    await writer
      .updateTable("runs")
      .set({ event_hint: sql<number>`greatest(event_hint, ${hint})` })
      .where("id", "=", run)
      .execute();
  }

  /**
   * Where the transcript's two counters stand.
   *
   * Read after an append rather than inferred from it: `events_elided_at` may already have been
   * set by an earlier batch, and a caller that learned about elision only from the batch that
   * caused it would be told `false` for every batch after the first refusal — which is the
   * opposite of what the flag means, since a cap once reached stays reached.
   *
   * @param writer - The transaction.
   * @param run - The run.
   * @returns The accepted ordering hint and whether a cap has elided this transcript.
   */
  async eventCounters(writer: Writer, run: string): Promise<{ hint: number; elided: boolean }> {
    const row = await writer
      .selectFrom("runs")
      .select(["event_hint", "events_elided_at"])
      .where("id", "=", run)
      .executeTakeFirstOrThrow();

    return { hint: row.event_hint, elided: row.events_elided_at !== null };
  }

  // --- the change-set --------------------------------------------------------------------

  /**
   * Replace a run's change-set with the reported one.
   *
   * A `PUT`'s semantics, in two statements: upsert what was reported, then remove what was
   * not. V047 is explicit that a second report of a file **replaces** its counts rather than
   * adding to them — *"an ingestion path that adds instead of replacing produces counts that
   * climb forever"* — and the delete is the other half of the same idea: a file an executor
   * reverted leaves the card rather than lingering at `+0 −0`.
   *
   * `created_at` survives an upsert, so *when this file first appeared in the change-set*
   * stays true across reports; `last_reported_at` is what moves.
   *
   * @param writer - The transaction.
   * @param run - The run.
   * @param files - The whole change-set. Empty removes every row, which is a run that has
   *   reverted everything it did.
   */
  async replaceFiles(writer: Writer, run: string, files: readonly FileRow[]): Promise<void> {
    if (files.length > 0) {
      await writer
        .insertInto("run_files")
        .values(
          files.map((file) => ({
            run_id: run,
            path: file.path,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
          })),
        )
        .onConflict((conflict) =>
          conflict.columns(["run_id", "path"]).doUpdateSet({
            status: (builder) => builder.ref("excluded.status"),
            additions: (builder) => builder.ref("excluded.additions"),
            deletions: (builder) => builder.ref("excluded.deletions"),
            last_reported_at: sql<Date>`now()`,
          }),
        )
        .execute();
    }

    let removal = writer.deleteFrom("run_files").where("run_id", "=", run);

    if (files.length > 0) {
      removal = removal.where(
        "path",
        "not in",
        files.map((file) => file.path),
      );
    }

    await removal.execute();
  }

  /**
   * What the change-set adds up to now.
   *
   * @param writer - The transaction.
   * @param run - The run.
   * @returns The count and the two sums. `coalesce` rather than a branch on the empty case,
   *   so a run that has reverted everything reports three zeros instead of three nulls.
   */
  async changeSetTotals(writer: Writer, run: string): Promise<ChangeSetTotals> {
    const row = await writer
      .selectFrom("run_files")
      .select([
        sql<string>`count(*)`.as("files"),
        sql<string>`coalesce(sum(additions), 0)`.as("additions"),
        sql<string>`coalesce(sum(deletions), 0)`.as("deletions"),
      ])
      .where("run_id", "=", run)
      .executeTakeFirstOrThrow();

    return {
      files: Number(row.files),
      additions: Number(row.additions),
      deletions: Number(row.deletions),
    };
  }

  /**
   * Allocate this run's next change-set report number.
   *
   * @param writer - The transaction, holding the run's lock.
   * @param run - The run.
   * @returns The new `runs.change_set_seq` — the number this report's guardrail verdicts
   *   carry. Incremented in the database rather than read-then-written, so the allocation is
   *   one statement even though the lock already makes it safe.
   */
  async allocateChangeSetSeq(writer: Writer, run: string): Promise<number> {
    const row = await writer
      .updateTable("runs")
      .set({ change_set_seq: sql<number>`change_set_seq + 1` })
      .where("id", "=", run)
      .returning("change_set_seq")
      .executeTakeFirstOrThrow();

    return row.change_set_seq;
  }

  // --- commits ---------------------------------------------------------------------------

  /**
   * The highest commit sequence this run holds.
   *
   * @param writer - The transaction.
   * @param run - The run.
   * @returns The number, or `0` for a run with no commits — so the next one is always this
   *   plus one and no caller has to branch on the empty case.
   */
  async lastCommitSeq(writer: Writer, run: string): Promise<number> {
    const row = await writer
      .selectFrom("run_commits")
      .select(sql<string>`coalesce(max(seq), 0)`.as("last"))
      .where("run_id", "=", run)
      .executeTakeFirstOrThrow();

    return Number(row.last);
  }

  /**
   * Append commits, skipping shas this run already has.
   *
   * @param writer - The transaction, holding the run's lock.
   * @param run - The run.
   * @param commits - The report, oldest first, already numbered by the caller.
   * @returns How many rows were new. `run_commits_run_sha_key` is what makes the rest no-ops,
   *   and it holds *whatever request they arrive in* — which is a different guarantee from
   *   the idempotency key's and the reason this count is returned rather than assumed.
   */
  async appendCommits(
    writer: Writer,
    run: string,
    commits: readonly (CommitRow & { seq: number })[],
  ): Promise<number> {
    if (commits.length === 0) {
      return 0;
    }

    const written = await writer
      .insertInto("run_commits")
      .values(commits.map((commit) => ({ ...commit, run_id: run })))
      .onConflict((conflict) => conflict.columns(["run_id", "sha"]).doNothing())
      .returning("sha")
      .execute();

    return written.length;
  }

  /**
   * Which of these shas this run already holds.
   *
   * Asked before the append so the caller can number only the new ones: `run_commits.seq` is
   * unique per run, and numbering a duplicate would burn a sequence number on a row that is
   * never written.
   *
   * @param writer - The transaction.
   * @param run - The run.
   * @param shas - The report's shas.
   * @returns The subset already recorded.
   */
  async knownCommitShas(
    writer: Writer,
    run: string,
    shas: readonly string[],
  ): Promise<Set<string>> {
    if (shas.length === 0) {
      return new Set();
    }

    const rows = await writer
      .selectFrom("run_commits")
      .select("sha")
      .where("run_id", "=", run)
      .where("sha", "in", [...shas])
      .execute();

    return new Set(rows.map((row) => row.sha));
  }

  // --- resources -------------------------------------------------------------------------

  /**
   * Attribute a spend to a run.
   *
   * @param writer - The transaction.
   * @param usage - The ledger row. `organization_id` is the run's, resolved rather than
   *   claimed, and `run_in_organization()` refuses the pair if they ever disagree.
   */
  async insertTokenUsage(
    writer: Writer,
    usage: {
      organization_id: string;
      run_id: string;
      provider: string;
      model: string;
      tokens_in: number;
      tokens_out: number;
      cost_cents: string | null;
      task_kind: string | null;
      latency_ms: number | null;
      occurred_at?: Date;
    },
  ): Promise<void> {
    await writer.insertInto("token_usage").values(usage).execute();
  }

  /**
   * What a run has spent, in total.
   *
   * @param writer - The transaction.
   * @param run - The run.
   * @returns The two token sums, the cost as a decimal string, and how many attributed rows
   *   carry no price. `costCents` is `null` when *every* row is unpriced — decisions **M7**
   *   and **N10**'s count-only case — rather than `"0"`, which would say the run cost nothing
   *   about a run whose model has no price in the catalog.
   */
  async spendTotals(writer: Writer, run: string): Promise<SpendTotals> {
    return readSpendTotals(writer, run);
  }
}
