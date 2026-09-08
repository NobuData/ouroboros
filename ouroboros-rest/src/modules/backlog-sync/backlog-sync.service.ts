/**
 * `BacklogSyncService` — the thing mockup 03's subline is actually claiming.
 *
 * K.4 ([#102](https://github.com/NobuData/ouroboros/issues/102)). *"Ouroboros watches the
 * GitHub backlog and continuously estimates effort, risk, and routing for every open issue —
 * before you ever ask it to work"* is a sentence about a poller, and this is the poller.
 * Without it `github_issues` stays empty, the *"synced 40s ago"* tag has nothing to render,
 * and nothing ever enters the estimation pipeline.
 *
 * ---------------------------------------------------------------------------
 * ## An initial import and an incremental poll ask GitHub different questions
 *
 * Decision **K2** is *incremental polling with a per-repo `since` cursor*, and the cursor's
 * presence is what distinguishes the two calls:
 *
 * |                  | initial import (no cursor)        | incremental poll (cursor)          |
 * |------------------|-----------------------------------|------------------------------------|
 * | `state`          | `open`                            | `all`                              |
 * | `since`          | absent                            | the stored watermark               |
 *
 * **`state=all` on the incremental poll is not a mistake, and the difference matters.** The
 * issue's own diagram writes `state=open&since=…`, and that combination cannot satisfy the
 * criterion two lines below it — *"closing it flips `state`"* — because an issue that closed
 * upstream simply stops being in an `open` listing and would sit in this mirror as open
 * forever. So the *initial* import takes `state=open`, which is what stops a cold start from
 * dragging in a decade of closed issues, and every poll after it takes `state=all` bounded by
 * `since`, which is what makes a close arrive. A closed issue this mirror has never seen is
 * still not stored — `backlog-sync.repository.ts` drops it — so `state=all` widens what the
 * sync *learns* without widening what it *keeps*.
 *
 * ## The watermark is what the poll saw, not what its clock said
 *
 * The next `since` is the greatest `updated_at` among the issues GitHub returned, never this
 * process's own clock. A clock-derived watermark is wrong by however far this host has drifted
 * from GitHub's, and it is wrong in the direction that loses issues: a host running a few
 * seconds fast would skip everything updated inside the skew. What the poll observed is a fact
 * about GitHub's own timeline, and V014's header asks for exactly that — *"a stored cursor is a
 * fact about what the poller did"*.
 *
 * A poll that returned nothing leaves the watermark where it was and still stamps
 * `issues_synced_at`, because *"we looked and nothing had changed"* is precisely what the
 * freshness tag claims.
 *
 * ## Ascending order, so a capped poll is resumable rather than truncated
 *
 * The walk asks for `sort=updated&direction=asc`. With a cap on how much one poll holds (see
 * `cadence.ts`), ascending order means the issues a capped poll stored are exactly the ones at
 * or before the watermark it writes — so the next poll continues from there instead of
 * starting again, and the mirror is never in a state where the watermark claims more than it
 * holds.
 *
 * ## Nothing is ever a silent no-op
 *
 * The last acceptance criterion. A workspace with no token pauses `not_configured`; a workspace
 * with a token and nothing enabled pauses `no_repositories`; a repository the token cannot see
 * pauses `not_found` without costing its neighbours their poll; a spent budget pauses the whole
 * *workspace*, because the budget belongs to the token and the next repository would only spend
 * a limit that is already gone. Every one of those is a word from `sync.report.ts`, in the
 * report and in the log, and M.4 ([#113](https://github.com/NobuData/ouroboros/issues/113)) is
 * what will render it.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";

import { describeForLog } from "../errors/failure";
import { GithubClient } from "../github/github.client";
import { GithubClientFactory } from "../github/github.client.factory";
import { GithubCredentialsService } from "../github/github.credentials.service";
import { GITHUB_FAILURES, GithubApiError } from "../github/github.errors";
import { chunked } from "../scheduling/cadence";
import { BacklogSyncRepository, type SyncTarget } from "./backlog-sync.repository";
import { MAX_ISSUES_PER_POLL, REPO_CONCURRENCY } from "./cadence";
import { ESTIMATION_INTAKE, type EstimableIssue, type EstimationIntake } from "./estimation.intake";
import {
  ISSUES_ROUTE,
  cursorInstant,
  cursorOf,
  readPayload,
  type MirroredIssue,
} from "./issue.mapping";
import {
  SYNC_NO_REPOSITORIES,
  type OrganizationSyncOutcome,
  type RepoSyncOutcome,
  type SyncCycleReport,
  type SyncPause,
} from "./sync.report";

/** What one walk of one repository read, before anything is written. */
interface WalkResult {
  /** The issues, mapped, in ascending `updated` order. */
  readonly issues: readonly MirroredIssue[];
  /** Pull requests dropped. */
  readonly pullRequests: number;
  /** Payloads that could not be represented, each already logged. */
  readonly unusable: number;
  /** Whether the walk stopped at {@link MAX_ISSUES_PER_POLL} with more to read. */
  readonly capped: boolean;
}

