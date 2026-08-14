/**
 * Rows → the one payload that paints mockup 02, and the definitions of every number in it.
 *
 * The same seam `tenancy/resources.ts` keeps, at the size the dashboard needs: the rows are
 * the database's — snake_case, `Date`s, `numeric` as text — and the resource is the
 * contract's, camelCase and JSON-safe. What is unusual here is how much of the file is
 * *prose*, and that is the point of the ticket: six of these fields are aggregates whose
 * definition is a choice, and a number whose definition is not written down is a number a
 * screen will eventually render under the wrong label.
 *
 * ## Two rules the whole payload keeps
 *
 *   * **Aggregates are computed here; per-row durations are not.** *Avg. cycle time* is a
 *     mean over twenty-nine rows and no client can compute it from what it was sent, so it
 *     is a field. A single run's *Elapsed* and *Cycle* are `now − startedAt` and
 *     `finishedAt − startedAt`, which a client can compute from two timestamps it already
 *     has — and *must*, because elapsed is a number that moves while nobody is asking. So
 *     the rows carry instants and the payload carries no per-row duration.
 *   * **Absence is a zero or an empty list, never a null.** An organization with nothing in
 *     it answers `{total: 0, byStatus: {coding: 0, …}}` and `[]`, not `null` and not an
 *     absent key. A card is then rendered from the payload without a fallback branch, and
 *     the empty state is a design decision (#86) rather than a crash. The exceptions are
 *     inside a *row*, where a null is a fact about that row — a run in flight has no
 *     `finishedAt`, a queue item may carry no estimate — and each is documented where it is
 *     declared.
 */

import type { ActiveRunStatus, QueueEffort, QueueItem, Run, RunStatus } from "../db/schema";
import { ACTIVE_RUN_STATUSES } from "../db/schema";

/**
 * One run of the loop, as every card that draws a run draws it.
 *
 * **One shape for both lists**, which is decision F2 read forwards: *Active loops* and
 * *Recently closed* are two queries over one table, so two resource shapes would be this
 * module claiming a distinction the schema deliberately does not make. The columns a
 * terminal run has and a live one does not — `finishedAt`, `prNumber`, the check counts —
 * are nullable here for exactly the reason they are nullable in V008.
 *
 * [#71](https://github.com/NobuData/ouroboros/issues/71) publishes the paged runs
 * endpoints and takes this shape with it: the aggregate's `activeRuns` is a page of that
 * listing, so the two agreeing is a contract rather than a coincidence.
 */
export interface RunSummary {
  /** The run's id — what `GET /api/v1/runs/{id}` will address, and what the card links to. */
  readonly id: string;
  readonly issueNumber: number;
  /** The title as it was when the run started. A closed run reads as the work it did. */
  readonly issueTitle: string;
  /** Workflow label, opaque. Renders as the card's tag; nothing here interprets it. */
  readonly workflowTag: string;
  /** Model identifier as recorded, opaque — `claude-fable-5`, `ollama/qwen3-coder`. */
  readonly model: string;
  readonly status: RunStatus;
  /** The workflow's word for the current step, captioning the stage meter. */
  readonly stageLabel: string;
  /** Where the run is in its workflow, out of {@link RunSummary.stageTotal}. */
  readonly stageIndex: number;
  /** How many steps the workflow has. At least 1, so a meter never divides by zero. */
  readonly stageTotal: number;
  /** When the loop started on this issue. *Elapsed* is `now −` this, computed by the client. */
  readonly startedAt: string;
  /** When it reached a terminal status, or `null` exactly while it has not. */
  readonly finishedAt: string | null;
  /** The pull request, or `null` — a run may fail, or stop for a human, before it opens one. */
  readonly prNumber: number | null;
  /** Checks that passed, or `null` when the run has none to report. Paired with the total. */
  readonly checksPassed: number | null;
  /** Total checks. `0/0` is a repository with no checks, which is not "not known yet". */
  readonly checksTotal: number | null;
}

