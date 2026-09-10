/**
 * What *"synced 40s ago"* is made of, and the rule that turns three sources into one answer.
 *
 * M.4 ([#113](https://github.com/NobuData/ouroboros/issues/113)). The freshness tag in mockup
 * 03's backlog card head needs a number, and the sentence beside it — *"sync is paused"* — has
 * to say **which** kind of paused, because each kind is fixed somewhere else: a token in
 * settings, a repository toggled on, or nothing at all but time.
 *
 * ---------------------------------------------------------------------------
 * ## Three sources, and none of them is a status column
 *
 * The first acceptance criterion is *"pause reasons are derived from actual state … never
 * guessed"*, and that is a statement about where each field comes from:
 *
 * | The answer                | Comes from                                   | Survives a restart |
 * |---------------------------|----------------------------------------------|--------------------|
 * | `syncedAt`, `cursor`      | `github_repos` — what a poll wrote           | yes                |
 * | `not_configured`          | is there a row in `github_credentials`       | yes                |
 * | `no_repositories`         | how many repositories are enabled            | yes                |
 * | `rate_limited`            | `GithubRateLimiter` — GitHub's own headers   | no                 |
 * | `unauthorized`, `not_found`, `upstream_error` | the last cycle's report      | no                 |
 * | `lastResult`              | the last cycle's report                      | no                 |
 *
 * **Nothing is written to answer this question.** There is no `sync_state` column, and adding
 * one would mean a row that says *paused (rate-limited)* long after the window has turned
 * over — a status stored is a status that goes stale, and the state it describes is the sort
 * that changes without anybody writing anything.
 *
 * **So a pause reason does not outlive a restart, and that is the answer to the question K.4
 * left open.** A fresh process has attempted nothing, so it *knows* nothing about
 * `unauthorized` or `upstream_error` — and the two reasons that matter most, no token and no
 * enabled repository, are read from tables and are therefore right immediately. Claiming the
 * others from a stored value would be reporting a failure this process never saw, which is
 * the same as guessing.
 *
 * ## Freshness is the **oldest** poll, not the newest
 *
 * {@link SyncStatusResource.syncedAt} is the *oldest* stamp among the workspace's enabled
 * repositories, and `null` while any of them has never been polled. The tag sits over the
 * whole backlog — *"BACKLOG · AS OUROBOROS SEES IT"* — so what it may honestly claim is the
 * freshness of the **stalest** thing in it. Taking the newest would let one repository that
 * synced a second ago speak for nine that failed an hour ago, which is the same lie K.4's
 * one-transaction-per-poll rule exists to prevent, one level up. A repository that is stale
 * because it is paused says so in its own row.
 */

import type { SyncTarget } from "../backlog-sync/backlog-sync.repository";
import {
  SYNC_NO_REPOSITORIES,
  SYNC_PAUSE_MESSAGES,
  type RepoSyncOutcome,
  type SyncCycleReport,
  type SyncPause,
} from "../backlog-sync/sync.report";
import { GITHUB_FAILURES } from "../github/github.errors";

/**
 * Whether the loop is running for this workspace, or stopped.
 *
 * Two words rather than one per reason. The reason is {@link SyncStatusResource.pause}, and
 * splitting them is what lets a client render *"paused"* without knowing every reason this
 * service can give — a set that grew by one in K.4 and will grow again when a second ticket
 * source lands (Q.3, [#140](https://github.com/NobuData/ouroboros/issues/140)).
 */
export type SyncState = "ok" | "paused";

/** The two values {@link SyncState} can hold, for a test that wants to iterate them. */
export const SYNC_STATES = ["ok", "paused"] as const satisfies readonly SyncState[];

/**
 * What the last cycle's poll of one repository did.
 *
 * In memory, so `null` for every repository until a cycle has run in this process. That is
 * honest rather than unfortunate: these are counts *of a poll*, and a process that has not
 * polled has none. What the polls before the restart left behind is in `syncedAt` and
 * `cursor`, which are columns.
 */
export interface RepositorySyncResult {
  /** Issues this mirror had never seen. */
  readonly imported: number;
  /** Rows rewritten because something GitHub owns had changed. */
  readonly updated: number;
  /** Rows GitHub returned identical to what was stored, and were therefore not written. */
  readonly unchanged: number;
  /** Issues handed to the estimation pipeline — new ones, and ones that reopened. */
  readonly enqueued: number;
  /** Pull requests dropped before a row was built. */
  readonly pullRequests: number;
  /** Payloads that could not be turned into a row. Normally zero, and worth seeing when not. */
  readonly unusable: number;
  /**
   * Whether the poll stopped at its cap with more to read.
   *
   * Not a truncation — the next cycle continues from the watermark a second later — but a
   * client showing *"synced"* over a cold import of a large repository should be able to tell
   * that more is still arriving.
   */
  readonly capped: boolean;
}

