/**
 * What the Run Console's three reads answer with, and the pure functions that build each part
 * from rows.
 *
 * AP.2 ([#304](https://github.com/NobuData/ouroboros/issues/304)). The acceptance criterion is
 * that *nothing the page renders is computed in the browser from something the API did not
 * state* — so every number mockup 10 draws is either a column passed through or arithmetic done
 * here: stage durations, the change-set totals, the token and cost sums, the wall clock, the
 * Guardrails card's header pill. What the browser does with these is presentation (`212000` →
 * `212k`), never derivation.
 *
 * ---------------------------------------------------------------------------
 * **Absent data is absent.** A relationship the run does not have is an **omitted field** rather
 * than a placeholder: no reservation → no `farm`; no loop edge → no `returnedFrom`; no evidence →
 * no `evidence`. A *scalar* the schema holds as nullable stays `null` — `branchName`,
 * `finishedAt`, a budget or a cap nobody set — the convention `RunSummary` already keeps, so a
 * client never has to tell `undefined` from `null` on the same kind of field. Transcript entries
 * follow the JSONL projection's rule instead (a null field is absent), because an entry is the
 * same object in both places and should read the same way.
 *
 * **Unpriced is not free.** The cost is `null` with a token count beside it whenever the ledger
 * holds no price for what was spent — decisions **M7** / **N10**, carried forward by **R8**. No
 * function here turns a missing rate into `0`, and `console.resources.spec.ts` asserts it.
 */

import type { RunSummary } from "../dashboard/resources";
import type {
  GuardrailCheck,
  GuardrailEvidence,
  GuardrailVerdict,
  RunCommit,
  RunEvent,
  RunEventActor,
  RunFile,
  RunFileStatus,
  RunGuardrailsLatest,
  RunMergeStrategy,
  RunStage,
  RunStageReturnKind,
  RunStageReturnReason,
  RunStageStatus,
} from "../db/schema";
import { GUARDRAIL_CHECKS } from "../db/schema";
import { SECRETS_RULESET_DISCLOSURE } from "../guardrails/guardrails.ruleset";
import type { SpendTotals } from "./run.spend";

// ---------------------------------------------------------------------------
// GET /api/v1/runs/:id
// ---------------------------------------------------------------------------

/** The whole console page, as one snapshot. */
export interface RunConsoleResource {
  /**
   * When this snapshot was taken — the server's clock, ISO 8601.
   *
   * The *elapsed anchor*: `resources.wallClock.elapsedSeconds` is measured to this instant, so a
   * client ticks forward from a number the server stated rather than from its own clock's idea
   * of `startedAt`, and a skewed laptop does not render a different elapsed time on refresh.
   */
  readonly asOf: string;
  /**
   * The run, in exactly the shape every listing row and dashboard slice has (#71).
   *
   * Carried whole rather than re-spelled into `head`, so the one-shape rule — *a run row has
   * exactly one shape everywhere* — still holds on the page that shows the most of it.
   */
  readonly run: RunSummary;
  /** What the page head adds to the row. */
  readonly head: RunConsoleHead;
  /** The stage timeline — the stepper. */
  readonly timeline: RunTimeline;
  /** *Changes so far*. */
  readonly changes: RunChanges;
  /** *Resources*. */
  readonly resources: RunResources;
  /** *Guardrails*. */
  readonly guardrails: RunGuardrails;
}

/** The page head's facts beyond the run row: eyebrow, pin, branch, watermark, liveness. */
export interface RunConsoleHead {
  /** The *Loop #1847* counter — `runs.loop_seq`. */
  readonly loopSeq: number;
  /** The `14` of `standard-fix v14`, or `null` when nothing was published to pin. */
  readonly workflowVersion: number | null;
  /** `loop/482-canbus-flake`, or `null` until the run has one. */
  readonly branchName: string | null;
  /** Decision **R4**'s watermark — the run was opened by the simulator principal. */
  readonly simulated: boolean;
  /**
   * Whether the run is still moving — its status is one of the three active ones.
   *
   * The same fact the transcript read calls `live`: the `streaming` pill and the pulsing status
   * dot go quiet together the moment a run is terminal.
   */
  readonly live: boolean;
  /** The repository the ticket lives in. Omitted in the one case it cannot be read. */
  readonly repository?: RunRepository;
}