/** One queued issue, as the *Up next in queue* card draws it. */
export interface QueueItemSummary {
  readonly id: string;
  readonly issueNumber: number;
  readonly issueTitle: string;
  /** The size chip — one of the five, lower-case, which is the class the UI stamps. */
  readonly effort: QueueEffort;
  readonly workflowTag: string;
  /** Place in the queue; `1` is next. Dense by the writer's convention, not by constraint. */
  readonly position: number;
  /**
   * Expected minutes of autonomous work, or `null` for **not estimated**.
   *
   * Not zero, and the distinction is load-bearing: the *Queued issues* stat sums the
   * estimates and skips the nulls, so a card rendering a null as `0m` would be inventing a
   * claim about how long the work takes.
   */
  readonly estMinutes: number | null;
  readonly enqueuedAt: string;
}

/** *Loops live* — how many runs are in flight, and in which stage. */
export interface LoopsLiveStat {
  /** The card's big number. The sum of {@link LoopsLiveStat.byStatus}. */
  readonly total: number;
  /**
   * The same runs split by status, for the subline.
   *
   * **Every active status is a key, zeros included** — a subline reading "2 coding · 1 in
   * review" is composed from this, and a client should not have to know which statuses exist
   * to render one. The three keys are the lifecycle's, in order.
   */
  readonly byStatus: Readonly<Record<ActiveRunStatus, number>>;
}

/** *Queued issues* — how many, and how long they are expected to take. */
export interface QueuedStat {
  readonly count: number;
  /**
   * The sum of the queue's estimates, in minutes — the card's `est. 9h 40m`.
   *
   * A **sum, not a count**, and it skips items with no estimate rather than counting them as
   * zero. So `count` may exceed the number of items this total speaks for; that is the
   * honest shape of a queue where something has not been sized yet.
   */
  readonly estMinutes: number;
}

/** *PRs merged · 7d* — the count, and how it compares with the week before. */
export interface MergedSevenDaysStat {
  /** Runs that reached `merged` in the trailing seven days. */
  readonly count: number;
  /**
   * This week's count less the previous seven days' — the card's `▲ 8 vs last week`.
   *
   * Signed: negative is a week that merged less than the one before, and the card renders
   * the direction from the sign rather than from a separate flag.
   */
  readonly deltaVsPrior: number;
}

/** *Token spend · today* — the day's ledger, rolled up. */
export interface TokensTodayStat {
  /** Input plus output tokens across every provider — the card's `4.2M`. */
  readonly tokens: number;
  /**
   * What the day's **priced** events cost, in cents.
   *
   * Cents rather than a decimal currency amount, so nothing rounds on the way through JSON.
   * It is a **lower bound** whenever {@link TokensTodayStat.unpricedEvents} is non-zero.
   */
  readonly costCents: number;
  /** How many distinct providers were paid — the `across 4 providers` in the subline. */
  readonly providers: number;
  /**
   * How many of the day's events have no recorded cost.
   *
   * This is the `≈` on the card. V010 makes `cost_cents` nullable so that "nobody has priced
   * this" has a value that is not zero — local inference on a workstation is the honest case
   * of it — and a total that silently omitted those events would read as exact. Non-zero
   * means the cost above is a floor; equal to the day's event count means it is unknown
   * rather than zero, which is the *cost unavailable* the card renders.
   */
  readonly unpricedEvents: number;
}

/** The four numbers of the stat row. */
export interface DashboardStats {
  readonly loopsLive: LoopsLiveStat;
  readonly queued: QueuedStat;
  readonly merged7d: MergedSevenDaysStat;
  readonly tokensToday: TokensTodayStat;
}

/**
 * *Loop pulse* — three windowed meters and the one switch the dashboard can write.
 *
 * The definitions are the substance of this interface and each is stated on its field. The
 * one that is not obvious from its name is the merge rate's window: see
 * {@link LoopPulse.mergeRate}.
 */
