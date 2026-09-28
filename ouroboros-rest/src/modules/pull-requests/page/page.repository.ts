/**
 * Every statement the PR page's reads and head actions issue — AX.5
 * ([#361](https://github.com/NobuData/ouroboros/issues/361)).
 *
 * Reads over V052's PRs and revisions, V056's gate snapshots (`pr_gate_results_latest`,
 * `pr_gate_aggregate`), V057's review thread (`pr_thread_summary`), V055's classifications, V065's
 * approval slots and loop returns, and the run's ledger through `readSpendTotals` — the statement
 * the console and the merge executor already sum with. The criteria matrix and the merge plan are
 * not read here: their services own them, and the page asks them.
 *
 * ## Tenancy
 *
 * Every entry point takes the workspace and filters the PR by it; a PR of another workspace reads
 * as absent, which the service answers `404`. From the PR on, every read is keyed by its own rows.
 *
 * ## The head actions' lock
 *
 * {@link PageTransaction.lockPr} takes the `pull_requests` row `for update` — the gate engine's and
 * the merge executor's lock — so an approval slot is opened or answered in line with any gate
 * evaluation of the same PR, and V065's one-open-slot index is never raced into a `500`.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Kysely, type Transaction } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type {
  Database,
  FailureClass,
  PrApprovalHostRequest,
  PrApprovalState,
  PrGateEvidenceRef,
  PrGateKey,
  PrGateVerdict,
  PrRevisionFile,
  PrThreadAuthorKind,
  PrThreadTag,
  PullRequestState,
  RunStatus,
} from "../../db/schema";
import { GuardrailsRepository } from "../../guardrails/guardrails.repository";
import { budgetStageOf } from "../../runs/console.resources";
import { inheritedTaskOf } from "../../runs/console.route";
import { readSpendTotals, type SpendTotals } from "../../runs/run.spend";
import type { PageWindow } from "../../tenancy/pagination";
import type { GateAggregate } from "../gates/gate.engine";
import { VERIFICATION_TASK_KIND, type RouteCapRow } from "./page.spend";

/** A connection or a transaction. */
type Reader = Kysely<Database> | Transaction<Database>;

/** What the listing is narrowed by. */
export interface PrListFilter {
  /** Only these states; absent is every state. */
  readonly states?: readonly PullRequestState[];
  /** Only PRs with (`true`) or without (`false`) an open approval slot; absent is both. */
  readonly reviewRequested?: boolean;
}

/** The loop that opened a PR. */
export interface PrRunRow {
  readonly id: string;
  readonly loopSeq: number;
  readonly issueNumber: number;
  readonly model: string;
  readonly workflowTag: string;
  readonly workflowVersionPin: number | null;
  readonly status: RunStatus;
  readonly finishedAt: Date | null;
}

/** The ticket a PR closes. */
export interface PrTicketRow {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly url: string;
}

/** A PR, with its run and ticket — the page's head and a listing row's body. */
export interface PrHeadRow {
  readonly id: string;
  readonly sourceId: string;
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly state: PullRequestState;
  readonly mergedAt: Date | null;
  readonly mergedBy: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly run: PrRunRow | null;
  readonly ticket: PrTicketRow | null;
}

/** A PR's latest revision, as a listing row names it. */
export interface LatestRevisionRow {
  readonly id: string;
  readonly seq: number;
  readonly headSha: string;
  readonly pushedAt: Date;
}

/** One listing row. */
export interface PrListRow extends PrHeadRow {
  readonly latestRevision: LatestRevisionRow | null;
  /** Whether an approval slot is open — the needs-you flag. */
  readonly reviewRequested: boolean;
}

/** One revision, with what joins it to the loop (decision V4). */
export interface RevisionRow extends LatestRevisionRow {
  readonly files: readonly PrRevisionFile[];
  readonly diffExcerpt: string | null;
  /** The stage attempt the push is linked to (`run_stage_id`), or null. */
  readonly stageAttempt: { readonly stageKey: string; readonly attempt: number } | null;
  /** The run commit the head sha matches, or null. */
  readonly commitMessage: string | null;
}

/** One gate's newest verdict on one revision — a `pr_gate_results_latest` row. */
export interface GateRowRecord {
  readonly revisionId: string;
  readonly key: PrGateKey;
  readonly label: string;
  readonly required: boolean;
  readonly sortOrder: number;
  readonly source: string;
  readonly verdict: PrGateVerdict;
  readonly evidence: string | null;
  readonly evidenceRef: PrGateEvidenceRef | null;
  readonly evaluatedAt: Date;
  readonly providerVersion: string;
}