/** A repository, named the way GitHub names it. */
export interface RunRepository {
  /** `github_orgs.login` — `acme`. */
  readonly owner: string;
  /** `github_repos.name` — `helios-firmware`. */
  readonly name: string;
}

/** The stepper: every stage the run has materialised, in pinned order. */
export interface RunTimeline {
  /** The `standard-fix` of the card's `workflow: standard-fix v14` tag. */
  readonly workflowTag: string;
  /** The `14`, or `null`. */
  readonly workflowVersion: number | null;
  /** The stage whose latest attempt is `active`, or `null` when none is. */
  readonly currentStageKey: string | null;
  /** One node per stage, by `position`. */
  readonly stages: RunTimelineStage[];
}

/** One stepper node — a stage, with every attempt it has had. */
export interface RunTimelineStage {
  /** The DSL node id. */
  readonly stageKey: string;
  /** The node's title as the pin had it — the latest attempt's snapshot. */
  readonly label: string;
  /** Order in the pinned workflow, from 1. */
  readonly position: number;
  /** The latest attempt's status — what the node draws (`✓`, `●`, `○`, or the err node). */
  readonly status: RunStageStatus;
  /** The latest attempt's number — the `2` of `attempt 2/3`. */
  readonly attempt: number;
  /** The `3`, or `null` for a stage type that carries no limits. */
  readonly maxAttempts: number | null;
  /**
   * The latest attempt's duration in whole seconds — the `1m 12s` caption — or `null` while it
   * has not both started and finished.
   */
  readonly durationSeconds: number | null;
  /** The latest attempt's warn note — *"attempt 1 failed tests — loop returned from gate ↺"*. */
  readonly note: string | null;
  /** Every attempt, oldest first. */
  readonly attempts: RunStageAttempt[];
}

/** One attempt at one stage. */
export interface RunStageAttempt {
  readonly attempt: number;
  readonly status: RunStageStatus;
  /** ISO 8601, or `null` while it has not begun. */
  readonly startedAt: string | null;
  /** ISO 8601, or `null` while it has not ended. */
  readonly finishedAt: string | null;
  /** Whole seconds between the two, or `null` unless both are set. */
  readonly durationSeconds: number | null;
  /** The note the database composed from the transition, or `null`. */
  readonly note: string | null;
  /** The loop edge this attempt came back through. Omitted for an attempt no edge produced. */
  readonly returnedFrom?: RunStageReturn;
}

/** The transition a note was composed from. */
export interface RunStageReturn {
  readonly stageKey: string;
  readonly kind: RunStageReturnKind;
  readonly reason: RunStageReturnReason;
}

/** *Changes so far*: files, their totals, commits and the merge tag. */
export interface RunChanges {
  /** Every file of the change-set, in the order it entered it. */
  readonly files: RunChangedFile[];
  /** The card's `3 files` and the sums under it. */
  readonly totals: RunChangeTotals;
  /** The run's commits, in the writer's order. */
  readonly commits: RunChangeCommit[];
  /** The *will squash on merge* tag's source, or `null` when the pin opens no pull request. */
  readonly mergeStrategy: RunMergeStrategy | null;
}

/** One file row — `drivers/can/telemetry_buf.c +38 −12`. */
export interface RunChangedFile {
  readonly path: string;
  readonly status: RunFileStatus;
  readonly additions: number;
  readonly deletions: number;
}

/** The change-set, summed. */
export interface RunChangeTotals {
  readonly files: number;
  readonly additions: number;
  readonly deletions: number;
}

/** One commit row — `a41c9e2 · can: replace telemetry k_fifo with k_msgq + frame seq`. */
export interface RunChangeCommit {
  /** The name as reported — abbreviated or whole. */
  readonly sha: string;
  /** The seven-character chip. */
  readonly shortSha: string;
  /** The message's first line — what the row prints. */
  readonly subject: string;
  /** When git says it was made, ISO 8601. */
  readonly committedAt: string;
}