/** One enabled repository, and what is known about its sync. */
export interface RepositorySyncStatus {
  /** `github_repos.id`. What a per-repository control would address. */
  readonly githubRepoId: string;
  /** `owner/name`, as GitHub spells it. */
  readonly repository: string;
  /**
   * When this repository was last polled successfully, or `null` if it never has been.
   *
   * A column, so it survives a restart and describes the last poll that *happened* rather
   * than the last one this process attempted. A failed poll writes nothing, so this goes on
   * saying when the last good one was.
   */
  readonly syncedAt: string | null;
  /**
   * The `since` watermark the next poll will send, or `null` on a repository never polled.
   *
   * GitHub's own timeline rather than this host's clock, which is why it is worth publishing:
   * it is the one value that says *how far this mirror has actually got*, independently of
   * when the attempt was made.
   */
  readonly cursor: string | null;
  /** `ok`, or `paused` with a reason below. */
  readonly state: SyncState;
  /** Why this repository is not being polled, or `null`. */
  readonly pause: SyncPause | null;
  /** One sentence for whoever is reading, or `null` when nothing is wrong. */
  readonly message: string | null;
  /** What the last cycle's poll did, or `null` when this process has polled it none. */
  readonly lastResult: RepositorySyncResult | null;
}

/** The sync, as a workspace's intake screen needs to render it. */
export interface SyncStatusResource {
  /**
   * The freshness tag's instant — the **oldest** successful poll among the enabled
   * repositories — or `null` when any of them has never been polled.
   *
   * See this file's header for why the oldest rather than the newest. This is also the field
   * M.1 ([#110](https://github.com/NobuData/ouroboros/issues/110)) folds into its `meta`, so
   * the tag drawn beside a listing and the tag drawn from this endpoint are one number.
   */
  readonly syncedAt: string | null;
  /** `ok`, or `paused` with a reason below. */
  readonly state: SyncState;
  /** Why the workspace's sync is not running, or `null`. */
  readonly pause: SyncPause | null;
  /** One sentence for whoever is reading, or `null` when nothing is wrong. */
  readonly message: string | null;
  /**
   * Seconds until GitHub will answer this workspace's token again, or `null`.
   *
   * Only ever set beside {@link SyncPause} `rate_limited`, and read from the same guard the
   * client enforces rather than a second opinion about it. Absent rather than zero when the
   * wait is not known, for `github.errors.ts`' reason: a made-up countdown is worse than
   * none.
   */
  readonly retryAfterSeconds: number | null;
  /**
   * Whether a cycle is running right now.
   *
   * What makes a manual re-sync's `409 backlog_sync_running` predictable rather than a
   * surprise: a client can render the trigger as busy instead of offering a click that is
   * going to be refused.
   */
  readonly running: boolean;
  /** Every enabled repository, `owner/name` ascending. Empty is the `no_repositories` pause. */
  readonly repositories: readonly RepositorySyncStatus[];
}

/** Everything one status answer is derived from. */
export interface SyncStatusInput {
  /** The workspace. */
  readonly organizationId: string;
  /** Its enabled repositories, with the columns the last poll of each wrote. */
  readonly targets: readonly SyncTarget[];
  /** Whether a GitHub token is stored for it. */
  readonly configured: boolean;
  /** What the rate guard says, in seconds, or `undefined` when the token may call GitHub. */
  readonly retryAfterSeconds?: number;
  /** The last cycle this process completed, or `undefined` when it has completed none. */
  readonly last?: SyncCycleReport;
  /** Whether a cycle is in flight. */
  readonly running: boolean;
}

/**
 * Compose one workspace's sync status.
 *
 * Pure, and separate from the service that fetches its inputs, because every rule worth
 * testing here is a rule about *precedence* — which of several true things a reader is told
 * first — and a rule like that is worth testing without a database.
 *
 * @param input - The three sources: columns, credentials and rate guard, and this process's
 *   last cycle.
 * @returns The resource, JSON-safe.
 */
export function syncStatus(input: SyncStatusInput): SyncStatusResource {
  const pause = workspacePause(input);
  const outcomes = repoOutcomes(input);

  return {
    syncedAt: oldestSync(input.targets),
    state: stateFor(pause),
    pause: pause ?? null,
    message: pause === undefined ? null : SYNC_PAUSE_MESSAGES[pause],
    // Published only beside the pause it explains: a countdown rendered next to a working
    // sync would be a number with nothing to mean.
    retryAfterSeconds:
      pause === GITHUB_FAILURES.rateLimited ? (input.retryAfterSeconds ?? null) : null,
    running: input.running,
    repositories: input.targets.map((target) =>
      repositoryStatus(target, outcomes.get(target.githubRepoId), pause),
    ),
  };
}