@Injectable()
export class BacklogSyncService {
  /** Where a paused workspace, a dropped payload and a failed poll are reported. */
  private readonly logger = new Logger(BacklogSyncService.name);

  /**
   * The most recent cycle, or `undefined` before the first one has run.
   *
   * Held so that M.4's status endpoint has something to answer *"why is this paused"* with —
   * the durable half of the answer is `github_repos.issues_synced_at` and `issues_sync_cursor`,
   * which say what the last poll *did*, and this is the half that says why one did not run.
   * Deliberately in memory and not in a table: a pause reason is a property of this process's
   * last attempt, and a restart has not attempted anything yet.
   */
  private last?: SyncCycleReport;

  /**
   * @param repository - The statements against `github_repos` and `github_issues`.
   * @param clients - Where an authenticated client for a workspace comes from. It opens the
   *   token per call and never caches it, which is what makes *"rotate → the old token is never
   *   used again"* structural rather than intended.
   * @param credentials - Which workspaces have a token at all. The set a cycle starts from,
   *   and the only way `no_repositories` can be told apart from `not_configured`.
   * @param estimation - Where a new or reopened issue is handed on. L.3's
   *   ([#107](https://github.com/NobuData/ouroboros/issues/107)) when it lands; until then the
   *   logging placeholder `estimation.intake.ts` documents.
   */
  constructor(
    private readonly repository: BacklogSyncRepository,
    private readonly clients: GithubClientFactory,
    private readonly credentials: GithubCredentialsService,
    @Inject(ESTIMATION_INTAKE) private readonly estimation: EstimationIntake,
  ) {}

  /**
   * The last cycle's report.
   *
   * @returns The report, or `undefined` when no cycle has completed in this process. M.4 reads
   *   it beside the stored cursors; nothing else does.
   */
  lastCycle(): SyncCycleReport | undefined {
    return this.last;
  }

  /**
   * Poll every configured workspace once.
   *
   * @param now - The cycle's clock. Passed in rather than read, so every freshness stamp in one
   *   cycle is the same instant and a test can place one without waiting.
   * @returns What the cycle did, workspace by workspace. Never rejects for anything GitHub did
   *   — those are pauses, which is the point of the file — but a database that is down rejects,
   *   and that is the scheduler's to catch.
   */
  async cycle(now: Date = new Date()): Promise<SyncCycleReport> {
    const configured = await this.credentials.configuredOrganizations();
    const targets = await this.repository.enabledRepositories();

    const organizations: OrganizationSyncOutcome[] = [];

    for (const organizationId of configured) {
      organizations.push(
        await this.syncOrganization(
          organizationId,
          targets.filter((target) => target.organizationId === organizationId),
          now,
        ),
      );
    }

    // A workspace with enabled repositories and no token never reaches the loop above, because
    // `configured` is the set that has one. It is still a state somebody has to be told about
    // — it is the state a workspace is in the moment its token is cleared — so it is reported
    // here rather than left out of the report entirely.
    for (const organizationId of unconfigured(targets, configured)) {
      organizations.push({
        organizationId,
        pause: GITHUB_FAILURES.notConfigured,
        repositories: [],
      });
    }

    const report: SyncCycleReport = {
      startedAt: now,
      organizations,
      pending: organizations.some((organization) =>
        organization.repositories.some((repository) => repository.capped),
      ),
    };

    this.last = report;

    return report;
  }

