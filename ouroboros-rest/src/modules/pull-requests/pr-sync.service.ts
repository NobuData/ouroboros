/**
 * `PrSyncService` — one mirrored PR brought up to date with its host, and each new push recorded as
 * a revision with the file snapshot the changed-files card needs.
 *
 * AX.1 ([#357](https://github.com/NobuData/ouroboros/issues/357)), the writer V052's header names
 * for `pull_requests`' and `pr_revisions`' sync-owned columns.
 *
 * ```
 * sync(org, source, #514)
 *   ├─ source, inside the workspace asking                         (isolation)
 *   ├─ registry.find(kind) → supportsPullRequests, or 409           (SPI only — never a provider import)
 *   ├─ mirror's latest head sha ─▶ provider.syncPR(ctx, #514, sha)  revision detection by head-sha change
 *   └─ applySync ── one transaction: snapshot · state by rule · revision N+1 when the head moved
 * ```
 *
 * **Why the host is asked with the mirror's head.** The provider cannot know which pushes the
 * mirror has seen, and the mirror cannot know which the host has had; handing the latest recorded
 * sha across the SPI is the whole of how a revision is detected, and it is by sha rather than by
 * time — a comment moves a PR's stamp and is not a push.
 *
 * **The credential is opened for one call**, by `TicketSourcesService.withCredentials`, exactly as
 * the intake loop and the push service open it.
 *
 * **Every sync tells the gate engine** (AX.2, #358), after the mirror's transaction commits: a new
 * revision is `revision_pushed` (every gate re-evaluated, a new snapshot), anything else is
 * `pr_synced` (definitions re-materialized, state brought in line). The sink never throws, so a gate
 * problem never fails a sync.
 *
 * **The merge executor (AX.4, #360) reaches the host only through here** — {@link PrSyncService.get}
 * for its re-check, {@link PrSyncService.merge}, {@link PrSyncService.comment} for the evidence
 * summary, and {@link PrSyncService.sync} to mirror the merge once it has committed. Nothing calls
 * `sync` on a schedule yet; a `prEvents` poll loop joins the executor there.
 *
 * **Opening a PR is dry-run's first enforcement point** (BA.3, #382): {@link PrSyncService.create}
 * is the plane's only way to the SPI's `createPR`, and it forces `draft` while the workspace's
 * dry-run policy is active, whatever the caller asked — so a loop-created PR (AZ.5, #375) inherits
 * the guarantee rather than having to remember it. Without a policy reader (a context that did not
 * wire one) every PR opens as a draft: the safe direction.
 */

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

import type { TicketSourceKind } from "../db/schema";
import { DecisionSourceWatcher } from "../decisions/decision.watchers";
import { describeForLog } from "../errors/failure";
import { FACT_COMMIT_OBSERVER, type FactCommitObserver } from "../facts/facts.observer";
import { FARM_MERGE_OBSERVER, type FarmMergeObserver } from "../farm/config/merge.observer";
import {
  CALIBRATION_MERGE_OBSERVER,
  type CalibrationMergeObserver,
} from "../insights/calibration.observer";
import { OrgPolicyService, type DryRunPolicyReader } from "../policies/org-policy.service";
import { draftFor } from "../policies/org-policy.rules";
import { effectiveDryRun } from "../policies/policy-resolution";
import {
  PolicyResolutionService,
  type PolicySnapshotSource,
} from "../policies/policy-resolution.service";
import type {
  CreatePrInput,
  MergePrInput,
  MergePrResult,
  PrCommentInput,
  PrCommentResult,
  PrRef,
  PullRequestSnapshot,
  ReviewRequestResult,
} from "../ticket-sources/ticket-source.pr";
import {
  supportsPullRequests,
  type PrCapableProvider,
  type TicketSyncContext,
} from "../ticket-sources/ticket-source.provider";
import { TicketSourceRegistry } from "../ticket-sources/ticket-source.registry";
import type { SyncSource } from "../ticket-sources/ticket-sources.repository";
import { TicketSourcesService } from "../ticket-sources/ticket-sources.service";
import { GATE_EVIDENCE, type GateEvidenceSink } from "./gates/gate.evidence";
import { prSourceHasNoPullRequests, prSourceNotFound } from "./pr-sync.errors";
import { PrMirrorRepository, type PrMirrorStore, type PrSyncOutcome } from "./pr-sync.repository";