/**
 * Why this workspace's sync is not running, if it is not.
 *
 * The precedence is the design, and it runs from *what a person can fix* to *what they can
 * only wait out*:
 *
 *   1. **No token.** Nothing else can be true in a useful way — every other reason describes
 *      a call this workspace is not making.
 *   2. **No enabled repository.** A token pointed at nothing.
 *   3. **Rate-limited**, from the guard's own evidence rather than from a report. It outranks
 *      what the last cycle said because the budget can be spent by an *interactive* call the
 *      last cycle knows nothing about, and because it is the one pause that says when it ends.
 *   4. **Whatever stopped the last cycle** for this workspace — `unauthorized`,
 *      `upstream_error`, or a `rate_limited` the guard has since forgotten.
 *
 * @param input - The sources.
 * @returns The reason, or `undefined` when nothing is stopping the loop.
 */
function workspacePause(input: SyncStatusInput): SyncPause | undefined {
  if (!input.configured) {
    return GITHUB_FAILURES.notConfigured;
  }

  if (input.targets.length === 0) {
    return SYNC_NO_REPOSITORIES;
  }

  if (input.retryAfterSeconds !== undefined) {
    return GITHUB_FAILURES.rateLimited;
  }

  return input.last?.organizations.find(
    (organization) => organization.organizationId === input.organizationId,
  )?.pause;
}

/**
 * The last cycle's per-repository outcomes for this workspace, by `github_repos.id`.
 *
 * @param input - The sources.
 * @returns The map. Empty when no cycle has run, or when the workspace was paused as a whole
 *   and so polled nothing.
 */
function repoOutcomes(input: SyncStatusInput): Map<string, RepoSyncOutcome> {
  const organization = input.last?.organizations.find(
    (candidate) => candidate.organizationId === input.organizationId,
  );

  return new Map(
    (organization?.repositories ?? []).map((repository) => [repository.githubRepoId, repository]),
  );
}

/**
 * One repository's row.
 *
 * @param target - The columns: `owner/name`, the freshness stamp and the watermark.
 * @param outcome - What the last cycle's poll of it did, when there was one.
 * @param workspacePause - Why the whole workspace is paused, when it is. Inherited only where
 *   the repository has no reason of its own: a workspace with no token has repositories that
 *   were not polled *for that reason*, and reporting them as `ok` would put a green row under
 *   a red card.
 * @returns The row.
 */
function repositoryStatus(
  target: SyncTarget,
  outcome: RepoSyncOutcome | undefined,
  workspacePause: SyncPause | undefined,
): RepositorySyncStatus {
  const pause = outcome?.pause ?? workspacePause;

  return {
    githubRepoId: target.githubRepoId,
    repository: `${target.owner}/${target.name}`,
    syncedAt: instant(target.syncedAt),
    cursor: target.cursor,
    state: stateFor(pause),
    pause: pause ?? null,
    message: pause === undefined ? null : SYNC_PAUSE_MESSAGES[pause],
    // A paused poll did nothing, and its outcome carries zeros to say so. Publishing those as
    // a *result* would read as "we looked and found nothing", which is the one thing that did
    // not happen.
    lastResult: outcome === undefined || outcome.pause !== undefined ? null : result(outcome),
  };
}

/**
 * The counts, without the bookkeeping the report carries for the scheduler.
 *
 * @param outcome - One polled repository's outcome.
 * @returns Its result.
 */
function result(outcome: RepoSyncOutcome): RepositorySyncResult {
  return {
    imported: outcome.imported,
    updated: outcome.updated,
    unchanged: outcome.unchanged,
    enqueued: outcome.enqueued,
    pullRequests: outcome.pullRequests,
    unusable: outcome.unusable,
    capped: outcome.capped,
  };
}

/**
 * The word for having a reason, or not.
 *
 * @param pause - The reason, or `undefined`.
 * @returns `paused` or `ok`.
 */
function stateFor(pause: SyncPause | undefined): SyncState {
  return pause === undefined ? "ok" : "paused";
}

/**
 * The freshness the whole backlog may honestly claim.
 *
 * @param targets - The enabled repositories.
 * @returns The oldest stamp as an ISO instant, or `null` when there are none or when any of
 *   them has never been polled. See this file's header.
 */
function oldestSync(targets: readonly SyncTarget[]): string | null {
  if (targets.length === 0) {
    return null;
  }

  let oldest: Date | undefined;

  for (const target of targets) {
    if (target.syncedAt === null) {
      return null;
    }

    if (oldest === undefined || target.syncedAt.getTime() < oldest.getTime()) {
      oldest = target.syncedAt;
    }
  }

  return instant(oldest ?? null);
}

/**
 * A timestamp as the contract spells one.
 *
 * @param value - The column, or `null`.
 * @returns The ISO-8601 instant, or `null`.
 */
function instant(value: Date | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toISOString();
}