  /**
   * Poll one workspace's repositories.
   *
   * @param organizationId - The workspace.
   * @param targets - Its enabled repositories, which may be none.
   * @param now - The cycle's clock.
   * @returns What it did, or the one word for why it did nothing.
   */
  private async syncOrganization(
    organizationId: string,
    targets: readonly SyncTarget[],
    now: Date,
  ): Promise<OrganizationSyncOutcome> {
    if (targets.length === 0) {
      this.logger.log(
        `Backlog sync is idle for workspace ${organizationId}: ${SYNC_NO_REPOSITORIES}.`,
      );

      return { organizationId, pause: SYNC_NO_REPOSITORIES, repositories: [] };
    }

    let client: GithubClient;

    try {
      client = await this.clients.forOrganization(organizationId);
    } catch (error) {
      const pause = pauseFor(error);

      this.logger.log(`Backlog sync is paused for workspace ${organizationId}: ${pause}.`);

      return { organizationId, pause, repositories: [] };
    }

    const repositories: RepoSyncOutcome[] = [];

    // Chunked rather than all at once: these requests spend one workspace's hourly budget, and
    // arriving at the rate guard's floor in a burst is the thing worth not doing. See
    // `cadence.ts`.
    for (const run of chunked([...targets], REPO_CONCURRENCY)) {
      const outcomes = await Promise.all(
        run.map((target) => this.syncRepository(client, target, now)),
      );

      repositories.push(...outcomes);

      // The budget belongs to the token, so one repository hitting it means every other
      // repository in this workspace would too. Stopping here spends nothing further and leaves
      // the untouched repositories' freshness honestly stale.
      const spent = outcomes.find((outcome) => outcome.pause === GITHUB_FAILURES.rateLimited);

      if (spent !== undefined) {
        this.logger.warn(
          `Backlog sync stopped early for workspace ${organizationId}: ` +
            `${GITHUB_FAILURES.rateLimited} — the remaining repositories keep their previous freshness.`,
        );

        return { organizationId, pause: GITHUB_FAILURES.rateLimited, repositories };
      }
    }

    return { organizationId, repositories };
  }

  /**
   * Poll one repository, and write what it read.
   *
   * @param client - The workspace's authenticated client.
   * @param target - The repository, its stored watermark and its last stamp.
   * @param now - The cycle's clock.
   * @returns What the poll did, or why it could not.
   */
  private async syncRepository(
    client: GithubClient,
    target: SyncTarget,
    now: Date,
  ): Promise<RepoSyncOutcome> {
    const repository = `${target.owner}/${target.name}`;
    const empty = {
      organizationId: target.organizationId,
      githubRepoId: target.githubRepoId,
      repository,
      imported: 0,
      updated: 0,
      unchanged: 0,
      pullRequests: 0,
      unusable: 0,
      enqueued: 0,
      capped: false,
    } as const;

    let walk: WalkResult;

    try {
      walk = await this.walk(client, target, repository);
    } catch (error) {
      const pause = pauseFor(error);

      this.logger.warn(`Backlog sync paused for ${repository}: ${pause}.`, describeForLog(error));

      return { ...empty, pause };
    }

    // One watermark, computed once and written once: the value stored is the value reported,
    // so M.4 cannot render a cursor the column does not hold.
    const cursor = watermark(walk.issues);

    const written = await this.repository.applyPoll({
      target,
      issues: walk.issues,
      cursor,
      syncedAt: now,
    });

    await this.handOff(written.estimable, repository);

    return {
      ...empty,
      imported: written.imported,
      updated: written.updated,
      unchanged: written.unchanged,
      pullRequests: walk.pullRequests,
      unusable: walk.unusable,
      enqueued: written.estimable.length,
      capped: walk.capped,
      syncedAt: now,
      // The watermark this poll earned, or the stored one it left standing.
      cursor: cursor ?? target.cursor ?? undefined,
    };
  }