/** What opens a source's credential for one call — `TicketSourcesService.withCredentials`. */
export interface PrSourceOpener {
  /**
   * @param source - The source.
   * @param run - What to do with the opened context.
   * @returns What `run` returned.
   */
  withCredentials<T>(
    source: SyncSource,
    run: (context: TicketSyncContext) => Promise<T>,
  ): Promise<T>;
}

@Injectable()
export class PrSyncService {
  /** Where a failed report to the fact sweep is logged. */
  private readonly logger = new Logger(PrSyncService.name);

  /**
   * @param store - The mirror's statements.
   * @param registry - The providers, by kind.
   * @param sources - What opens a source's credential for one call.
   * @param gates - The gate engine's sink, told about every sync; absent in a context without it.
   * @param facts - The fact staleness sweep, told about every merge this sync is the first to see
   *   (BF.2, #411); absent in a context without it.
   * @param policy - The dry-run policy (BA.3, #382), read by {@link PrSyncService.create}; absent
   *   in a context without it, where every PR opens as a draft.
   * @param calibration - The estimator calibration fill, told about every merge this sync is the
   *   first to see (BI.4, #435); absent in a context without it.
   * @param farm - The farm's job hooks, told about every merge this sync is the first to see
   *   (BV.5, #514); absent in a context without it.
   * @param decisions - The Needs-You watcher (#461), asked to sweep the workspace when a sync sees
   *   a PR merged or closed — so a card asking about it closes at once as `policy(source_resolved)`;
   *   absent in a context without it, where the minute's sweep does it.
   */
  constructor(
    @Inject(PrMirrorRepository) private readonly store: PrMirrorStore,
    private readonly registry: TicketSourceRegistry,
    @Inject(TicketSourcesService) private readonly sources: PrSourceOpener,
    @Optional() @Inject(GATE_EVIDENCE) private readonly gates?: GateEvidenceSink,
    @Optional() @Inject(FACT_COMMIT_OBSERVER) private readonly facts?: FactCommitObserver,
    @Optional() @Inject(OrgPolicyService) private readonly policy?: DryRunPolicyReader,
    @Optional()
    @Inject(CALIBRATION_MERGE_OBSERVER)
    private readonly calibration?: CalibrationMergeObserver,
    @Optional() @Inject(FARM_MERGE_OBSERVER) private readonly farm?: FarmMergeObserver,
    @Optional() private readonly decisions?: DecisionSourceWatcher,
    @Optional() @Inject(PolicyResolutionService) private readonly resolver?: PolicyLoopSource,
  ) {}

  /**
   * Open a PR on the source's host — a **draft** while the dry-run policy is active, regardless of
   * what the caller asked (BA.3, #382).
   *
   * **Since BQ.2** (#481) dry-run is asked for the PR's repository: the org-wide switch is the
   * stricter override, and otherwise the org policy's `dry_run_new_repos` keeps a repository's
   * first N loops drafts — this PR being loop *(PRs already opened there) + 1*. A caller that does
   * not name the repository gets the stricter answer while the rule is on.
   *
   * @param organizationId - The workspace asking.
   * @param sourceId - The git-host source to open it on.
   * @param input - The branches, title, description and the caller's draft wish.
   * @param githubRepoId - The repository the PR is opened on (`github_repos.id`), when known.
   * @returns The PR — the open one already proposing this branch into this base when there is one
   *   (which keeps its own draft state) — or null when the provider does not open PRs.
   * @throws {NotFoundError} `pr_source_not_found` for a source the workspace does not have.
   * @throws {ConflictError} `pr_source_has_no_pull_requests` for a tracker without PRs.
   * @throws {TicketSourceError} The host's refusal, classified by the provider.
   */
  async create(
    organizationId: string,
    sourceId: string,
    input: CreatePrInput,
    githubRepoId: string | null = null,
  ): Promise<PrRef | null> {
    const draft = draftFor(input.draft, await this.dryRunFor(organizationId, githubRepoId));

    return this.withHost(organizationId, sourceId, (provider, context) =>
      provider.createPR(context, { ...input, draft }),
    );
  }