/** *Resources*: four rows, each computed from the system that owns its number (**R8**). */
export interface RunResources {
  readonly tokens: RunTokenResource;
  readonly cost: RunCostResource;
  /** The farm reservation. **Omitted** when the run holds none — the row is not drawn. */
  readonly farm?: RunFarmResource;
  readonly wallClock: RunWallClock;
}

/** `212k / 400k budget`. */
export interface RunTokenResource {
  /** Every token attributed to the run — in plus out. */
  readonly used: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  /**
   * The model stage's pinned `limits.token_budget` — the `400k` — or `null` when no model stage
   * has started, in which case the meter is count-only.
   */
  readonly budget: number | null;
  /** Which stage the budget is that stage's, or `null` with it. */
  readonly budgetStageKey: string | null;
}

/** `$1.14 / $2.50 cap`. */
export interface RunCostResource {
  /**
   * What the run has cost, in cents, as a decimal string — or `null` when nothing attributed to
   * it is priced. **Never `"0"` for missing rates**: that would say the run was free.
   */
  readonly costCents: string | null;
  /**
   * How many ledger rows carry no price. Non-zero beside a non-null cost means the cost is a
   * lower bound.
   */
  readonly unpricedEvents: number;
  /** The route's *Max cost per run* in cents — the `$2.50` — or `null` when none applies. */
  readonly capCents: number | null;
  /** The route the cap belongs to — `implement-primary` — or `null` with it. */
  readonly routeTag: string | null;
}

/** `forge-02 reserved`. */
export interface RunFarmResource {
  readonly buildJobId: string;
  /** The farm's display number. */
  readonly jobNumber: number;
  /** Where the job is — what colours the dot. */
  readonly jobStatus: string;
  /** The runner holding it — `forge-02` — or `null` while no runner has taken it. */
  readonly runnerName: string | null;
}

/** `12m 40s`. */
export interface RunWallClock {
  readonly startedAt: string;
  /** `null` while the run is live. */
  readonly finishedAt: string | null;
  /** Whole seconds from start to finish, or to `asOf` while live. */
  readonly elapsedSeconds: number;
}

/** The Guardrails card's header pill. */
export type RunGuardrailsStatus = "clean" | "violations" | "pending" | "unevaluated";

/** *Guardrails*: the latest verdict per check, the pill, the footer and the tooltip. */
export interface RunGuardrails {
  /**
   * `violations` when any check failed; else `pending` when any has not answered; else `clean`
   * — and `unevaluated` when the run has no verdicts at all, which is not the same as clean.
   */
  readonly status: RunGuardrailsStatus;
  /** One row per check that has a verdict, in the card's order. */
  readonly checks: RunGuardrailCheck[];
  /** The footer — *Policy: standard-fix v14 · tenant acme-robotics*. */
  readonly policy: RunGuardrailPolicy;
  /** What a `secrets` pass can and cannot claim — the tooltip (AP.3's honesty). */
  readonly secrets: RunSecretsDisclosure;
}

/** One verdict row. */
export interface RunGuardrailCheck {
  readonly check: GuardrailCheck;
  readonly verdict: GuardrailVerdict;
  /** Where, and by which rule — never what. Omitted when the verdict carries none. */
  readonly evidence?: GuardrailEvidence;
  readonly rulesetVersion: string | null;
  readonly evaluatedAt: string;
  readonly changeSetSeq: number | null;
}

/** The policy footer. */
export interface RunGuardrailPolicy {
  readonly workflowTag: string;
  /** The version the latest verdict applied, else the run's pin, else `null`. */
  readonly workflowVersion: number | null;
  /** The workspace's slug. */
  readonly tenant: string;
}

/** The secrets ruleset's disclosure, as `guardrails.ruleset.ts` states it. */
export interface RunSecretsDisclosure {
  readonly version: string;
  readonly ruleCount: number;
  readonly recallClass: string;
  readonly summary: string;
  readonly limitation: string;
}

// ---------------------------------------------------------------------------
// GET /api/v1/runs/:id/events
// ---------------------------------------------------------------------------