/** A test attempt, as the strip names it. */
export interface TestAttemptRow {
  readonly id: string;
  readonly attemptSeq: number;
}

/** A failure classification that caused a correction round (decision V4). */
export interface ClassificationRow {
  readonly id: string;
  readonly testRunId: string;
  readonly class: FailureClass;
  readonly subtype: string | null;
  readonly note: string | null;
  readonly actor: string;
  readonly createdAt: Date;
}

/** One review-thread entry. */
export interface ThreadRow {
  readonly id: string;
  readonly revisionId: string | null;
  readonly revisionSeq: number | null;
  readonly authorKind: PrThreadAuthorKind;
  readonly authorName: string;
  readonly tag: PrThreadTag;
  readonly body: string;
  readonly blocking: boolean;
  readonly resolved: boolean;
  readonly resolutionBody: string | null;
  readonly simulated: boolean;
  readonly createdAt: Date;
}

/** The review thread and its counts. */
export interface ThreadRows {
  readonly entries: readonly ThreadRow[];
  /** `pr_thread_summary`'s `entry_count`. */
  readonly entryCount: number;
  /** `pr_thread_summary`'s `open_count` — blocking and unresolved. */
  readonly openCount: number;
}

/** A person, by id and display name. */
export interface PersonRow {
  readonly id: string;
  readonly name: string;
}

/** An approval slot (V065). */
export interface ApprovalRow {
  readonly id: string;
  readonly state: PrApprovalState;
  readonly requestedRevisionId: string | null;
  readonly requestedBy: PersonRow | null;
  readonly requestedAt: Date;
  readonly hostReviewer: string | null;
  readonly hostRequest: PrApprovalHostRequest | null;
  readonly hostDetail: string | null;
  readonly decidedRevisionId: string | null;
  readonly decidedBy: PersonRow | null;
  readonly decidedAt: Date | null;
  readonly note: string | null;
}

/** A loop return (V065). */
export interface LoopReturnRow {
  readonly id: string;
  readonly revisionId: string | null;
  readonly controlId: string;
  readonly gateKeys: readonly string[];
  readonly expectedStageKey: string | null;
  readonly expectedAttempt: number | null;
  readonly requestedBy: string | null;
  readonly createdAt: Date;
}

/** What a new loop return records. */
export interface NewLoopReturn {
  readonly prId: string;
  readonly revisionId: string;
  readonly controlId: string;
  readonly gateKeys: readonly string[];
  readonly expected: { readonly stageKey: string; readonly attempt: number } | null;
  readonly requestedBy: string;
}

/** The run's ledger, whole and its verification share. */
export interface SpendRows {
  readonly loop: SpendTotals;
  readonly verification: SpendTotals;
}

/** A PR as a head action locks it. */
export interface LockedPr {
  readonly id: string;
  readonly state: PullRequestState;
  readonly runId: string | null;
  readonly sourceId: string;
  readonly number: number;
  /** The newest revision's id, or null when none is recorded. */
  readonly latestRevisionId: string | null;
}

/** The statements of one head action, inside its transaction. */
export interface PageTransaction {
  /**
   * Lock one PR of the workspace.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @returns It, or undefined when it is absent or another workspace's.
   */
  lockPr(organizationId: string, prId: string): Promise<LockedPr | undefined>;
  /**
   * @param prId - The PR.
   * @returns Its open approval slot, or undefined.
   */
  openApproval(prId: string): Promise<ApprovalRow | undefined>;
  /**
   * Open a slot.
   *
   * @param prId - The PR.
   * @param revisionId - The revision a review is asked about.
   * @param requestedBy - Who asked.
   * @returns The new slot's id.
   */
  insertApproval(prId: string, revisionId: string, requestedBy: string): Promise<string>;
  /**
   * Answer a slot.
   *
   * @param approvalId - The open slot.
   * @param state - `approved` or `declined`.
   * @param decidedBy - Who answered.
   * @param revisionId - The revision they answered on.
   * @param note - Their note, or null.
   */
  decideApproval(
    approvalId: string,
    state: Exclude<PrApprovalState, "requested">,
    decidedBy: string,
    revisionId: string,
    note: string | null,
  ): Promise<void>;
}

