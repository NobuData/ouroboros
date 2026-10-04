/**
 * `OrgPolicyService` — the dry-run policy's one source: the read every surface uses, the
 * onboarding default, and the owner/admin flip, audited.
 *
 * BA.3 ([#382](https://github.com/NobuData/ouroboros/issues/382)), decision **O3**.
 *
 * ```
 * dryRun(org)       cached read (short TTL) — createPR, arm, the plan's state
 * dryRunNow(org)    uncached read            — the merge executor's re-check at execution
 * adoptDefault(org) onboarding completion    — true when unset, an explicit false kept
 * setDryRun(org)    the flip                 — row locked, audited policy.dry_run_changed, cache busted
 * ```
 *
 * **A workspace that never answered is not in dry-run** — V075's header argues it: the promise is
 * the wizard's, so onboarding completion is what turns it on, and a workspace from before the
 * policy existed keeps merging exactly as it did.
 *
 * **One source.** The wizard's safety rows, the PR page and the merge plan all read through here,
 * so they cannot disagree about the state, and a flip lifts or restores enforcement everywhere at
 * once.
 *
 * **The cache is per process.** A flip busts this process's entry; another process sees it within
 * {@link DRY_RUN_CACHE_TTL_MS}. That window never lets a merge through: execution re-reads the
 * policy uncached, inside the run that would call the host.
 */

import { Inject, Injectable, Optional } from "@nestjs/common";

import { POLICY_DRY_RUN_CHANGED_EVENT } from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import type { OrgPoliciesEffective } from "../db/schema";
import { DRY_RUN_REASON } from "./org-policy.rules";
import { OrgPolicyRepository, type OrgPolicyStore } from "./org-policy.repository";

/** The clock's injection token — bound only by the suites; production reads `Date.now`. */
export const POLICY_CLOCK = Symbol("POLICY_CLOCK");

/** How long a cached read stands, in milliseconds. */
export const DRY_RUN_CACHE_TTL_MS = 30_000;

/** The dry-run policy as the read API answers it. */
export interface DryRunPolicyResource {
  /** Whether dry-run is active. */
  readonly dryRun: boolean;
  /** Whether that is a stored answer (`true`), or a workspace that never answered (`false`, off). */
  readonly explicit: boolean;
  /** {@link DRY_RUN_REASON} while active, otherwise null. */
  readonly reason: string | null;
  /** When it last changed, or null when it never has. */
  readonly updatedAt: string | null;
  /** Who last changed it, or null — never changed, the onboarding default, or a person since deleted. */
  readonly updatedBy: string | null;
}

/** What the enforcement points read — the executor and the PR opener depend on this, not the class. */
export interface DryRunPolicyReader {
  /**
   * @param organizationId - The workspace.
   * @returns Whether dry-run is active, possibly from the cache.
   */
  dryRun(organizationId: string): Promise<boolean>;
  /**
   * @param organizationId - The workspace.
   * @returns Whether dry-run is active, read from the database now.
   */
  dryRunNow(organizationId: string): Promise<boolean>;
}

/** The audit trail, as the flip writes to it. */
export type PolicyAudit = Pick<AuditService, "record">;

/**
 * The resource for an effective row.
 *
 * @param row - The row, or undefined for a workspace the view has no row for.
 * @returns The resource — dry-run off for a workspace that never answered, as the view reads it.
 */
export function dryRunPolicyResource(row: OrgPoliciesEffective | undefined): DryRunPolicyResource {
  const dryRun = row?.dry_run ?? false;

  return {
    dryRun,
    explicit: row?.is_explicit ?? false,
    reason: dryRun ? DRY_RUN_REASON : null,
    updatedAt: row?.updated_at?.toISOString() ?? null,
    updatedBy: row?.updated_by ?? null,
  };
}

@Injectable()
export class OrgPolicyService implements DryRunPolicyReader {
  /** Cached reads, by workspace. */
  private readonly cache = new Map<string, { readonly dryRun: boolean; readonly at: number }>();

  /**
   * @param store - The policy statements.
   * @param audit - The audit trail (#225).
   * @param clock - The clock, for the cache — `Date.now` unless a suite binds one.
   */
  constructor(
    @Inject(OrgPolicyRepository) private readonly store: OrgPolicyStore,
    @Inject(AuditService) private readonly audit: PolicyAudit,
    @Optional() @Inject(POLICY_CLOCK) clock?: () => number,
  ) {
    this.now = clock ?? Date.now;
  }

  /** The clock. */
  private readonly now: () => number;

  /** @inheritdoc */
  async dryRun(organizationId: string): Promise<boolean> {
    const cached = this.cache.get(organizationId);

    if (cached !== undefined && this.now() - cached.at < DRY_RUN_CACHE_TTL_MS) {
      return cached.dryRun;
    }

    return this.dryRunNow(organizationId);
  }

  /** @inheritdoc */
  async dryRunNow(organizationId: string): Promise<boolean> {
    const { dryRun } = dryRunPolicyResource(await this.store.effective(organizationId));

    this.cache.set(organizationId, { dryRun, at: this.now() });

    return dryRun;
  }

  /**
   * The read API's answer.
   *
   * @param organizationId - The workspace.
   * @returns The policy, read from the database now.
   */
  async read(organizationId: string): Promise<DryRunPolicyResource> {
    const resource = dryRunPolicyResource(await this.store.effective(organizationId));

    this.cache.set(organizationId, { dryRun: resource.dryRun, at: this.now() });

    return resource;
  }

  /**
   * Onboarding completion's default: dry-run on when the workspace never answered. An explicit
   * `false` is left alone.
   *
   * @param organizationId - The workspace.
   * @returns `true` when the default was written.
   */
  async adoptDefault(organizationId: string): Promise<boolean> {
    const written = await this.store.adoptDefault(organizationId);

    this.cache.delete(organizationId);

    return written;
  }

  /**
   * Flip the policy, for a person the route already held to owner/admin. Audited on every
   * persisted write, with the value it replaced.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who — `user.id`.
   * @param dryRun - The new value.
   * @returns The policy as it now stands.
   * @throws Whatever the write or the audit threw — an unaudited flip is not answered as a success.
   */
  async setDryRun(
    organizationId: string,
    actorId: string,
    dryRun: boolean,
  ): Promise<DryRunPolicyResource> {
    const flip = await this.store.setDryRun(organizationId, dryRun, actorId);

    this.cache.delete(organizationId);

    await this.audit.record({
      organizationId,
      actorId,
      action: POLICY_DRY_RUN_CHANGED_EVENT,
      subjectType: "org_policy",
      subjectId: organizationId,
      at: flip.row.updated_at,
      detail: {
        dry_run: dryRun,
        previous: flip.previous,
        previous_explicit: flip.previousExplicit,
      },
    });

    return dryRunPolicyResource({
      organization_id: organizationId,
      dry_run: dryRun,
      is_explicit: true,
      updated_at: flip.row.updated_at,
      updated_by: flip.row.updated_by,
    });
  }
}