/** One page of the transcript's tail. */
export interface RunEventsPage {
  readonly runId: string;
  /** The cursor asked for. */
  readonly after: number;
  /** The entries with `after < seq ≤ nextAfter`, in `seq` order. */
  readonly entries: RunEventEntry[];
  /** Ask with `?after=` this next. Equal to `after` when nothing was returned. */
  readonly nextAfter: number;
  /** The run's highest sequence number when this page was read. */
  readonly latestSeq: number;
  /** Whether entries past `nextAfter` already exist — ask again now rather than after `pollAfter`. */
  readonly hasMore: boolean;
  /** Whether the run is still moving. `false` for a terminal run, whatever arrived last. */
  readonly live: boolean;
  /** Whether a cap has refused entries — the transcript carries an elision marker. */
  readonly elided: boolean;
  /** Seconds to wait before asking again — `X-Ouro-Poll-After`, in the body too. */
  readonly pollAfter: number;
}

/** One transcript entry — the JSONL line's fields, camel-cased, with null fields absent. */
export interface RunEventEntry {
  readonly seq: number;
  readonly ts: string;
  readonly actor: RunEventActor;
  readonly stageKey?: string;
  readonly attempt?: number;
  readonly toolTag?: string;
  readonly modelId?: string;
  readonly body?: string;
  readonly payload?: unknown;
  readonly simulated: boolean;
  /** Present on the cap's elision marker, and only there. */
  readonly elision?: RunEventElision;
}

/** What an elision marker accounts for. */
export interface RunEventElision {
  /** How many entries the cap refused. */
  readonly events: number;
  /** How many bytes they weighed. */
  readonly bytes: number;
  /** When the first refused entry happened. */
  readonly from: string;
  /** When the most recent one did. */
  readonly to: string;
}

// ---------------------------------------------------------------------------
// The mappers.
// ---------------------------------------------------------------------------

/**
 * Whole seconds between two instants, or `null` unless both are known.
 *
 * @param start - The beginning.
 * @param end - The end.
 * @returns `⌊(end − start) / 1000⌋`, never negative.
 */
export function secondsBetween(start: Date | null, end: Date | null): number | null {
  if (start === null || end === null) {
    return null;
  }

  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
}

/**
 * One attempt row as the stepper reads it.
 *
 * @param row - A `run_stages` row.
 * @returns The attempt.
 */
function attemptOf(row: RunStage): RunStageAttempt {
  const attempt: RunStageAttempt = {
    attempt: row.attempt,
    status: row.status,
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    durationSeconds: secondsBetween(row.started_at, row.finished_at),
    note: row.note,
  };

  if (
    row.returned_from_stage_key === null ||
    row.returned_from_kind === null ||
    row.return_reason === null
  ) {
    return attempt;
  }

  return {
    ...attempt,
    returnedFrom: {
      stageKey: row.returned_from_stage_key,
      kind: row.returned_from_kind,
      reason: row.return_reason,
    },
  };
}

/**
 * The stepper, from the run's stage history (decision **R1**).
 *
 * @param workflowTag - `runs.workflow_tag`.
 * @param workflowVersion - `runs.workflow_version_pin`.
 * @param rows - Every `run_stages` row of the run, in any order.
 * @returns One node per stage key, ordered by position (then key, so two stages a document
 *   placed at one position still order the same way on every read); each node's attempts are
 *   oldest first and its top-level fields are its latest attempt's.
 */
export function timelineOf(
  workflowTag: string,
  workflowVersion: number | null,
  rows: readonly RunStage[],
): RunTimeline {
  const byKey = new Map<string, RunStage[]>();

  for (const row of rows) {
    const attempts = byKey.get(row.stage_key) ?? [];
    attempts.push(row);
    byKey.set(row.stage_key, attempts);
  }

  const stages = [...byKey.values()].map((attempts): RunTimelineStage => {
    attempts.sort((a, b) => a.attempt - b.attempt);
    const latest = attempts[attempts.length - 1];

    return {
      stageKey: latest.stage_key,
      label: latest.stage_label,
      position: latest.position,
      status: latest.status,
      attempt: latest.attempt,
      maxAttempts: latest.max_attempts,
      durationSeconds: secondsBetween(latest.started_at, latest.finished_at),
      note: latest.note,
      attempts: attempts.map(attemptOf),
    };
  });

  stages.sort((a, b) => a.position - b.position || a.stageKey.localeCompare(b.stageKey));

  return {
    workflowTag,
    workflowVersion,
    currentStageKey: stages.find((stage) => stage.status === "active")?.stageKey ?? null,
    stages,
  };
}