  /**
   * Whether a PR about to be opened on a repository is in dry-run — read uncached, since it is
   * decided once and the PR keeps it.
   *
   * @param organizationId - The workspace.
   * @param githubRepoId - The repository, or null when not known.
   * @returns True while the org-wide switch is on, or the repository is inside its first N loops.
   */
  private async dryRunFor(organizationId: string, githubRepoId: string | null): Promise<boolean> {
    if (this.policy === undefined) {
      return true;
    }

    const override = await this.policy.dryRunNow(organizationId);

    if (override || this.resolver === undefined) {
      return override;
    }

    const [snapshot, loop] = await Promise.all([
      this.resolver.snapshot(organizationId, true),
      this.resolver.nextLoop(organizationId, githubRepoId),
    ]);

    return effectiveDryRun(override, snapshot.resolve("dry_run_new_repos", { loop })).active;
  }

  /**
   * Bring one PR's mirror up to date, recording a revision when its head moved.
   *
   * @param organizationId - The workspace asking.
   * @param sourceId - The git-host source the PR lives on.
   * @param prNumber - The host's number.
   * @returns What was written.
   * @throws {NotFoundError} `pr_source_not_found` for a source the workspace does not have.
   * @throws {ConflictError} `pr_source_has_no_pull_requests` for a tracker without PRs.
   * @throws {TicketSourceError} The host's refusal, classified by the provider.
   */
  async sync(organizationId: string, sourceId: string, prNumber: number): Promise<PrSyncOutcome> {
    const source = await this.store.source(organizationId, sourceId);

    if (source === undefined) {
      throw prSourceNotFound(sourceId);
    }

    const provider = this.prHost(source.kind, sourceId);
    const mirrored = await this.store.mirrored(sourceId, prNumber);
    const synced = await this.sources.withCredentials(source, (context) =>
      provider.syncPR(context, prNumber, mirrored?.headSha ?? null),
    );

    const outcome = await this.store.applySync({
      source,
      snapshot: synced.pr,
      revision: synced.revision,
    });

    await this.gates?.notify(organizationId, {
      kind: outcome.newRevision || outcome.created ? "revision_pushed" : "pr_synced",
      prId: outcome.prId,
    });

    if (outcome.newlyMerged) {
      await this.reportMerge(organizationId, outcome.prId);
    }

    // A PR that ended on its host settles every card asking about it (#461). The sweep never
    // throws: a detector that fails costs only its own kinds, and the minute's sweep retries.
    if (outcome.state === "merged" || outcome.state === "closed") {
      await this.decisions?.sweep(organizationId);
    }

    return outcome;
  }

  /**
   * Tell the fact staleness sweep, the estimator calibration fill and the farm's job hooks a PR
   * merged. The sync has committed; any one failing is logged and costs only its own record, never
   * the sync or the others.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   */
  private async reportMerge(organizationId: string, prId: string): Promise<void> {
    try {
      await this.facts?.mergeObserved(organizationId, prId);
    } catch (error) {
      this.logger.error(
        `Fact staleness sweep for merged PR ${prId} failed; the nightly pass will catch it.`,
        describeForLog(error),
      );
    }

    try {
      await this.calibration?.mergeObserved(organizationId, prId);
    } catch (error) {
      this.logger.error(
        `Estimator calibration for merged PR ${prId} failed; a replay of the merge records it.`,
        describeForLog(error),
      );
    }

    try {
      await this.farm?.mergeObserved(organizationId, prId);
    } catch (error) {
      this.logger.error(`Farm job hooks for merged PR ${prId} failed.`, describeForLog(error));
    }
  }

  /**
   * Publish a comment on a mirrored PR, edited rather than re-posted under the same key (decision
   * **V9**). The criteria service's waiver annotation (AX.3, #359) is its first caller.
   *
   * @param organizationId - The workspace asking.
   * @param sourceId - The git-host source the PR lives on.
   * @param prNumber - The host's number.
   * @param comment - The key and the Markdown.
   * @returns The comment's id, its page, and how it landed.
   * @throws {NotFoundError} `pr_source_not_found` for a source the workspace does not have.
   * @throws {ConflictError} `pr_source_has_no_pull_requests` for a tracker without PRs.
   * @throws {TicketSourceError} The host's refusal, classified by the provider.
   */
  async comment(
    organizationId: string,
    sourceId: string,
    prNumber: number,
    comment: PrCommentInput,
  ): Promise<PrCommentResult> {
    return this.withHost(organizationId, sourceId, (provider, context) =>
      provider.commentPR(context, prNumber, comment),
    );
  }