  /**
   * Read one repository's issues from GitHub.
   *
   * @param client - The workspace's client.
   * @param target - The repository and its watermark.
   * @param repository - `owner/name`, for the log.
   * @returns What the walk read. Stops at {@link MAX_ISSUES_PER_POLL}, which is a bound on
   *   memory and not a failure — see `cadence.ts`.
   * @throws {GithubApiError} Whatever the client classified, unhandled here so that one
   *   repository's failure is one repository's pause.
   */
  private async walk(
    client: GithubClient,
    target: SyncTarget,
    repository: string,
  ): Promise<WalkResult> {
    const issues: MirroredIssue[] = [];
    let pullRequests = 0;
    let unusable = 0;
    let capped = false;

    for await (const page of client.pages<unknown>(ISSUES_ROUTE, this.query(target))) {
      // A `304` is the cheapest possible *"nothing has changed"*, and it costs nothing from the
      // hourly budget. It is a page of its own rather than an empty walk precisely so a poller
      // cannot confuse it with a repository whose backlog is genuinely empty.
      if (page.notModified) {
        break;
      }

      for (const payload of page.items) {
        const read = readPayload(payload);

        if (read.kind === "pull_request") {
          pullRequests += 1;
          continue;
        }

        if (read.kind === "unusable") {
          unusable += 1;
          // One line per dropped payload, because a count alone would say *something* is wrong
          // without saying what. The reason names a field and a number and quotes no content.
          this.logger.warn(`Backlog sync skipped an issue in ${repository}: ${read.reason}`);
          continue;
        }

        issues.push(read.issue);
      }

      if (issues.length >= MAX_ISSUES_PER_POLL) {
        capped = true;
        break;
      }
    }

    return { issues, pullRequests, unusable, capped };
  }

  /**
   * The query one poll sends.
   *
   * @param target - The repository and its stored watermark.
   * @returns Octokit's parameters. See this file's header for why `state` depends on whether
   *   there is a cursor, and why the order is ascending.
   */
  private query(target: SyncTarget): Record<string, unknown> {
    const since = target.cursor === null ? undefined : cursorInstant(target.cursor);

    return {
      owner: target.owner,
      repo: target.name,
      // A stored cursor that is not a timestamp is a corrupted column, not a reason to send
      // GitHub something it will refuse: the poll falls back to an initial import, which is
      // correct and merely more expensive, and the next write replaces the bad value.
      state: since === undefined ? "open" : "all",
      ...(since === undefined ? {} : { since: cursorOf(since) }),
      sort: "updated",
      direction: "asc",
    };
  }

  /**
   * Tell the estimation pipeline about new and reopened issues.
   *
   * @param estimable - What to hand over. Empty on most polls.
   * @param repository - `owner/name`, for the log.
   * @returns When the handoff has been attempted. A pipeline that refuses costs the handoff and
   *   not the poll: the rows are committed and `unsized`, which is a state L.3's own stale
   *   sweep is designed to find.
   */
  private async handOff(estimable: readonly EstimableIssue[], repository: string): Promise<void> {
    if (estimable.length === 0) {
      return;
    }

    try {
      await this.estimation.accept(estimable);
    } catch (error) {
      this.logger.error(
        `Backlog sync could not hand ${String(estimable.length)} issue(s) from ${repository} ` +
          "to the estimation pipeline; they remain unsized.",
        describeForLog(error),
      );
    }
  }
}

/**
 * The watermark a poll earned.
 *
 * @param issues - What GitHub returned, in ascending `updated` order.
 * @returns The greatest `updated_at` among them as a cursor, or `null` when the poll returned
 *   nothing — in which case the stored watermark stands, because a poll that saw no issues
 *   learned nothing about where the next one should start.
 */
function watermark(issues: readonly MirroredIssue[]): string | null {
  if (issues.length === 0) {
    return null;
  }

  // The maximum rather than the last element: the order is GitHub's to honour and this does not
  // depend on it having done so.
  const latest = issues.reduce((newest, issue) =>
    issue.ghUpdatedAt.getTime() > newest.ghUpdatedAt.getTime() ? issue : newest,
  );

  return cursorOf(latest.ghUpdatedAt);
}

/**
 * Which pause a thrown thing is.
 *
 * @param error - Whatever a client call or the factory threw.
 * @returns The classified reason, or `upstream_error` for anything that is not a
 *   {@link GithubApiError} — a bug here is still this service failing to reach GitHub, and
 *   naming it something more specific would be a guess.
 */
function pauseFor(error: unknown): SyncPause {
  return error instanceof GithubApiError ? error.failure : GITHUB_FAILURES.upstreamError;
}

/**
 * Workspaces that have an enabled repository and no token.
 *
 * @param targets - Every enabled repository, across every workspace.
 * @param configured - The workspaces that have a token.
 * @returns The workspace ids in the first set and not the second, each once.
 */
function unconfigured(targets: readonly SyncTarget[], configured: readonly string[]): string[] {
  const has = new Set(configured);

  return [
    ...new Set(
      targets
        .map((target) => target.organizationId)
        .filter((organizationId) => !has.has(organizationId)),
    ),
  ];
}