/**
 * The stage whose pinned token budget the Resources meter divides into.
 *
 * The run's spend is summed across every stage, and it is measured against the budget of the
 * **model stage that started most recently** — the one spending now, or the last one that did.
 * A stage type with no `limits` (queued, build, test) carries no budget, so a run sitting in
 * *Build* still reads against *Implement*'s `400k` rather than falling back to count-only.
 *
 * @param rows - The run's `run_stages` rows.
 * @returns The row, or `undefined` when no model stage has started — the count-only case.
 */
export function budgetStageOf(rows: readonly RunStage[]): RunStage | undefined {
  let chosen: RunStage | undefined;

  for (const row of rows) {
    if (row.token_budget === null || row.started_at === null) {
      continue;
    }

    const newer =
      chosen?.started_at == null ||
      row.started_at.getTime() > chosen.started_at.getTime() ||
      (row.started_at.getTime() === chosen.started_at.getTime() && row.attempt > chosen.attempt);

    if (newer) {
      chosen = row;
    }
  }

  return chosen;
}

/**
 * The first line of a commit message.
 *
 * @param message - `run_commits.message`.
 * @returns Everything before the first line break, trimmed of trailing whitespace.
 */
export function subjectOf(message: string): string {
  return message.split(/\r?\n/, 1)[0].trimEnd();
}

/**
 * *Changes so far*, from the change-set rows.
 *
 * @param files - The run's `run_files`, in the order they are to be drawn.
 * @param commits - The run's `run_commits`, in `seq` order.
 * @param mergeStrategy - `runs.merge_strategy`.
 * @returns The card. The totals are sums over the rows passed — never a stored aggregate (**R8**).
 */
export function changesOf(
  files: readonly RunFile[],
  commits: readonly RunCommit[],
  mergeStrategy: RunMergeStrategy | null,
): RunChanges {
  return {
    files: files.map((file) => ({
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
    })),
    totals: {
      files: files.length,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    },
    commits: commits.map((commit) => ({
      sha: commit.sha,
      shortSha: commit.sha.slice(0, 7),
      subject: subjectOf(commit.message),
      committedAt: commit.committed_at.toISOString(),
    })),
    mergeStrategy,
  };
}

/** The route a cap was read from. */
export interface RouteCap {
  /** `routes.tag`. */
  readonly tag: string;
  /** `routes.max_cost_cents_per_run`, or `null` when the route sets none. */
  readonly maxCostCentsPerRun: number | null;
}

/** A reservation, as the repository reads it. */
export interface ReservationRow {
  readonly id: string;
  readonly number: number;
  readonly status: string;
  readonly runnerName: string | null;
}

/** Everything {@link resourcesOf} computes from. */
export interface ResourcesInput {
  /** The run's ledger, summed. */
  readonly spend: SpendTotals;
  /** The stage whose budget applies — {@link budgetStageOf} — or `undefined`. */
  readonly budgetStage: RunStage | undefined;
  /** The route the budget stage inherits, or `undefined` when it pins a model or has none. */
  readonly route: RouteCap | undefined;
  /** The build job the run holds, or `undefined`. */
  readonly reservation: ReservationRow | undefined;
  /** `runs.started_at`. */
  readonly startedAt: Date;
  /** `runs.finished_at`. */
  readonly finishedAt: Date | null;
  /** The snapshot's instant. */
  readonly asOf: Date;
}

/**
 * *Resources*, per decision **R8** — every number from the system that owns it.
 *
 * @param input - The sums and the policies they are measured against.
 * @returns The card. The cost is passed through as the ledger summed it, so an unpriced ledger
 *   stays `null` — it is never coalesced to zero here.
 */