  /**
   * One PR as its host reports it now — the merge executor's re-check (#360) asks this inside its
   * transaction, and reads who merged it afterwards.
   *
   * @param organizationId - The workspace asking.
   * @param sourceId - The git-host source the PR lives on.
   * @param prNumber - The host's number.
   * @returns The snapshot, `mergeable` included.
   * @throws {NotFoundError} `pr_source_not_found` for a source the workspace does not have.
   * @throws {ConflictError} `pr_source_has_no_pull_requests` for a tracker without PRs.
   * @throws {TicketSourceError} The host's refusal, classified by the provider.
   */
  async get(
    organizationId: string,
    sourceId: string,
    prNumber: number,
  ): Promise<PullRequestSnapshot> {
    return this.withHost(organizationId, sourceId, (provider, context) =>
      provider.getPR(context, prNumber),
    );
  }

  /**
   * Ask the host to merge a PR — the merge executor's (#360) only way to, and only after its
   * re-check passed.
   *
   * @param organizationId - The workspace asking.
   * @param sourceId - The git-host source the PR lives on.
   * @param prNumber - The host's number.
   * @param input - The plan's strategy, message and branch deletion.
   * @returns What the host did, with every keyword closure verified.
   * @throws {NotFoundError} `pr_source_not_found` for a source the workspace does not have.
   * @throws {ConflictError} `pr_source_has_no_pull_requests` for a tracker without PRs.
   * @throws {TicketSourceError} The host's refusal — a conflict or unmet branch protection among
   *   them — classified by the provider.
   */
  async merge(
    organizationId: string,
    sourceId: string,
    prNumber: number,
    input: MergePrInput,
  ): Promise<MergePrResult> {
    return this.withHost(organizationId, sourceId, (provider, context) =>
      provider.mergePR(context, prNumber, input),
    );
  }

  /**
   * Ask a person on the host to review a PR — *Request human review*'s optional host half (AX.5,
   * #361).
   *
   * @param organizationId - The workspace asking.
   * @param sourceId - The git-host source the PR lives on.
   * @param prNumber - The host's number.
   * @param login - The host login to ask.
   * @returns Who is asked now, or null when the provider declares no reviews.
   * @throws {NotFoundError} `pr_source_not_found` for a source the workspace does not have.
   * @throws {ConflictError} `pr_source_has_no_pull_requests` for a tracker without PRs.
   * @throws {TicketSourceError} The host's refusal, classified by the provider.
   */
  async requestReview(
    organizationId: string,
    sourceId: string,
    prNumber: number,
    login: string,
  ): Promise<ReviewRequestResult | null> {
    return this.withHost(organizationId, sourceId, (provider, context) =>
      provider.requestReview(context, prNumber, login),
    );
  }

  /**
   * Run one call against a source's host with its credential opened.
   *
   * @param organizationId - The workspace asking.
   * @param sourceId - The source.
   * @param run - The call.
   * @returns What `run` returned.
   * @throws {NotFoundError} `pr_source_not_found` for a source the workspace does not have.
   * @throws {ConflictError} `pr_source_has_no_pull_requests` for a tracker without PRs.
   */
  private async withHost<T>(
    organizationId: string,
    sourceId: string,
    run: (provider: PrCapableProvider, context: TicketSyncContext) => Promise<T>,
  ): Promise<T> {
    const source = await this.store.source(organizationId, sourceId);

    if (source === undefined) {
      throw prSourceNotFound(sourceId);
    }

    const provider = this.prHost(source.kind, sourceId);

    return this.sources.withCredentials(source, (context) => run(provider, context));
  }

  /**
   * The provider for a kind, narrowed to one with pull requests.
   *
   * @param kind - The source's kind.
   * @param sourceId - The source, for the refusal.
   * @returns The provider.
   * @throws {ConflictError} When nothing registered for the kind has PRs.
   */
  private prHost(kind: TicketSourceKind, sourceId: string): PrCapableProvider {
    const provider = this.registry.find(kind);

    if (provider === undefined || !supportsPullRequests(provider)) {
      throw prSourceHasNoPullRequests(sourceId);
    }

    return provider;
  }
}

/** What the PR opener needs of the policy resolver (#481). */
export type PolicyLoopSource = PolicySnapshotSource & Pick<PolicyResolutionService, "nextLoop">;
