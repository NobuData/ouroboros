/**
 * `PolicyHistoryService` — the `policy vN` tag's history popover (BS.4,
 * [#494](https://github.com/NobuData/ouroboros/issues/494)).
 *
 * ```
 * GET /policies/versions ─▶ versions newest first ─▶ each diffed against the one before it
 *                           (org_policy_versions)     (diffPolicies + publishSummary — the publish's own)
 * ```
 *
 * **History and the audit line cannot disagree**, because nothing here is stored twice: a
 * version's `changes`, `classification` and `summary` are recomputed from the two documents by the
 * functions the publish used to write its audit row. Version 1 is diffed against "no policy",
 * exactly as its publish was.
 *
 * Versions are immutable and consecutive (V092), so the version before `vN` is the next row down —
 * the page reads one row more than it returns, which is both the last item's predecessor and the
 * answer to "is there another page".
 */

import { Inject, Injectable } from "@nestjs/common";

import { rulesOf } from "./org-policy.document";
import {
  OrgPolicyRepository,
  type PolicyHistoryStore,
  type StoredPolicyHistoryVersion,
} from "./org-policy.repository";
import { type ChangeClass, type RuleChange, diffPolicies, publishSummary } from "./policy-publish";

/** The history's default page. */
export const POLICY_HISTORY_PAGE_DEFAULT = 20;

/** The history's largest page. */
export const POLICY_HISTORY_PAGE_MAX = 100;

/** One published version, as the history popover lists it. */
export interface PolicyVersionResource {
  readonly version: number;
  readonly publishedAt: string;
  /** `user.id`, or null for a person since deleted. */
  readonly publishedBy: string | null;
  /** Their name, or null for a person since deleted. */
  readonly publisherName: string | null;
  readonly changeNote: string | null;
  /** The version's document, verbatim — what the popover draws the before → after chips from. */
  readonly document: Record<string, unknown>;
  /** The version's class against the one before it. */
  readonly classification: ChangeClass;
  /** Each rule it changed — the `v(N-1) → vN` diff. */
  readonly changes: readonly RuleChange[];
  /** The audit card's line for it — `enabled auto-merge (policy v7)`. */
  readonly summary: string;
}

/** A page of the history, newest first. */
export interface PolicyVersionListResource {
  readonly items: readonly PolicyVersionResource[];
  /** The `before` that reads the next page, or null when this one reaches version 1. */
  readonly nextBefore: number | null;
}

/**
 * One version as the popover lists it.
 *
 * @param stored - The version.
 * @param previous - The version before it, or null for the first.
 * @returns The resource.
 */
export function policyVersionResource(
  stored: StoredPolicyHistoryVersion,
  previous: StoredPolicyHistoryVersion | null,
): PolicyVersionResource {
  const diff = diffPolicies(
    previous === null ? null : rulesOf(previous.document),
    rulesOf(stored.document),
  );

  return {
    version: stored.version,
    publishedAt: stored.publishedAt.toISOString(),
    publishedBy: stored.publishedBy,
    publisherName: stored.publisherName,
    changeNote: stored.changeNote,
    document: stored.document,
    classification: diff.classification,
    changes: diff.changes,
    summary: publishSummary(diff, stored.version),
  };
}

@Injectable()
export class PolicyHistoryService {
  /** @param store - The published versions. */
  constructor(@Inject(OrgPolicyRepository) private readonly store: PolicyHistoryStore) {}

  /**
   * A page of a workspace's published versions, newest first.
   *
   * @param organizationId - The workspace.
   * @param limit - The most versions to return; {@link POLICY_HISTORY_PAGE_DEFAULT} when absent.
   * @param before - Only versions strictly below this one; absent for the newest.
   * @returns The page — empty, with no next page, when nothing is published.
   */
  async list(
    organizationId: string,
    limit: number = POLICY_HISTORY_PAGE_DEFAULT,
    before: number | null = null,
  ): Promise<PolicyVersionListResource> {
    // One more than the page: the last item's predecessor, and whether another page exists.
    const rows = await this.store.versions(organizationId, before, limit + 1);
    const page = rows.slice(0, limit);

    return {
      items: page.map((stored, index) => policyVersionResource(stored, rows[index + 1] ?? null)),
      nextBefore: rows.length > limit ? page[page.length - 1].version : null,
    };
  }
}