/** The page's store — what its unit suites stand in for. */
export interface PageStore {
  /**
   * One page of the workspace's PRs, most recently updated first.
   *
   * @param organizationId - The workspace.
   * @param filter - The narrowing.
   * @param window - The page.
   * @returns The rows and the total ignoring the window.
   */
  list(
    organizationId: string,
    filter: PrListFilter,
    window: PageWindow,
  ): Promise<{ rows: PrListRow[]; total: number }>;
  /**
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @returns It with its run and ticket, or undefined when absent or another workspace's.
   */
  head(organizationId: string, prId: string): Promise<PrHeadRow | undefined>;
  /**
   * @param prId - The PR.
   * @returns Its revisions, oldest first.
   */
  revisions(prId: string): Promise<RevisionRow[]>;
  /**
   * @param prId - The PR.
   * @returns Every gate's newest verdict on every revision, by revision then card order.
   */
  gateRows(prId: string): Promise<GateRowRecord[]>;
  /**
   * @param revisionIds - Revisions.
   * @returns `pr_gate_aggregate` of each, by revision id.
   */
  aggregates(revisionIds: readonly string[]): Promise<Map<string, GateAggregate>>;
  /**
   * @param organizationId - The workspace.
   * @param testRunIds - Attempts a snapshot cites.
   * @returns Each that exists in the workspace, by id.
   */
  testAttempts(
    organizationId: string,
    testRunIds: readonly string[],
  ): Promise<Map<string, TestAttemptRow>>;
  /**
   * @param organizationId - The workspace.
   * @param testRunIds - Attempts.
   * @returns The newest current (not superseded) classification on a case of each, by attempt id.
   */
  classifications(
    organizationId: string,
    testRunIds: readonly string[],
  ): Promise<Map<string, ClassificationRow>>;
  /**
   * @param prId - The PR.
   * @returns Its thread, oldest first, with `pr_thread_summary`'s counts.
   */
  thread(prId: string): Promise<ThreadRows>;
  /**
   * @param prId - The PR.
   * @returns Its newest approval slot, or undefined.
   */
  approval(prId: string): Promise<ApprovalRow | undefined>;
  /**
   * @param prId - The PR.
   * @returns Its loop returns, newest first.
   */
  loopReturns(prId: string): Promise<LoopReturnRow[]>;
  /**
   * @param runId - The PR's run.
   * @returns Its ledger, whole and tagged `verify`.
   */
  spend(runId: string): Promise<SpendRows>;
  /**
   * The route whose cap the run is measured against — the console's rule: the model stage that
   * started most recently, its `inherit_task` in the pinned document, that task kind's route.
   *
   * @param organizationId - The workspace.
   * @param run - The run.
   * @returns The route, or undefined when there is none to read.
   */
  routeCap(organizationId: string, run: PrRunRow): Promise<RouteCapRow | undefined>;
  /**
   * @param runId - The run.
   * @returns The stage a correction round retries — the active one, else the latest that ran.
   */
  currentStage(runId: string): Promise<{ stageKey: string; attempt: number } | undefined>;
  /**
   * Record a loop return; a second record for the same control is ignored.
   *
   * @param row - What to record.
   * @returns The stored row — the earlier one on a replay.
   */
  recordLoopReturn(row: NewLoopReturn): Promise<LoopReturnRow>;
  /**
   * Record how the host review request landed on a slot.
   *
   * @param approvalId - The slot.
   * @param reviewer - The login asked.
   * @param outcome - How it landed.
   * @param detail - The host's refusal, or null.
   */
  setHostRequest(
    approvalId: string,
    reviewer: string,
    outcome: PrApprovalHostRequest,
    detail: string | null,
  ): Promise<void>;
  /**
   * @param approvalId - A slot.
   * @returns It, or undefined.
   */
  approvalById(approvalId: string): Promise<ApprovalRow | undefined>;
  /**
   * Run a head action in a transaction.
   *
   * @param work - What to do with it.
   * @returns What `work` returned.
   */
  transaction<T>(work: (tx: PageTransaction) => Promise<T>): Promise<T>;
}

/** The PostgreSQL {@link PageStore}. */
@Injectable()
export class PageRepository implements PageStore {
  /**
   * @param database - The pool.
   * @param guardrails - The run's pin and pinned document, read as AP.3 reads them.
   */
  constructor(
    private readonly database: DatabaseService,
    private readonly guardrails: GuardrailsRepository,
  ) {}

