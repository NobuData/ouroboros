/**
 * `PolicyResolutionService` — the one reader of the published org policy (BQ.2,
 * [#481](https://github.com/NobuData/ouroboros/issues/481)).
 *
 * ```
 * current(org)        cached read (short TTL), cleared on publish   — what a request decides with
 * currentNow(org)     uncached read                                 — an execution-time re-check
 * resolve(org, rule)  one rule's attributed verdict                 — policy-resolution.ts
 * snapshot(org)       one version for a whole decision              — several rules, never two versions
 * invalidate(org)     drop the cached read                          — the publish flow, after it commits
 * ```
 *
 * Every enforcement point reads through here — the gate engine's `human_review`, the merge
 * executor's `auto_merge`, AP.3's `protected_paths`, Z.1's `spend_guard`, the dry-run plane's
 * `dry_run_new_repos` and the inbox's *What Needs A Human* card — so the settings card's document
 * and the gates cannot drift apart.
 *
 * **The cache is per process.** A publish on this process clears it at once; a publish on another
 * replica is seen within {@link POLICY_CACHE_TTL_MS}. The decisions that must not act on a stale
 * read — a merge at execution — use {@link PolicyResolutionService.currentNow}.
 */

import { Inject, Injectable, Optional } from "@nestjs/common";

import type { CoreRuleId, PublishedOrgPolicy } from "./org-policy.document";
import {
  OrgPolicyRepository,
  type PolicyDocumentStore,
  type RepositoryLoopStore,
} from "./org-policy.repository";
import { POLICY_CLOCK } from "./org-policy.service";
import {
  type PolicyContext,
  type PolicyVerdict,
  type RuleValues,
  resolveRule,
} from "./policy-resolution";

/** How long a cached read of the published document stands, in milliseconds. */
export const POLICY_CACHE_TTL_MS = 30_000;

/** What a consumer needs of the resolver to take one decision — a snapshot. */
export interface PolicySnapshotSource {
  /**
   * @param organizationId - The workspace.
   * @param fresh - Read uncached — for a decision taken at execution.
   * @returns One version, held for the decision.
   */
  snapshot(organizationId: string, fresh?: boolean): Promise<PolicySnapshot>;
}

/** One published version, held for one decision. */
export interface PolicySnapshot {
  /** The version every rule of this decision is read from, or null when none is published. */
  readonly policy: PublishedOrgPolicy | null;
  /**
   * Resolve one rule against this snapshot's version.
   *
   * @param ruleId - The rule.
   * @param context - The facts it needs.
   * @returns Its verdict, attributed to this snapshot's version.
   */
  resolve<R extends CoreRuleId>(ruleId: R, context?: PolicyContext): PolicyVerdict<RuleValues[R]>;
}

/**
 * A snapshot over one read.
 *
 * @param policy - The version, or null.
 * @returns The snapshot.
 */
export function snapshotOf(policy: PublishedOrgPolicy | null): PolicySnapshot {
  return {
    policy,
    resolve: (ruleId, context) => resolveRule(policy, ruleId, context),
  };
}

@Injectable()
export class PolicyResolutionService implements PolicySnapshotSource {
  /** Cached reads, by workspace. */
  private readonly cache = new Map<
    string,
    { readonly policy: PublishedOrgPolicy | null; readonly at: number }
  >();

  /** The clock. */
  private readonly now: () => number;

  /**
   * @param store - The published document.
   * @param clock - The clock, for the cache — `Date.now` unless a suite binds one.
   */
  constructor(
    @Inject(OrgPolicyRepository)
    private readonly store: PolicyDocumentStore & Partial<RepositoryLoopStore>,
    @Optional() @Inject(POLICY_CLOCK) clock?: () => number,
  ) {
    this.now = clock ?? Date.now;
  }

  /**
   * The workspace's published policy, from the cache while it stands.
   *
   * @param organizationId - The workspace.
   * @returns The version in force, or null when none is published.
   */
  async current(organizationId: string): Promise<PublishedOrgPolicy | null> {
    const cached = this.cache.get(organizationId);

    if (cached !== undefined && this.now() - cached.at < POLICY_CACHE_TTL_MS) {
      return cached.policy;
    }

    return this.currentNow(organizationId);
  }

  /**
   * The workspace's published policy, read now — and the cache refreshed with it.
   *
   * @param organizationId - The workspace.
   * @returns The version in force, or null when none is published.
   */
  async currentNow(organizationId: string): Promise<PublishedOrgPolicy | null> {
    const policy = await this.store.current(organizationId);

    this.cache.set(organizationId, { policy, at: this.now() });

    return policy;
  }

  /**
   * One version, held for a decision that resolves several rules.
   *
   * @param organizationId - The workspace.
   * @param fresh - Read uncached — for a decision taken at execution.
   * @returns The snapshot.
   */
  async snapshot(organizationId: string, fresh = false): Promise<PolicySnapshot> {
    return snapshotOf(
      fresh ? await this.currentNow(organizationId) : await this.current(organizationId),
    );
  }

  /**
   * One rule's verdict, attributed to the version that produced it.
   *
   * @param organizationId - The workspace.
   * @param ruleId - The rule.
   * @param context - The facts it needs.
   * @returns The verdict.
   */
  async resolve<R extends CoreRuleId>(
    organizationId: string,
    ruleId: R,
    context: PolicyContext = {},
  ): Promise<PolicyVerdict<RuleValues[R]>> {
    return resolveRule(await this.current(organizationId), ruleId, context);
  }

  /**
   * Which loop of its repository the next PR opened there will be — `dry_run_new_repos`' input for
   * a PR not yet opened.
   *
   * @param organizationId - The workspace.
   * @param githubRepoId - `github_repos.id`, or null when the repository is not known.
   * @returns The 1-based loop, or null when the repository is not known (read as still in dry-run).
   */
  async nextLoop(organizationId: string, githubRepoId: string | null): Promise<number | null> {
    if (githubRepoId === null || this.store.loopsOpened === undefined) {
      return null;
    }

    return (await this.store.loopsOpened(organizationId, githubRepoId)) + 1;
  }

  /**
   * Drop the workspace's cached read — the publish flow calls this once its write commits.
   *
   * @param organizationId - The workspace.
   */
  invalidate(organizationId: string): void {
    this.cache.delete(organizationId);
  }
}
