/**
 * What a poll did, and — when it did nothing — the word for why.
 *
 * K.4 ([#102](https://github.com/NobuData/ouroboros/issues/102)). The issue's last acceptance
 * criterion is the subject of this file: *"with no token or no enabled repos, sync reports a
 * reason instead of failing silently"*. A background loop has nobody waiting on it, so the
 * only thing that separates *paused* from *broken* is that the paused state has a name — and
 * the names have to be a closed set, because M.4
 * ([#113](https://github.com/NobuData/ouroboros/issues/113)) renders them and N.6
 * ([#120](https://github.com/NobuData/ouroboros/issues/120)) writes a sentence for each.
 *
 * **Five of the six names are K.3's.** `github/github.errors.ts` already named every way a
 * call to GitHub can fail and mapped each onto the #31 envelope, precisely so that this
 * ticket would have a vocabulary to *store* rather than one to invent. This file adds exactly
 * one word to it, and the reason it needs one is that {@link SYNC_NO_REPOSITORIES} is not a
 * failure of any call: nothing was asked of GitHub, because the workspace has not chosen a
 * repository to watch yet.
 *
 * **Nothing here is a status column.** These values live in a report a cycle returns and in
 * this service's memory; the durable half is `github_repos.issues_synced_at` and
 * `issues_sync_cursor`, which are facts about what a poll *did* rather than about why one did
 * not run. Whether a pause reason should outlive a restart is M.4's question, and it will
 * have this vocabulary either way.
 */

import { GITHUB_FAILURES, GITHUB_MESSAGES, type GithubFailure } from "../github/github.errors";

/**
 * The workspace has a token and no repository to point it at.
 *
 * Not a failure and not an error — a step somebody has not taken. It is the one reason here
 * that is *not* about GitHub, which is why it could not have been one of
 * {@link GITHUB_FAILURES}: no request was made, so no request failed.
 *
 * Distinct from {@link GITHUB_FAILURES.notConfigured} on purpose, because the two are fixed in
 * different places: one is a token in settings, the other is a repository toggled on. A single
 * *"sync is off"* would send half the readers to the wrong screen.
 */
export const SYNC_NO_REPOSITORIES = "no_repositories";

/** Why a workspace's sync is not running. K.3's five reasons, plus the one above. */
export type SyncPause = GithubFailure | typeof SYNC_NO_REPOSITORIES;

/** Every value {@link SyncPause} can hold, for a test that wants to iterate them. */
export const SYNC_PAUSES = [
  ...Object.values(GITHUB_FAILURES),
  SYNC_NO_REPOSITORIES,
] as const satisfies readonly SyncPause[];

/**
 * What a person reads for each pause.
 *
 * K.3's sentences, extended by one. Constants rather than strings built at a call site, so
 * the reason a card renders and the reason a log line carries are the same words.
 */
export const SYNC_PAUSE_MESSAGES: Record<SyncPause, string> = {
  ...GITHUB_MESSAGES,
  [SYNC_NO_REPOSITORIES]:
    "No repository is enabled for this workspace. Turn one on to let Ouroboros watch its backlog.",
};