  /** @inheritdoc */
  async list(
    organizationId: string,
    filter: PrListFilter,
    window: PageWindow,
  ): Promise<{ rows: PrListRow[]; total: number }> {
    const db = this.database.db;
    let scoped = db
      .selectFrom("pull_requests as p")
      .where("p.organization_id", "=", organizationId);

    if (filter.states !== undefined && filter.states.length > 0) {
      scoped = scoped.where("p.state", "in", [...filter.states]);
    }

    if (filter.reviewRequested !== undefined) {
      const wanted = filter.reviewRequested;

      scoped = scoped.where((eb) => {
        const open = eb.exists(
          eb
            .selectFrom("pr_approvals as a")
            .select("a.id")
            .whereRef("a.pr_id", "=", "p.id")
            .where("a.state", "=", "requested"),
        );

        return wanted ? open : eb.not(open);
      });
    }

    const counted = await scoped
      .select((eb) => eb.fn.countAll<string>().as("total"))
      .executeTakeFirstOrThrow();
    const ids = await scoped
      .select("p.id")
      .orderBy("p.updated_at", "desc")
      .orderBy("p.id", "desc")
      .limit(window.limit)
      .offset(window.offset)
      .execute();
    const prIds = ids.map((row) => row.id);
    const heads = await this.heads(db, organizationId, prIds);
    const latest = await this.latestRevisions(prIds);
    const open =
      prIds.length === 0
        ? []
        : await db
            .selectFrom("pr_approvals")
            .select("pr_id")
            .where("state", "=", "requested")
            .where("pr_id", "in", prIds)
            .execute();
    const requested = new Set(open.map((row) => row.pr_id));

    return {
      total: Number(counted.total),
      rows: ids.flatMap((row) => {
        const head = heads.get(row.id);

        return head === undefined
          ? []
          : [
              {
                ...head,
                latestRevision: latest.get(row.id) ?? null,
                reviewRequested: requested.has(row.id),
              },
            ];
      }),
    };
  }

  /** @inheritdoc */
  async head(organizationId: string, prId: string): Promise<PrHeadRow | undefined> {
    return (await this.heads(this.database.db, organizationId, [prId])).get(prId);
  }