export function resourcesOf(input: ResourcesInput): RunResources {
  const { spend, budgetStage, route, reservation } = input;

  const resources: RunResources = {
    tokens: {
      used: spend.tokensIn + spend.tokensOut,
      tokensIn: spend.tokensIn,
      tokensOut: spend.tokensOut,
      budget: budgetStage?.token_budget ?? null,
      budgetStageKey: budgetStage?.stage_key ?? null,
    },
    cost: {
      costCents: spend.costCents,
      unpricedEvents: spend.unpricedEvents,
      capCents: route?.maxCostCentsPerRun ?? null,
      routeTag: route?.tag ?? null,
    },
    wallClock: {
      startedAt: input.startedAt.toISOString(),
      finishedAt: input.finishedAt?.toISOString() ?? null,
      elapsedSeconds: secondsBetween(input.startedAt, input.finishedAt ?? input.asOf) ?? 0,
    },
  };

  if (reservation === undefined) {
    return resources;
  }

  return {
    ...resources,
    farm: {
      buildJobId: reservation.id,
      jobNumber: reservation.number,
      jobStatus: reservation.status,
      runnerName: reservation.runnerName,
    },
  };
}

/**
 * The header pill.
 *
 * @param verdicts - The latest verdict per check.
 * @returns See {@link RunGuardrails.status}.
 */
export function guardrailsStatusOf(verdicts: readonly GuardrailVerdict[]): RunGuardrailsStatus {
  if (verdicts.length === 0) {
    return "unevaluated";
  }

  if (verdicts.includes("fail")) {
    return "violations";
  }

  return verdicts.includes("pending") ? "pending" : "clean";
}

/**
 * *Guardrails*, from `v_run_guardrails_latest`.
 *
 * @param rows - The latest verdict per check, in any order.
 * @param workflowTag - `runs.workflow_tag`, the footer's slug.
 * @param workflowVersionPin - `runs.workflow_version_pin`, the footer's fallback version.
 * @param tenant - The workspace's slug.
 * @returns The card, rows in the order the card draws them ({@link GUARDRAIL_CHECKS}).
 */
export function guardrailsOf(
  rows: readonly RunGuardrailsLatest[],
  workflowTag: string,
  workflowVersionPin: number | null,
  tenant: string,
): RunGuardrails {
  const ordered = [...rows].sort(
    (a, b) => GUARDRAIL_CHECKS.indexOf(a.check) - GUARDRAIL_CHECKS.indexOf(b.check),
  );

  // The footer names the policy the verdicts *applied* — the newest verdict's `policy_ref` —
  // and only falls back to the run's pin before anything has been evaluated.
  const newest = [...rows].sort((a, b) => b.evaluated_at.getTime() - a.evaluated_at.getTime())[0];

  return {
    status: guardrailsStatusOf(ordered.map((row) => row.verdict)),
    checks: ordered.map((row) => {
      const check: RunGuardrailCheck = {
        check: row.check,
        verdict: row.verdict,
        rulesetVersion: row.ruleset_version,
        evaluatedAt: row.evaluated_at.toISOString(),
        changeSetSeq: row.change_set_seq,
      };

      return row.evidence === null ? check : { ...check, evidence: row.evidence };
    }),
    policy: {
      workflowTag,
      workflowVersion: newest?.policy_ref ?? workflowVersionPin,
      tenant,
    },
    secrets: { ...SECRETS_RULESET_DISCLOSURE },
  };
}

/**
 * One transcript row as the console reads it.
 *
 * @param row - A `run_events` row.
 * @returns The entry, with every null field absent — the JSONL projection's rule.
 */
export function entryOf(row: RunEvent): RunEventEntry {
  const entry: Record<string, unknown> = {
    seq: row.seq,
    ts: row.ts.toISOString(),
    actor: row.actor,
  };

  if (row.stage_key !== null) entry.stageKey = row.stage_key;
  if (row.attempt !== null) entry.attempt = row.attempt;
  if (row.tool_tag !== null) entry.toolTag = row.tool_tag;
  if (row.model_id !== null) entry.modelId = row.model_id;
  if (row.body !== null) entry.body = row.body;
  if (row.payload !== null && row.payload !== undefined) entry.payload = row.payload;

  entry.simulated = row.simulated;

  if (
    row.elided_events !== null &&
    row.elided_bytes !== null &&
    row.elided_from !== null &&
    row.elided_to !== null
  ) {
    entry.elision = {
      events: row.elided_events,
      bytes: Number(row.elided_bytes),
      from: row.elided_from.toISOString(),
      to: row.elided_to.toISOString(),
    } satisfies RunEventElision;
  }

  return entry as unknown as RunEventEntry;
}