/** What one poll of one repository did. */
export interface RepoSyncOutcome {
  /** The workspace the repository belongs to. */
  readonly organizationId: string;
  /** `github_repos.id` — what M.4's per-repo status is keyed by. */
  readonly githubRepoId: string;
  /** `owner/name`, for a log line a person reads. */
  readonly repository: string;
  /**
   * Why this repository was not polled, or `undefined` when it was.
   *
   * Per-repository rather than per-workspace for the reasons that are per-repository: a
   * `not_found` is one repository the token cannot see and says nothing about the others.
   */
  readonly pause?: SyncPause;
  /** Rows inserted — issues this mirror had never seen. */
  readonly imported: number;
  /** Rows rewritten because something GitHub owns had changed. */
  readonly updated: number;
  /**
   * Rows GitHub returned that were identical to what was stored, and were therefore **not
   * written**.
   *
   * The acceptance criterion's *"touches no rows"*, counted. A `since` poll re-reads the
   * issue sitting exactly on the watermark, because GitHub's `since` is inclusive; writing it
   * would move `updated_at` on a row nothing had changed and make that column stop meaning
   * what `github_issues` says it means.
   */
  readonly unchanged: number;
  /** Pull requests dropped before a row was built — GitHub's issues endpoint returns both. */
  readonly pullRequests: number;
  /**
   * Payloads that could not be turned into a row, each already logged with its reason.
   *
   * Counted rather than fatal: one issue whose payload this service cannot represent must not
   * cost a repository its whole poll, and a count that is normally zero is a number worth
   * seeing when it is not.
   */
  readonly unusable: number;
  /** Issues handed to the estimation pipeline — new ones, and ones that reopened. */
  readonly enqueued: number;
  /**
   * Whether the poll stopped at {@link "./cadence".MAX_ISSUES_PER_POLL} with more to read.
   *
   * What makes a cycle `pending`. Never silent — see `cadence.ts`.
   */
  readonly capped: boolean;
  /** The freshness stamp this poll wrote, or `undefined` when it wrote none. */
  readonly syncedAt?: Date;
  /** The watermark the next poll will send as `since`, or `undefined` when there is none. */
  readonly cursor?: string;
}

/** What one workspace's share of a cycle did. */
export interface OrganizationSyncOutcome {
  /** The workspace. */
  readonly organizationId: string;
  /**
   * Why nothing was polled for this workspace, or `undefined` when something was.
   *
   * Workspace-wide reasons only: no token, no enabled repositories, and a spent rate limit —
   * that last one because the budget belongs to the token rather than to any repository, so
   * carrying on to the next repository would only spend a limit that is already gone.
   */
  readonly pause?: SyncPause;
  /** What each of its repositories did. Empty when {@link pause} is set. */
  readonly repositories: readonly RepoSyncOutcome[];
}

/** What one cycle of the whole loop did. */
export interface SyncCycleReport {
  /** The cycle's clock — one instant, shared by every freshness stamp it writes. */
  readonly startedAt: Date;
  /** Each configured workspace, whether or not it had anything to do. */
  readonly organizations: readonly OrganizationSyncOutcome[];
  /**
   * Whether a repository stopped at the cap and has known work waiting.
   *
   * The scheduler reads it and books the next cycle in
   * {@link "./cadence".CONTINUATION_DELAY_MS} rather than a full interval, which is what makes
   * a cold import of a large backlog several quick cycles instead of an afternoon.
   */
  readonly pending: boolean;
}

/**
 * The totals a log line quotes, over a whole cycle.
 *
 * @param report - The cycle.
 * @returns Rows imported, rewritten and left alone, issues handed on, and how many
 *   repositories were polled — enough for one sentence an operator can act on, and nothing
 *   that names a token or a person.
 */
export function cycleTotals(report: SyncCycleReport): {
  repositories: number;
  imported: number;
  updated: number;
  unchanged: number;
  enqueued: number;
  paused: number;
} {
  const repositories = report.organizations.flatMap((organization) => organization.repositories);
  const polled = repositories.filter((repository) => repository.pause === undefined);

  return {
    repositories: polled.length,
    imported: sum(polled, (repository) => repository.imported),
    updated: sum(polled, (repository) => repository.updated),
    unchanged: sum(polled, (repository) => repository.unchanged),
    enqueued: sum(polled, (repository) => repository.enqueued),
    paused:
      repositories.length -
      polled.length +
      report.organizations.filter((organization) => organization.pause !== undefined).length,
  };
}

/**
 * Add up one field across a list.
 *
 * @param items - The list.
 * @param of - Which number to take from each.
 * @returns The total; `0` for an empty list, which is the common cycle.
 */
function sum<T>(items: readonly T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0);
}