  /**
   * PRs of the workspace with their runs and tickets.
   *
   * @param reader - The connection.
   * @param organizationId - The workspace.
   * @param prIds - The PRs.
   * @returns Each found, by id.
   */
  private async heads(
    reader: Reader,
    organizationId: string,
    prIds: readonly string[],
  ): Promise<Map<string, PrHeadRow>> {
    if (prIds.length === 0) {
      return new Map();
    }

    const rows = await reader
      .selectFrom("pull_requests as p")
      .leftJoin("runs as r", (join) =>
        join.onRef("r.id", "=", "p.run_id").onRef("r.organization_id", "=", "p.organization_id"),
      )
      .leftJoin("tickets as t", (join) =>
        join.onRef("t.id", "=", "p.ticket_id").onRef("t.organization_id", "=", "p.organization_id"),
      )
      .select([
        "p.id",
        "p.source_id",
        "p.external_number",
        "p.external_url",
        "p.title",
        "p.head_branch",
        "p.base_branch",
        "p.additions",
        "p.deletions",
        "p.changed_files",
        "p.state",
        "p.merged_at",
        "p.merged_by",
        "p.created_at",
        "p.updated_at",
        "r.id as run_id",
        "r.loop_seq",
        "r.issue_number",
        "r.model",
        "r.workflow_tag",
        "r.workflow_version_pin",
        "r.status as run_status",
        "r.finished_at",
        "t.id as ticket_id",
        "t.external_key",
        "t.title as ticket_title",
        "t.external_url as ticket_url",
      ])
      .where("p.organization_id", "=", organizationId)
      .where("p.id", "in", [...prIds])
      .execute();

    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          sourceId: row.source_id,
          number: row.external_number,
          url: row.external_url,
          title: row.title,
          headBranch: row.head_branch,
          baseBranch: row.base_branch,
          additions: row.additions,
          deletions: row.deletions,
          changedFiles: row.changed_files,
          state: row.state,
          mergedAt: row.merged_at,
          mergedBy: row.merged_by,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          run:
            row.run_id === null
              ? null
              : {
                  id: row.run_id,
                  loopSeq: row.loop_seq as number,
                  issueNumber: row.issue_number as number,
                  model: row.model as string,
                  workflowTag: row.workflow_tag as string,
                  workflowVersionPin: row.workflow_version_pin,
                  status: row.run_status as RunStatus,
                  finishedAt: row.finished_at,
                },
          ticket:
            row.ticket_id === null
              ? null
              : {
                  id: row.ticket_id,
                  key: row.external_key as string,
                  title: row.ticket_title as string,
                  url: row.ticket_url as string,
                },
        },
      ]),
    );
  }

  /**
   * The newest revision of each PR.
   *
   * @param prIds - The PRs, already scoped to the workspace.
   * @returns Each PR's latest revision, by PR id.
   */
  private async latestRevisions(prIds: readonly string[]): Promise<Map<string, LatestRevisionRow>> {
    if (prIds.length === 0) {
      return new Map();
    }

    const rows = await this.database.db
      .selectFrom("pr_revisions")
      .distinctOn("pr_id")
      .select(["pr_id", "id", "revision_seq", "head_sha", "pushed_at"])
      .where("pr_id", "in", [...prIds])
      .orderBy("pr_id")
      .orderBy("revision_seq", "desc")
      .execute();

    return new Map(
      rows.map((row) => [
        row.pr_id,
        { id: row.id, seq: row.revision_seq, headSha: row.head_sha, pushedAt: row.pushed_at },
      ]),
    );
  }

  /** @inheritdoc */
  async revisions(prId: string): Promise<RevisionRow[]> {
    const rows = await this.database.db
      .selectFrom("pr_revisions as v")
      .innerJoin("pull_requests as p", "p.id", "v.pr_id")
      .leftJoin("run_stages as s", "s.id", "v.run_stage_id")
      .leftJoin("run_commits as c", (join) =>
        join.onRef("c.run_id", "=", "p.run_id").onRef("c.sha", "=", "v.head_sha"),
      )
      .select([
        "v.id",
        "v.revision_seq",
        "v.head_sha",
        "v.pushed_at",
        "v.files",
        "v.diff_excerpt",
        "s.stage_key",
        "s.attempt",
        "c.message",
      ])
      .where("v.pr_id", "=", prId)
      .orderBy("v.revision_seq")
      .execute();

    return rows.map((row) => ({
      id: row.id,
      seq: row.revision_seq,
      headSha: row.head_sha,
      pushedAt: row.pushed_at,
      files: row.files,
      diffExcerpt: row.diff_excerpt,
      stageAttempt:
        row.stage_key === null || row.attempt === null
          ? null
          : { stageKey: row.stage_key, attempt: row.attempt },
      commitMessage: row.message,
    }));
  }

  /** @inheritdoc */
  async gateRows(prId: string): Promise<GateRowRecord[]> {
    const rows = await this.database.db
      .selectFrom("pr_gate_results_latest as g")
      .innerJoin("pr_revisions as v", "v.id", "g.revision_id")
      .select([
        "g.revision_id",
        "g.gate_key",
        "g.label",
        "g.required",
        "g.sort_order",
        "g.source",
        "g.verdict",
        "g.evidence",
        "g.evidence_ref",
        "g.evaluated_at",
        "g.provider_version",
      ])
      .where("g.pr_id", "=", prId)
      .orderBy("v.revision_seq")
      .orderBy("g.sort_order")
      .orderBy("g.gate_key")
      .execute();

    return rows.map((row) => ({
      revisionId: row.revision_id,
      key: row.gate_key,
      label: row.label,
      required: row.required,
      sortOrder: row.sort_order,
      source: row.source,
      verdict: row.verdict,
      evidence: row.evidence,
      evidenceRef: row.evidence_ref,
      evaluatedAt: row.evaluated_at,
      providerVersion: row.provider_version,
    }));
  }

  /** @inheritdoc */
  async aggregates(revisionIds: readonly string[]): Promise<Map<string, GateAggregate>> {
    if (revisionIds.length === 0) {
      return new Map();
    }

    const { rows } = await sql<{
      revision_id: string;
      required_count: number;
      green_count: number;
      red_count: number;
      satisfied_count: number;
      merge_ready: boolean;
    }>`select v.id as revision_id, a.*
         from unnest(${[...revisionIds]}::uuid[]) as v (id)
        cross join lateral ouroboros.pr_gate_aggregate(v.id) as a`.execute(this.database.db);

    return new Map(
      rows.map((row) => [
        row.revision_id,
        {
          requiredCount: row.required_count,
          greenCount: row.green_count,
          redCount: row.red_count,
          satisfiedCount: row.satisfied_count,
          mergeReady: row.merge_ready,
        },
      ]),
    );
  }

  /** @inheritdoc */
  async testAttempts(
    organizationId: string,
    testRunIds: readonly string[],
  ): Promise<Map<string, TestAttemptRow>> {
    if (testRunIds.length === 0) {
      return new Map();
    }

    const rows = await this.database.db
      .selectFrom("test_runs")
      .select(["id", "attempt_seq"])
      .where("organization_id", "=", organizationId)
      .where("id", "in", [...testRunIds])
      .execute();

    return new Map(rows.map((row) => [row.id, { id: row.id, attemptSeq: row.attempt_seq }]));
  }

  /** @inheritdoc */
  async classifications(
    organizationId: string,
    testRunIds: readonly string[],
  ): Promise<Map<string, ClassificationRow>> {
    if (testRunIds.length === 0) {
      return new Map();
    }

    const rows = await this.database.db
      .selectFrom("failure_classifications as f")
      .innerJoin("test_cases as c", "c.id", "f.test_case_id")
      .innerJoin("test_suites as s", "s.id", "c.test_suite_id")
      .distinctOn("s.test_run_id")
      .select([
        "s.test_run_id",
        "f.id",
        "f.class",
        "f.subtype",
        "f.note",
        "f.actor",
        "f.created_at",
      ])
      .where("f.organization_id", "=", organizationId)
      .where("f.superseded_by", "is", null)
      .where("s.test_run_id", "in", [...testRunIds])
      .orderBy("s.test_run_id")
      .orderBy("f.created_at", "desc")
      .orderBy("f.id", "desc")
      .execute();

    return new Map(
      rows.map((row) => [
        row.test_run_id,
        {
          id: row.id,
          testRunId: row.test_run_id,
          class: row.class,
          subtype: row.subtype,
          note: row.note,
          actor: row.actor,
          createdAt: row.created_at,
        },
      ]),
    );
  }

  /** @inheritdoc */
  async thread(prId: string): Promise<ThreadRows> {
    const db = this.database.db;
    const entries = await db
      .selectFrom("pr_thread_entries as e")
      .leftJoin("pr_revisions as v", "v.id", "e.revision_id")
      .select([
        "e.id",
        "e.revision_id",
        "v.revision_seq",
        "e.author_kind",
        "e.author_name",
        "e.tag",
        "e.body",
        "e.blocking",
        "e.resolved",
        "e.resolution_body",
        "e.simulated",
        "e.created_at",
      ])
      .where("e.pr_id", "=", prId)
      .orderBy("e.created_at")
      .orderBy("e.id")
      .execute();
    const { rows } = await sql<{
      entry_count: number;
      open_count: number;
    }>`select * from ouroboros.pr_thread_summary(${prId}::uuid)`.execute(db);

    return {
      entries: entries.map((row) => ({
        id: row.id,
        revisionId: row.revision_id,
        revisionSeq: row.revision_seq,
        authorKind: row.author_kind,
        authorName: row.author_name,
        tag: row.tag,
        body: row.body,
        blocking: row.blocking,
        resolved: row.resolved,
        resolutionBody: row.resolution_body,
        simulated: row.simulated,
        createdAt: row.created_at,
      })),
      entryCount: rows[0]?.entry_count ?? 0,
      openCount: rows[0]?.open_count ?? 0,
    };
  }

  /** @inheritdoc */
  async approval(prId: string): Promise<ApprovalRow | undefined> {
    return readApproval(this.database.db, (query) =>
      query
        .where("a.pr_id", "=", prId)
        .orderBy("a.requested_at", "desc")
        .orderBy("a.id", "desc")
        .limit(1),
    );
  }

  /** @inheritdoc */
  async approvalById(approvalId: string): Promise<ApprovalRow | undefined> {
    return readApproval(this.database.db, (query) => query.where("a.id", "=", approvalId));
  }

  /** @inheritdoc */
  async loopReturns(prId: string): Promise<LoopReturnRow[]> {
    const rows = await this.database.db
      .selectFrom("pr_loop_returns")
      .selectAll()
      .where("pr_id", "=", prId)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .execute();

    return rows.map(loopReturnRow);
  }

  /** @inheritdoc */
  async spend(runId: string): Promise<SpendRows> {
    const db = this.database.db;
    const [loop, verification] = await Promise.all([
      readSpendTotals(db, runId),
      readSpendTotals(db, runId, VERIFICATION_TASK_KIND),
    ]);

    return { loop, verification };
  }

  /** @inheritdoc */
  async routeCap(organizationId: string, run: PrRunRow): Promise<RouteCapRow | undefined> {
    const db = this.database.db;

    if (run.workflowVersionPin === null) {
      return undefined;
    }

    const stages = await db
      .selectFrom("run_stages")
      .selectAll()
      .where("run_id", "=", run.id)
      .execute();
    const budget = budgetStageOf(stages);

    if (budget === undefined) {
      return undefined;
    }

    const pinned = await this.guardrails.pinnedDefinition(
      db,
      organizationId,
      run.workflowTag,
      run.workflowVersionPin,
    );
    const task =
      pinned === undefined ? undefined : inheritedTaskOf(pinned.definition, budget.stage_key);

    if (task === undefined) {
      return undefined;
    }

    // The console's `routeCap` statement (runs/console.repository.ts), for the same question.
    const route = await db
      .selectFrom("routes")
      .innerJoin("task_kinds", "task_kinds.id", "routes.task_kind_id")
      .select(["routes.tag", "routes.max_cost_cents_per_run"])
      .where("routes.organization_id", "=", organizationId)
      .where("task_kinds.name", "=", task)
      .executeTakeFirst();

    return route === undefined
      ? undefined
      : { tag: route.tag, maxCostCentsPerRun: route.max_cost_cents_per_run };
  }

  /** @inheritdoc */
  async currentStage(runId: string): Promise<{ stageKey: string; attempt: number } | undefined> {
    // Triage's rule (triage.repository.ts `currentStage`): the active stage, else the latest that ran.
    const row = await this.database.db
      .selectFrom("run_stages")
      .select(["stage_key", "attempt"])
      .where("run_id", "=", runId)
      .where("status", "in", ["active", "failed", "succeeded"])
      .orderBy(sql`status = 'active'`, "desc")
      .orderBy(sql`coalesce(started_at, created_at)`, "desc")
      .orderBy("attempt", "desc")
      .limit(1)
      .executeTakeFirst();

    return row === undefined ? undefined : { stageKey: row.stage_key, attempt: row.attempt };
  }

  /** @inheritdoc */
  async recordLoopReturn(row: NewLoopReturn): Promise<LoopReturnRow> {
    const db = this.database.db;

    await db
      .insertInto("pr_loop_returns")
      .values({
        pr_id: row.prId,
        revision_id: row.revisionId,
        control_id: row.controlId,
        gate_keys: [...row.gateKeys],
        expected_stage_key: row.expected?.stageKey ?? null,
        expected_attempt: row.expected?.attempt ?? null,
        requested_by: row.requestedBy,
      })
      .onConflict((conflict) => conflict.column("control_id").doNothing())
      .execute();

    const stored = await db
      .selectFrom("pr_loop_returns")
      .selectAll()
      .where("control_id", "=", row.controlId)
      .executeTakeFirstOrThrow();

    return loopReturnRow(stored);
  }

  /** @inheritdoc */
  async setHostRequest(
    approvalId: string,
    reviewer: string,
    outcome: PrApprovalHostRequest,
    detail: string | null,
  ): Promise<void> {
    await this.database.db
      .updateTable("pr_approvals")
      .set({ host_reviewer: reviewer, host_request: outcome, host_detail: detail })
      .where("id", "=", approvalId)
      .execute();
  }

  /** @inheritdoc */
  transaction<T>(work: (tx: PageTransaction) => Promise<T>): Promise<T> {
    return this.database.db.transaction().execute((trx) => work(new PgPageTransaction(trx)));
  }
}