export interface LoopPulse {
  /**
   * The **autonomous merge rate**: merged runs ÷ every run that reached a terminal status,
   * over **fourteen days**, as a fraction between 0 and 1.
   *
   * Every terminal status is in the denominator — `merged`, `needs_human` and `failed`. The
   * meter's question is *how often does the loop finish the job without us*, and a run that
   * stopped for a human is the clearest possible no; excluding it would make the rate say
   * "of the runs that went well, how many went well".
   *
   * **Why fourteen days when the other two meters are seven.** Mockup 02 draws `92%` beside
   * `27 merged · 7d` and `2 interventions this week`, and those three cannot all be true of
   * one seven-day window: 27 merged with 2 interventions is 27/29 = 93.1%, and there is no
   * integer count of closed runs for which 27 merged is 92% — 92% needs a denominator of
   * 29.35. #68's seed says so in its header and leaves the choice here. It is resolved in
   * favour of the *rate*: over the fourteen days the seed spans, 46 of 50 closed runs merged,
   * which is 92% with no rounding at all. A longer window is also the better measurement on
   * its own terms — a rate over a denominator of twenty-nine moves four points when one run
   * fails — and it reaches over exactly the rows the merged delta already compares across.
   *
   * `0` when nothing closed in the window. That is a floor rather than a measurement, and it
   * is why an empty organization's meter is drawn as *no data* rather than as a bad week:
   * `pulse.mergeRate === 0` with `merged7d.count === 0` and `interventions7d === 0` is an
   * organization with no history, not one that merged nothing.
   */
  readonly mergeRate: number;
  /**
   * **Average cycle time**: the mean of `finishedAt − startedAt` over every run that reached
   * a terminal status in the trailing **seven** days, in seconds.
   *
   * Every terminal run, not only the merged ones — a run that stopped for a human took the
   * time it took, and a mean that dropped it would report the loop as faster than it is. The
   * two definitions are distinguishable against #68's seed and the choice is not free: over
   * those rows this one is 14m 20s, which is the mockup's number, and merged-only is 13m 19s.
   *
   * `0` when nothing closed in the window — the same floor, and the same reading, as
   * {@link LoopPulse.mergeRate}.
   */
  readonly avgCycleSeconds: number;
  /**
   * **Human interventions**: runs that reached `needs_human` in the trailing seven days.
   *
   * A count of runs, not of interruptions: a run that was handed back twice is one row and
   * counts once, because the row is what the loop stopped on.
   */
  readonly interventions7d: number;
  /**
   * Whether this workspace merges on green checks without asking — V011's
   * `auto_merge_on_checks`, read through `workspace_settings_effective`.
   *
   * `false` for a workspace that has never answered, resolved by the view rather than by a
   * default written here, so "answered no" and "never asked" read the same to the switch and
   * differently to anything that needs to know (#74, #86).
   */
  readonly autoMerge: boolean;
}

/**
 * The page head's subline — decision F7.
 *
 * The greeting beside it is the client's: it is composed from the session user's name and
 * the reader's own clock, and a server that rendered it would be rendering somebody's
 * afternoon in the wrong hemisphere. These three are the half of that sentence that is data.
 */
export interface DashboardActivity {
  /** Runs in flight — the same number as `stats.loopsLive.total`, under the name the sentence uses. */
  readonly inFlight: number;
  /** Issues waiting — the same number as `stats.queued.count`. */
  readonly queued: number;
  /**
   * Runs merged since midnight — *"merged 6 pull requests since this morning"*.
   *
   * The only number on the page measured from a **calendar** boundary rather than a rolling
   * window, and therefore the only one that needs a timezone. It is UTC; `windows.ts` is
   * where that is decided and the OpenAPI description is where it is published, because a
   * reader in another zone is entitled to know whose morning is meant.
   */
  readonly mergedSinceMorning: number;
}