/** One head action's statements, over its transaction. */
class PgPageTransaction implements PageTransaction {
  /** @param trx - The transaction. */
  constructor(private readonly trx: Transaction<Database>) {}

  /** @inheritdoc */
  async lockPr(organizationId: string, prId: string): Promise<LockedPr | undefined> {
    const pr = await this.trx
      .selectFrom("pull_requests")
      .select(["id", "state", "run_id", "source_id", "external_number"])
      .where("id", "=", prId)
      .where("organization_id", "=", organizationId)
      .forUpdate()
      .executeTakeFirst();

    if (pr === undefined) {
      return undefined;
    }

    const latest = await this.trx
      .selectFrom("pr_revisions")
      .select("id")
      .where("pr_id", "=", prId)
      .orderBy("revision_seq", "desc")
      .limit(1)
      .executeTakeFirst();

    return {
      id: pr.id,
      state: pr.state,
      runId: pr.run_id,
      sourceId: pr.source_id,
      number: pr.external_number,
      latestRevisionId: latest?.id ?? null,
    };
  }

  /** @inheritdoc */
  openApproval(prId: string): Promise<ApprovalRow | undefined> {
    return readApproval(this.trx, (query) =>
      query.where("a.pr_id", "=", prId).where("a.state", "=", "requested"),
    );
  }

  /** @inheritdoc */
  async insertApproval(prId: string, revisionId: string, requestedBy: string): Promise<string> {
    const row = await this.trx
      .insertInto("pr_approvals")
      .values({ pr_id: prId, requested_revision_id: revisionId, requested_by: requestedBy })
      .returning("id")
      .executeTakeFirstOrThrow();

    return row.id;
  }

  /** @inheritdoc */
  async decideApproval(
    approvalId: string,
    state: Exclude<PrApprovalState, "requested">,
    decidedBy: string,
    revisionId: string,
    note: string | null,
  ): Promise<void> {
    await this.trx
      .updateTable("pr_approvals")
      .set({
        state,
        decided_by: decidedBy,
        decided_revision_id: revisionId,
        decided_at: sql<Date>`now()`,
        note,
      })
      .where("id", "=", approvalId)
      .where("state", "=", "requested")
      .execute();
  }
}

/** The approval select, before its predicate. */
type ApprovalQuery = ReturnType<typeof approvalQuery>;

/**
 * An approval slot with its two people's names.
 *
 * @param reader - The connection or transaction.
 * @returns The select, unfiltered.
 */
function approvalQuery(reader: Reader) {
  return reader
    .selectFrom("pr_approvals as a")
    .leftJoin("user as requester", "requester.id", "a.requested_by")
    .leftJoin("user as reviewer", "reviewer.id", "a.decided_by")
    .select([
      "a.id",
      "a.state",
      "a.requested_revision_id",
      "a.requested_by",
      "requester.name as requester_name",
      "a.requested_at",
      "a.host_reviewer",
      "a.host_request",
      "a.host_detail",
      "a.decided_revision_id",
      "a.decided_by",
      "reviewer.name as reviewer_name",
      "a.decided_at",
      "a.note",
    ]);
}