/** What `GET /api/v1/dashboard` answers with — the whole page, in one round trip. */
export interface DashboardResource {
  readonly stats: DashboardStats;
  readonly pulse: LoopPulse;
  /** Runs in flight, in lifecycle order, longest-running first within a stage. At most ten. */
  readonly activeRuns: readonly RunSummary[];
  /** Runs that have stopped, newest first. At most eight — the card draws four. */
  readonly recentRuns: readonly RunSummary[];
  /** The head of the queue in queue order. At most five, which is what the card draws. */
  readonly queueHead: readonly QueueItemSummary[];
  readonly activity: DashboardActivity;
}

/**
 * Render a timestamp for the wire.
 *
 * @param instant - The instant, as `pg` parsed it.
 * @returns ISO-8601 with a `Z` offset — `2026-08-11T10:20:23.000Z`.
 */
function at(instant: Date): string {
  return instant.toISOString();
}

/**
 * Render a timestamp that may not have happened.
 *
 * @param instant - The instant, or `null`.
 * @returns ISO-8601, or `null` — preserved rather than defaulted, because a run that has not
 *   finished and a run that finished at the epoch are different runs.
 */
function atOrNull(instant: Date | null): string | null {
  return instant === null ? null : at(instant);
}

/**
 * One run, as a card draws it.
 *
 * @param row - The row, from either list — the mapping does not branch on status, which is
 *   what makes the two lists one shape.
 * @returns The resource.
 */
export function runSummary(row: Run): RunSummary {
  return {
    id: row.id,
    issueNumber: row.issue_number,
    issueTitle: row.issue_title,
    workflowTag: row.workflow_tag,
    model: row.model,
    status: row.status,
    stageLabel: row.stage_label,
    stageIndex: row.stage_index,
    stageTotal: row.stage_total,
    startedAt: at(row.started_at),
    finishedAt: atOrNull(row.finished_at),
    prNumber: row.pr_number,
    checksPassed: row.checks_passed,
    checksTotal: row.checks_total,
  };
}

/**
 * One queued issue, as the card draws it.
 *
 * @param row - The row.
 * @returns The resource. `estMinutes` is passed through rather than coalesced — see
 *   {@link QueueItemSummary.estMinutes}.
 */
export function queueItemSummary(row: QueueItem): QueueItemSummary {
  return {
    id: row.id,
    issueNumber: row.issue_number,
    issueTitle: row.issue_title,
    effort: row.effort,
    workflowTag: row.workflow_tag,
    position: row.position,
    estMinutes: row.est_minutes,
    enqueuedAt: at(row.enqueued_at),
  };
}

/**
 * The live-loops split, with every active status present.
 *
 * Built from {@link ACTIVE_RUN_STATUSES} rather than from the rows, which is the whole
 * difference between this and a `group by` handed to the client: a status nothing is
 * currently in is `0` here, and absent there.
 *
 * @param counts - How many runs hold each active status. Every status is required rather
 *   than optional, which is what makes widening the lifecycle a compile error here and in
 *   the repository rather than a status that quietly reports zero.
 * @returns The stat, with `total` summed from the parts rather than counted separately —
 *   two counts of one thing are two things that can disagree.
 */
export function loopsLive(counts: Readonly<Record<ActiveRunStatus, number>>): LoopsLiveStat {
  // Rebuilt through the list rather than passed through, so the keys are in lifecycle order
  // whatever order the caller's object literal happened to be written in.
  const byStatus = Object.fromEntries(
    ACTIVE_RUN_STATUSES.map((status) => [status, counts[status]]),
  ) as Record<ActiveRunStatus, number>;

  return {
    total: ACTIVE_RUN_STATUSES.reduce((sum, status) => sum + byStatus[status], 0),
    byStatus,
  };
}

/**
 * A rate, guarded against the window that holds nothing.
 *
 * @param numerator - Runs that merged.
 * @param denominator - Runs that closed at all.
 * @returns The fraction, or `0` when nothing closed — never `NaN`, which is not
 *   representable in JSON and would reach a card as `null`. See {@link LoopPulse.mergeRate}
 *   for how a caller is meant to read the zero.
 */
export function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}