/**
 * Read one approval slot.
 *
 * @param reader - The connection or transaction.
 * @param narrow - The predicate and order.
 * @returns The slot, or undefined.
 */
async function readApproval(
  reader: Reader,
  narrow: (query: ApprovalQuery) => ApprovalQuery,
): Promise<ApprovalRow | undefined> {
  const row = await narrow(approvalQuery(reader)).executeTakeFirst();

  if (row === undefined) {
    return undefined;
  }

  return {
    id: row.id,
    state: row.state,
    requestedRevisionId: row.requested_revision_id,
    requestedBy: person(row.requested_by, row.requester_name),
    requestedAt: row.requested_at,
    hostReviewer: row.host_reviewer,
    hostRequest: row.host_request,
    hostDetail: row.host_detail,
    decidedRevisionId: row.decided_revision_id,
    decidedBy: person(row.decided_by, row.reviewer_name),
    decidedAt: row.decided_at,
    note: row.note,
  };
}

/**
 * @param id - A user id, or null.
 * @param name - Their name, or null.
 * @returns The person, or null when either is gone.
 */
function person(id: string | null, name: string | null): PersonRow | null {
  return id === null || name === null ? null : { id, name };
}

/**
 * @param row - A `pr_loop_returns` row.
 * @returns It, camel-cased.
 */
function loopReturnRow(row: {
  id: string;
  revision_id: string | null;
  control_id: string;
  gate_keys: string[];
  expected_stage_key: string | null;
  expected_attempt: number | null;
  requested_by: string | null;
  created_at: Date;
}): LoopReturnRow {
  return {
    id: row.id,
    revisionId: row.revision_id,
    controlId: row.control_id,
    gateKeys: row.gate_keys,
    expectedStageKey: row.expected_stage_key,
    expectedAttempt: row.expected_attempt,
    requestedBy: row.requested_by,
    createdAt: row.created_at,
  };
}
