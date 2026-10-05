/**
 * `MergeExecutorService` — the armed auto-merge, the direct merge, and everything a merge does
 * after it lands.
 *
 * AX.4 ([#360](https://github.com/NobuData/ouroboros/issues/360)), decisions **V3** and **V9**.
 *
 * ```
 * arm(pr, revision it looked at) ─ role / policy ─▶ plan armed · PR armed ─▶ fire if already green
 * gate engine evaluated pr ─▶ gateEvaluated ─▶ plan armed? ─▶ run(armed)
 * merge(pr)            ─ role / policy ─────────────────────────────────▶ run(direct)
 *
 * run — ONE transaction, the PR row locked (the gate engine's own lock, merge.repository.ts):
 *   recheckVerification  armed revision still the head? no gate red? all satisfied?   (database)
 *   host.get ─▶ recheckHost   open? same head? no conflict?                           (host)
 *     refused ─▶ an armed plan disarms with disarm_reason (the pending wait excepted) — never a merge
 *   host.merge  (strategy · message · delete branch)
 *     refused ─▶ disarm host_refused — a conflict or branch protection is not retried blindly
 *   post-merge: ticket closure verified · evidence comment (edited, not re-posted) · epic note ·
 *               run → merged (the dashboard's outcome) · merged_result {sha, identity_used, actions}
 * after commit: host.sync mirrors the merge — the PR's state becomes merged
 * ```
 *
 * **No path merges without a passing re-check.** `host.merge` is called in exactly one place, after
 * both halves of `recheck` answered `ok` inside the transaction that holds the PR row — so nothing
 * the gate engine does can land between the check and the merge.
 *
 * **Event-driven, never blocking the engine.** {@link MergeExecutorService.gateEvaluated} only
 * schedules; runs for one PR are chained, so two evaluations of one PR re-check one after the
 * other, and the row lock serialises them against every other process too.
 *
 * **Who may.** Arming and merging are `owner`/`admin`, or a `member` when the PR's pinned workflow
 * ends in an auto-merge terminal (`PinnedPolicy.autoMerges`) — *"a policy-eligible member per the
 * pinned config"*. Disarming is the safe direction and any contributor's. Every arm, disarm and
 * merge is audited by V058's trigger with its actor — the merge's, since V064, the person it was
 * made for.
 *
 * **Editing the plan** ({@link MergeExecutorService.edit}, AY.7, #369) is whoever may arm's, and
 * only while the plan is neither armed nor merged: arming confirmed the plan's terms, so they are
 * changed by disarming first. `merge.edit.ts` says what an edit changes.
 *
 * **The dry-run policy** (BA.3, #382, decision O3) sits below all of it. While it is active an arm
 * or a direct merge is refused with the designed `409 dry_run_policy_active`, and every run
 * re-reads the policy **uncached** before anything else — so a plan armed before dry-run turned on
 * is disarmed with `dry_run_policy_active` rather than merged. The pinned workflow's auto-merge
 * terminal is overridden at evaluation (`plan.dryRun.autoMerge`), never rewritten, so turning
 * dry-run off restores it exactly.
 *
 * **The org policy document** (BQ.2, #481) amends both, read through `PolicyResolutionService`
 * with one version per decision:
 *
 * - **`auto_merge`** is a precondition on eligibility, evaluated against the PR's own ticket. A
 *   member may arm or merge only a PR whose pinned workflow auto-merges **and** which the rule lets
 *   merge unattended (*effort ≤ M · non-refactor*); and an armed plan is re-checked at execution,
 *   so a `refactor` label added after a member armed it refuses the merge with
 *   `auto_merge_policy_ineligible` — the rule and its version in the reason. An owner or admin who
 *   armed it decided for themselves. A workspace that has published nothing is as before.
 * - **`dry_run_new_repos`** makes dry-run a per-PR question: the PR's repository's first N loops
 *   are in dry-run, and the org-wide switch stays the stricter override. The refusal names which.
 */

import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import type { OrganizationRole, PrMergeAction, PrMergedResult } from "../../db/schema";
import { DomainError } from "../../errors/error.envelope";
import {
  CHECK_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  isDatabaseFailure,
} from "../../tenancy/constraints";
import { OrgPolicyService, type DryRunPolicyReader } from "../../policies/org-policy.service";
import { dryRunStateOf } from "../../policies/org-policy.rules";
import {
  type AutoMergeValue,
  type EffectiveDryRun,
  type PolicyVerdict,
  effectiveDryRun,
} from "../../policies/policy-resolution";
import {
  PolicyResolutionService,
  type PolicySnapshotSource,
  snapshotOf,
} from "../../policies/policy-resolution.service";
import { TicketSourceError, statusReasonFor } from "../../ticket-sources/ticket-source.errors";
import type { MergePrResult, PullRequestSnapshot } from "../../ticket-sources/ticket-source.pr";
import { pullRequestNotFound } from "../criteria/criteria.errors";
import type { CriteriaMatrixResource } from "../criteria/criteria.resources";
import { CriteriaService } from "../criteria/criteria.service";
import {
  GateListeners,
  type GateEvaluated,
  type GateEvaluationListener,
} from "../gates/gate.listeners";
import { PrSyncService } from "../pr-sync.service";
import {
  actionsExecuted,
  epicNoteBody,
  ticketClosure,
  type ActionOutcomes,
  type TicketClosure,
} from "./merge.actions";
import {
  changedFields,
  changesNothing,
  editedFields,
  fieldsOf,
  needsEpic,
  type MergePlanEdit,
} from "./merge.edit";
import {
  type DryRunStanding,
  autoMergeIneligibleMessage,
  dryRunRefusalMessage,
  mergeDryRunActive,
  mergeNotPolicyEligible,
  mergePlanArmed,
  mergePlanEpicNotFound,
  mergePlanEpicRequired,
  mergePlanMerged,
  mergePlanNotArmable,
  mergePlanPullRequestNotOpen,
  mergeRecheckFailed,
  mergeRevisionStale,
} from "./merge.errors";
import { EVIDENCE_COMMENT_KEY, evidenceSummaryBody } from "./merge.evidence";
import { identityUsed } from "./merge.identity";
import {
  formatDisarmReason,
  recheckHost,
  recheckVerification,
  refusal,
  type MergeRefusal,
} from "./merge.recheck";
import {
  MergeRepository,
  type LockedPr,
  type MergePr,
  type MergeStore,
  type MergeTransaction,
  type StoredMergePlan,
} from "./merge.repository";
import {
  mergePlanResource,
  type FailedActionResource,
  type MergeOutcomeResource,
  type MergePlanResource,
} from "./merge.resources";

/** The host, as the executor reaches it — `PrSyncService`'s members. */
export type MergeHost = Pick<PrSyncService, "get" | "merge" | "comment" | "sync">;

/** The criteria matrix, as the evidence summary reads it — `CriteriaService.matrix`. */
export interface MergeCriteria {
  /**
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @returns The matrix.
   */
  matrix(organizationId: string, prId: string): Promise<CriteriaMatrixResource>;
}

/** Who is acting — the signed-in person and their roles in the workspace. */
export interface MergeActor {
  /** `user.id`. */
  readonly id: string;
  /** Their roles. */
  readonly roles: readonly OrganizationRole[];
}

/** What fired a run. */
export type MergeTrigger =
  /** The gate engine, or an arm: merge only a plan that is armed. */
  | { readonly kind: "armed" }
  /** A person's direct merge call. */
  | { readonly kind: "direct"; readonly actorId: string };

/** What one run did. */
export type MergeRun =
  | { readonly kind: "not_found" }
  | { readonly kind: "already_merged"; readonly plan: StoredMergePlan }
  /** An armed run for a plan that is not armed — nothing to do. */
  | { readonly kind: "idle" }
  | {
      readonly kind: "refused";
      readonly refusal: MergeRefusal;
      /** Whether an armed plan was disarmed. */
      readonly disarmed: boolean;
      readonly plan: StoredMergePlan;
    }
  | {
      readonly kind: "merged";
      readonly plan: StoredMergePlan;
      readonly ticket: TicketClosure | null;
      readonly failedActions: readonly FailedActionResource[];
    };

/** V058's CHECK that back-annotate names an epic. */
const BACK_ANNOTATE_HAS_EPIC = "pr_merge_plans_back_annotate_has_epic";

/** V058's trigger that keeps a merged plan final. */
const MERGED_FINAL = "pr_merge_plans_merged_final";

/**
 * What refuses a plan's epic in V058: the column's foreign key, for an epic that went between the
 * read and the write, and the before-write trigger that holds it to the PR's workspace.
 */
const EPIC_CONSTRAINTS: ReadonlySet<string> = new Set([
  "pr_merge_plans_epic_id_fkey",
  "pr_merge_plans_epic_in_organization",
]);

/** The roles that may always arm and merge. */
const ADMINISTRATIVE: ReadonlySet<OrganizationRole> = new Set(["owner", "admin"]);

/**
 * Whether a person may arm or merge a PR — `owner`/`admin` always, a `member` when the PR's pinned
 * workflow auto-merges.
 *
 * @param roles - Their roles.
 * @param autoMerges - Whether the PR's pinned workflow ends in an auto-merge terminal.
 * @returns `true` when they may.
 */
export function mayMerge(roles: readonly OrganizationRole[], autoMerges: boolean): boolean {
  return roles.some((role) => ADMINISTRATIVE.has(role)) || (autoMerges && roles.includes("member"));
}

@Injectable()
export class MergeExecutorService implements GateEvaluationListener, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MergeExecutorService.name);

  /** The latest scheduled run of each PR — later ones chain onto it. */
  private readonly queued = new Map<string, Promise<void>>();

  /** Unregisters this listener. */
  private unsubscribe: (() => void) | undefined;

  /**
   * @param store - The executor's statements.
   * @param host - The PR sync service — the only way to the host.
   * @param criteria - The criteria matrix, for the evidence summary.
   * @param listeners - Where the gate engine announces each evaluation.
   * @param policy - The workspace's dry-run policy (BA.3, #382).
   * @param resolver - The org policy document (BQ.2, #481). Absent in the suites that predate it,
   *   which then decide as a workspace that has published nothing.
   */
  constructor(
    @Inject(MergeRepository) private readonly store: MergeStore,
    @Inject(PrSyncService) private readonly host: MergeHost,
    @Inject(CriteriaService) private readonly criteria: MergeCriteria,
    private readonly listeners: GateListeners,
    @Inject(OrgPolicyService) private readonly policy: DryRunPolicyReader,
    @Optional() @Inject(PolicyResolutionService) private readonly resolver?: PolicySnapshotSource,
  ) {}

  /** Listen to the gate engine. */
  onModuleInit(): void {
    this.unsubscribe = this.listeners.add(this);
  }

  /** Stop listening. */
  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  /** @inheritdoc */
  gateEvaluated(evaluated: GateEvaluated): void {
    this.schedule(evaluated.organizationId, evaluated.prId);
  }

  /**
   * Re-check an armed plan soon — after any run of the same PR already scheduled.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   */
  schedule(organizationId: string, prId: string): void {
    const previous = this.queued.get(prId) ?? Promise.resolve();
    const next = previous
      .then(async () => {
        const plan = await this.store.plan(prId);

        // The cheap question first: most evaluations are of PRs nobody armed.
        if (plan?.armed === true) {
          await this.run(organizationId, prId, { kind: "armed" });
        }
      })
      .catch((error: unknown) => {
        this.logger.error(`The armed merge of pr ${prId} failed.`, describe(error));
      })
      .finally(() => {
        if (this.queued.get(prId) === next) {
          this.queued.delete(prId);
        }
      });

    this.queued.set(prId, next);
  }

  /**
   * Wait for every scheduled run — for the suites, and for a graceful shutdown.
   *
   * @returns When nothing is queued.
   */
  async settled(): Promise<void> {
    while (this.queued.size > 0) {
      await Promise.all(this.queued.values());
    }
  }

  /**
   * The PR's merge plan — written with the defaults if it has none.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @returns The plan.
   * @throws {NotFoundError} `pull_request_not_found`.
   */
  async plan(organizationId: string, prId: string): Promise<MergePlanResource> {
    const plan = await this.store.transaction(async (tx) => {
      const locked = await this.lockOrThrow(tx, organizationId, prId);

      return locked.plan ?? tx.materialize(prId);
    });

    return this.resource(organizationId, plan);
  }

  /**
   * Edit the plan — the commit message, a toggle or the epic — for a person. Each field sent
   * persists; a field left out is left alone.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @param actor - Who is editing.
   * @param edit - What to change — see `merge.edit.ts`.
   * @returns The plan. An edit that changes nothing answers it unchanged, and writes nothing.
   * @throws {NotFoundError} `pull_request_not_found`.
   * @throws {ForbiddenError} `merge_not_policy_eligible` for a member whose PR does not auto-merge.
   * @throws {ConflictError} `merge_plan_merged`, `pull_request_not_open` or `merge_plan_armed`.
   * @throws {InvalidRequestError} `merge_plan_epic_required` or `merge_plan_epic_not_found`.
   */
  async edit(
    organizationId: string,
    prId: string,
    actor: MergeActor,
    edit: MergePlanEdit,
  ): Promise<MergePlanResource> {
    await this.assertMayMerge(organizationId, prId, actor);

    const plan = await this.store.transaction(async (tx) => {
      const { pr, plan: stored } = await this.lockOrThrow(tx, organizationId, prId);

      if (stored?.mergedResult != null) {
        throw mergePlanMerged(prId);
      }

      if (pr.state === "merged" || pr.state === "closed") {
        throw mergePlanPullRequestNotOpen(prId, pr.state);
      }

      if (stored?.armed === true) {
        throw mergePlanArmed(prId);
      }

      const current = stored ?? (await tx.materialize(prId));
      const next = editedFields(fieldsOf(current), edit);
      const changes = changedFields(fieldsOf(current), next);

      if (changesNothing(changes)) {
        return current;
      }

      if (needsEpic(next)) {
        throw mergePlanEpicRequired(prId);
      }

      if (
        changes.epicId !== undefined &&
        changes.epicId !== null &&
        !(await tx.hasEpic(organizationId, changes.epicId))
      ) {
        throw mergePlanEpicNotFound(prId, changes.epicId);
      }

      try {
        return await tx.edit(current.id, actor.id, changes);
      } catch (error) {
        // The epic went, or changed hands, between the read and the write — V058 said no.
        throw refusedEdit(prId, next.epicId, error);
      }
    });

    return this.resource(organizationId, plan);
  }

  /**
   * Arm the plan — *merge when all gates go green* — against the revision the person looked at.
   * If its gates are already green, the merge is scheduled at once.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @param actor - Who is arming.
   * @param revisionId - The revision whose gates they looked at.
   * @returns The armed plan. Arming a plan already armed answers it unchanged.
   * @throws {NotFoundError} `pull_request_not_found`.
   * @throws {ForbiddenError} `merge_not_policy_eligible` for a member whose PR does not auto-merge.
   * @throws {ConflictError} `dry_run_policy_active` while the dry-run policy is active, or
   *   `merge_plan_merged`, `merge_revision_stale` or `merge_plan_not_armable`.
   */
  async arm(
    organizationId: string,
    prId: string,
    actor: MergeActor,
    revisionId: string,
  ): Promise<MergePlanResource> {
    await this.assertMayMerge(organizationId, prId, actor);
    await this.assertNotDryRun(organizationId, prId);

    const plan = await this.store.transaction(async (tx) => {
      const { pr, plan: stored, latest } = await this.lockOrThrow(tx, organizationId, prId);

      if (stored?.mergedResult != null) {
        throw mergePlanMerged(prId);
      }

      if (latest?.id !== revisionId) {
        throw mergeRevisionStale(prId, revisionId, latest?.id ?? null);
      }

      if (stored?.armed === true && stored.armedAgainstRevisionId === revisionId) {
        return stored;
      }

      if (pr.state !== "verifying") {
        throw mergePlanNotArmable(prId, pr.state);
      }

      const armed = await tx.arm((stored ?? (await tx.materialize(prId))).id, actor.id, revisionId);

      await tx.setPrState(prId, "armed");

      return armed;
    });

    // Already green: "merge when all gates green" is now.
    this.schedule(organizationId, prId);

    return this.resource(organizationId, plan);
  }

  /**
   * Disarm the plan, for a person — the safe direction, so any contributor may.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @param actor - Who is disarming.
   * @returns The plan. Disarming a plan that is not armed answers it unchanged.
   * @throws {NotFoundError} `pull_request_not_found`.
   * @throws {ConflictError} `merge_plan_merged`.
   */
  async disarm(
    organizationId: string,
    prId: string,
    actor: Pick<MergeActor, "id">,
  ): Promise<MergePlanResource> {
    const plan = await this.store.transaction(async (tx) => {
      const { pr, plan: stored } = await this.lockOrThrow(tx, organizationId, prId);

      if (stored?.mergedResult != null) {
        throw mergePlanMerged(prId);
      }

      if (stored === undefined || !stored.armed) {
        return stored ?? tx.materialize(prId);
      }

      const disarmed = await tx.disarm(stored.id, { actorId: actor.id, reason: null });

      if (pr.state === "armed") {
        await tx.setPrState(prId, "verifying");
      }

      return disarmed;
    });

    return this.resource(organizationId, plan);
  }

  /**
   * Merge now — the direct call, for a PR whose gates are already green. The same re-check and the
   * same actions as an armed merge.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @param actor - Who is merging.
   * @returns The final plan, the ticket's closure and any action that did not run.
   * @throws {NotFoundError} `pull_request_not_found`.
   * @throws {ForbiddenError} `merge_not_policy_eligible`.
   * @throws {ConflictError} `dry_run_policy_active` while the dry-run policy is active,
   *   `merge_plan_merged`, or `merge_recheck_failed` with the reason.
   */
  async merge(
    organizationId: string,
    prId: string,
    actor: MergeActor,
  ): Promise<MergeOutcomeResource> {
    await this.assertMayMerge(organizationId, prId, actor);
    await this.assertNotDryRun(organizationId, prId);

    const outcome = await this.run(organizationId, prId, { kind: "direct", actorId: actor.id });

    switch (outcome.kind) {
      case "not_found":
      case "idle":
        throw pullRequestNotFound(prId);
      case "already_merged":
        throw mergePlanMerged(prId);
      case "refused":
        // The policy turned on between the check above and the run — the same designed refusal.
        if (outcome.refusal.code === "dry_run_policy_active") {
          throw mergeDryRunActive(prId, await this.dryRunStandingFor(organizationId, prId));
        }

        throw mergeRecheckFailed(prId, {
          code: outcome.refusal.code,
          message: outcome.refusal.message,
          disarmed: outcome.disarmed,
        });
      case "merged":
        return {
          plan: await this.resource(organizationId, outcome.plan),
          ticket: outcome.ticket,
          failedActions: outcome.failedActions,
        };
    }
  }

  /**
   * The executor — see this file's header. Public so the suites can drive one run and read what
   * it did; the routes and the listener are its callers.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @param trigger - An armed plan's turn, or a person's direct call.
   * @returns What happened.
   */
  async run(organizationId: string, prId: string, trigger: MergeTrigger): Promise<MergeRun> {
    const outcome = await this.store.transaction(async (tx): Promise<MergeRun> => {
      const locked = await tx.lock(organizationId, prId);

      if (locked === undefined) {
        return { kind: "not_found" };
      }

      if (locked.plan?.mergedResult != null) {
        return { kind: "already_merged", plan: locked.plan };
      }

      if (trigger.kind === "armed" && locked.plan?.armed !== true) {
        return { kind: "idle" };
      }

      const plan = locked.plan ?? (await tx.materialize(prId));

      return this.recheckAndMerge(tx, locked, plan, trigger);
    });

    if (outcome.kind === "merged") {
      await this.mirror(organizationId, prId);
    }

    return outcome;
  }

  /**
   * Both halves of the re-check, then the merge and its actions — inside the run's transaction.
   *
   * @param tx - The transaction, holding the PR row.
   * @param locked - The PR, its latest revision.
   * @param plan - Its plan.
   * @param trigger - What fired the run.
   * @returns What happened.
   */
  private async recheckAndMerge(
    tx: MergeTransaction,
    locked: LockedPr,
    plan: StoredMergePlan,
    trigger: MergeTrigger,
  ): Promise<MergeRun> {
    const { pr, latest } = locked;

    // Dry-run first, read uncached: the policy is re-checked at execution, not only at arming,
    // so a plan armed before it turned on cannot slip through. One version of the org policy
    // document decides both questions (#481).
    const standing = await this.standing(pr, true);

    if (standing.dryRun.active) {
      return this.refuse(
        tx,
        pr,
        plan,
        refusal("dry_run_policy_active", dryRunRefusalMessage(dryRunStandingOf(standing))),
      );
    }

    // An armed plan merges unattended: the published auto_merge rule must still allow it, unless
    // an owner or admin armed it (#481).
    if (
      trigger.kind === "armed" &&
      standing.autoMerge.version !== null &&
      !standing.autoMerge.value.eligible &&
      !(await this.armedByAdministrator(pr.organizationId, plan.armedBy))
    ) {
      return this.refuse(
        tx,
        pr,
        plan,
        refusal(
          "auto_merge_policy_ineligible",
          autoMergeIneligibleMessage(standing.autoMerge.reason),
        ),
      );
    }

    const gates =
      latest === null
        ? { mergeReady: false, red: [], satisfied: 0, required: 0 }
        : await tx.gates(pr.id, latest.id);
    const verified = recheckVerification({
      armedRevisionId: plan.armed ? plan.armedAgainstRevisionId : null,
      latest,
      gates,
    });

    if (!verified.ok) {
      return this.refuse(tx, pr, plan, verified);
    }

    if (latest === null) {
      // Unreachable — the verification half refuses a PR without a revision — but the compiler
      // cannot know that, and a merge without a revision must never be the fallback.
      return this.refuse(tx, pr, plan, refusal("head_moved", "The PR has no recorded revision."));
    }

    let host: PullRequestSnapshot;

    try {
      host = await this.host.get(pr.organizationId, pr.sourceId, pr.number);
    } catch (error) {
      return this.refuse(tx, pr, plan, refusal("host_refused", hostFailure("read", error)));
    }

    const hostVerdict = recheckHost(latest, host);

    if (!hostVerdict.ok) {
      return this.refuse(tx, pr, plan, hostVerdict);
    }

    // The only call to the host's merge: both halves of the re-check passed, and the PR row is
    // still locked, so no gate has moved since.
    let merged: MergePrResult;

    try {
      merged = await this.host.merge(pr.organizationId, pr.sourceId, pr.number, {
        strategy: plan.strategy,
        message: plan.commitMessage,
        deleteBranch: plan.deleteBranch,
      });
    } catch (error) {
      return this.refuse(tx, pr, plan, refusal("host_refused", hostFailure("merge", error)));
    }

    if (merged.alreadyMerged) {
      return this.refuse(
        tx,
        pr,
        plan,
        refusal("host_not_open", "The host had already merged the PR — not by this merge."),
      );
    }

    return this.afterMerge(tx, locked, plan, merged, trigger);
  }

  /**
   * The post-merge actions and the record — see the header of `merge.actions.ts`.
   *
   * @param tx - The transaction.
   * @param locked - The PR and its latest revision (non-null — the re-check passed).
   * @param plan - The plan.
   * @param merged - What the host did.
   * @param trigger - What fired the run — whose name the merge is recorded under.
   * @returns The merged run.
   */
  private async afterMerge(
    tx: MergeTransaction,
    locked: LockedPr,
    plan: StoredMergePlan,
    merged: MergePrResult,
    trigger: MergeTrigger,
  ): Promise<MergeRun> {
    const { pr } = locked;
    const latest = locked.latest as NonNullable<LockedPr["latest"]>;
    const after = await this.host
      .get(pr.organizationId, pr.sourceId, pr.number)
      .catch((error: unknown) => {
        this.logger.warn(`Could not read pr ${pr.id} back after merging.`, describe(error));
        return null;
      });
    // The host names the merge commit; one that did not is recorded at the merged head.
    const sha = (merged.sha ?? latest.headSha).toLowerCase();
    const identity = identityUsed(after?.mergedBy ?? null);
    const ticket = ticketClosure(pr.ticketKey, merged.closures);
    const failed: FailedActionResource[] = [];

    const commented =
      plan.commentEvidence &&
      (await this.publishEvidence(tx, pr, latest, ticket, {
        strategy: plan.strategy,
        sha,
        identity,
      }).catch((error: unknown) => {
        failed.push({ action: "comment_evidence", detail: hostFailure("comment", error) });
        return false;
      }));
    const annotated =
      plan.backAnnotateEpic && plan.epicId !== null
        ? await tx.writeEpicNote(plan.epicId, pr.id, epicNoteBody(pr, pr.ticketKey, sha)).then(
            () => true,
            (error: unknown) => {
              failed.push({ action: "back_annotate_epic", detail: describe(error) });
              return false;
            },
          )
        : false;

    if (pr.runId !== null) {
      await tx.finalizeRun(pr.organizationId, pr.runId, pr.number);
    }

    const outcomes: ActionOutcomes = {
      close_ticket: ticket?.closed ?? false,
      comment_evidence: commented,
      back_annotate_epic: annotated,
      delete_branch: merged.branchDeleted,
    };

    failed.push(...unmet(plan, outcomes, ticket, failed));

    const result: PrMergedResult = {
      sha,
      identity_used: identity,
      actions_executed: actionsExecuted(
        {
          close_ticket: plan.closeTicket,
          comment_evidence: plan.commentEvidence,
          back_annotate_epic: plan.backAnnotateEpic,
          delete_branch: plan.deleteBranch,
        },
        outcomes,
      ),
      merged_at: (after?.mergedAt ?? new Date()).toISOString(),
    };
    const actorId = trigger.kind === "direct" ? trigger.actorId : plan.armedBy;
    const final = await tx.recordMerge(plan.id, result, actorId);

    for (const failure of failed) {
      this.logger.warn(`pr ${pr.id} merged, but ${failure.action} did not run: ${failure.detail}`);
    }

    return { kind: "merged", plan: final, ticket, failedActions: failed };
  }

  /**
   * Publish the evidence summary, edited under its one key.
   *
   * @param tx - The transaction, for the gate table and the spend.
   * @param pr - The PR.
   * @param latest - The revision merged.
   * @param ticket - The ticket's closure.
   * @param merge - How it merged.
   * @returns `true` once the host holds the comment.
   * @throws Whatever the host or a read threw — the caller records it as a failed action.
   */
  private async publishEvidence(
    tx: MergeTransaction,
    pr: MergePr,
    latest: NonNullable<LockedPr["latest"]>,
    ticket: TicketClosure | null,
    merge: { readonly strategy: string; readonly sha: string; readonly identity: string },
  ): Promise<boolean> {
    const [gates, matrix, spend] = await Promise.all([
      tx.summaryGates(pr.id, latest.id),
      this.criteria.matrix(pr.organizationId, pr.id),
      pr.runId === null ? Promise.resolve(null) : tx.spend(pr.runId),
    ]);

    await this.host.comment(pr.organizationId, pr.sourceId, pr.number, {
      key: EVIDENCE_COMMENT_KEY,
      body: evidenceSummaryBody({
        revision: { seq: latest.seq, headSha: latest.headSha },
        gates,
        criteria: matrix.criteria.map((criterion) => ({
          claim: criterion.claim,
          status: criterion.status,
          waiverReason: criterion.waiver?.reason ?? null,
        })),
        spend,
        ticket,
        merge,
      }),
    });

    return true;
  }

  /**
   * Refuse a merge: an armed plan is disarmed with the reason unless the refusal is the pending
   * wait, and an armed PR goes back to `verifying`.
   *
   * @param tx - The transaction.
   * @param pr - The PR.
   * @param plan - Its plan.
   * @param refused - Why.
   * @returns The refused run.
   */
  private async refuse(
    tx: MergeTransaction,
    pr: MergePr,
    plan: StoredMergePlan,
    refused: MergeRefusal,
  ): Promise<MergeRun> {
    if (!plan.armed || !refused.disarms) {
      return { kind: "refused", refusal: refused, disarmed: false, plan };
    }

    const disarmed = await tx.disarm(plan.id, {
      actorId: null,
      reason: formatDisarmReason(refused),
    });

    if (pr.state === "armed") {
      await tx.setPrState(pr.id, "verifying");
    }

    this.logger.log(`Disarmed pr ${pr.id}: ${refused.code}.`);

    return { kind: "refused", refusal: refused, disarmed: true, plan: disarmed };
  }

  /**
   * Mirror a merge that has committed — the PR's state becomes `merged` from the host's report. A
   * failure is logged: the next sync brings the mirror in line.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   */
  private async mirror(organizationId: string, prId: string): Promise<void> {
    try {
      const pr = await this.store.pr(organizationId, prId);

      if (pr !== undefined) {
        await this.host.sync(organizationId, pr.sourceId, pr.number);
      }
    } catch (error) {
      this.logger.warn(`Could not mirror the merge of pr ${prId}.`, describe(error));
    }
  }

  /**
   * Lock a PR of the workspace, or answer its `404`.
   *
   * @param tx - The transaction.
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @returns The locked PR.
   */
  private async lockOrThrow(
    tx: MergeTransaction,
    organizationId: string,
    prId: string,
  ): Promise<LockedPr> {
    const locked = await tx.lock(organizationId, prId);

    if (locked === undefined) {
      throw pullRequestNotFound(prId);
    }

    return locked;
  }

  /**
   * A plan as the routes answer it, naming who armed it and carrying the dry-run state.
   *
   * @param organizationId - The workspace.
   * @param plan - The plan.
   * @returns The resource — `armedByPerson` null for a plan nobody armed, or whose person is gone;
   *   `dryRun.autoMerge.requested` read from the PR's pinned workflow, which is never written.
   */
  private async resource(
    organizationId: string,
    plan: StoredMergePlan,
  ): Promise<MergePlanResource> {
    const [armedBy, pr] = await Promise.all([
      plan.armedBy === null ? undefined : this.store.person(plan.armedBy),
      this.store.pr(organizationId, plan.prId),
    ]);

    if (pr === undefined) {
      return mergePlanResource(
        plan,
        armedBy ?? null,
        dryRunStateOf(await this.policy.dryRun(organizationId), false),
      );
    }

    const standing = await this.standing(pr, false);

    return mergePlanResource(
      plan,
      armedBy ?? null,
      dryRunStateOf(standing.dryRun.active, standing.workflowAutoMerges, {
        source: standing.dryRun.source,
        version: standing.dryRun.version,
        autoMergeEligible: standing.autoMerge.value.eligible,
      }),
      {
        eligible: standing.autoMerge.value.eligible,
        ruleId: "auto_merge",
        version: standing.autoMerge.version,
        reason: standing.autoMerge.reason,
      },
    );
  }

  /**
   * What the org policy says about one PR, read for one decision (#481): its dry-run — the
   * org-wide switch, then the document's per-repository rule — and its `auto_merge` eligibility,
   * both from one version of the document.
   *
   * @param pr - The PR.
   * @param fresh - Read uncached — for a write or an execution.
   * @returns The standing.
   */
  private async standing(pr: MergePr, fresh: boolean): Promise<PrPolicyStanding> {
    const [snapshot, facts, override, workflowAutoMerges] = await Promise.all([
      this.resolver === undefined
        ? Promise.resolve(snapshotOf(null))
        : this.resolver.snapshot(pr.organizationId, fresh),
      this.store.policyFacts(pr),
      fresh ? this.policy.dryRunNow(pr.organizationId) : this.policy.dryRun(pr.organizationId),
      this.store.autoMerges(pr),
    ]);

    return {
      dryRun: effectiveDryRun(
        override,
        snapshot.resolve("dry_run_new_repos", { loop: facts.loop }),
      ),
      dryRunReason: snapshot.resolve("dry_run_new_repos", { loop: facts.loop }).reason,
      autoMerge: snapshot.resolve("auto_merge", { ticket: facts.ticket }),
      workflowAutoMerges,
    };
  }

  /**
   * Why a PR is in dry-run, as the refusal names it — read uncached.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @returns The standing, or undefined when the PR is gone or not in dry-run.
   */
  private async dryRunStandingFor(
    organizationId: string,
    prId: string,
  ): Promise<DryRunStanding | undefined> {
    const pr = await this.store.pr(organizationId, prId);

    if (pr === undefined) {
      return undefined;
    }

    const standing = await this.standing(pr, true);

    return standing.dryRun.active ? dryRunStandingOf(standing) : undefined;
  }

  /**
   * Whether the person who armed a plan is an owner or admin of the workspace now.
   *
   * @param organizationId - The workspace.
   * @param armedBy - `user.id`, or null.
   * @returns True for an administrator.
   */
  private async armedByAdministrator(
    organizationId: string,
    armedBy: string | null,
  ): Promise<boolean> {
    return armedBy !== null && mayMerge(await this.store.roles(organizationId, armedBy), false);
  }

  /**
   * Refuse an arm or a direct merge while the PR is in dry-run — the org-wide switch or its
   * repository's first loops — read uncached, since this is a write.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @throws {ConflictError} `dry_run_policy_active`, naming which.
   */
  private async assertNotDryRun(organizationId: string, prId: string): Promise<void> {
    const standing = await this.dryRunStandingFor(organizationId, prId);

    if (standing !== undefined) {
      throw mergeDryRunActive(prId, standing);
    }
  }

  /**
   * Refuse a person who may not arm, merge or edit the plan of this PR.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @param actor - Who is asking.
   * @throws {NotFoundError} `pull_request_not_found`.
   * @throws {ForbiddenError} `merge_not_policy_eligible`.
   */
  private async assertMayMerge(
    organizationId: string,
    prId: string,
    actor: MergeActor,
  ): Promise<void> {
    const pr = await this.store.pr(organizationId, prId);

    if (pr === undefined) {
      throw pullRequestNotFound(prId);
    }

    // An administrator needs no policy read.
    if (mayMerge(actor.roles, false)) {
      return;
    }

    const standing = await this.standing(pr, true);

    if (!mayMerge(actor.roles, standing.workflowAutoMerges && standing.autoMerge.value.eligible)) {
      // The workflow allows it and the published rule does not: say which rule, and which version.
      throw standing.workflowAutoMerges
        ? mergeNotPolicyEligible(prId, {
            reason: standing.autoMerge.reason,
            version: standing.autoMerge.version,
          })
        : mergeNotPolicyEligible(prId);
    }
  }
}

/**
 * What a refused edit's write is answered with.
 *
 * @param prId - The PR.
 * @param epicId - The epic the edited plan names, or null.
 * @param error - What the write threw.
 * @returns `422 merge_plan_epic_required` when V058 found back-annotate on with no epic, `409
 *   merge_plan_merged` when it found the plan final, `422 merge_plan_epic_not_found` when it
 *   refused the plan's epic — its foreign key, or the trigger that holds it to the PR's workspace
 *   — and the error itself for anything else. Read by the constraint's name, never the SQLSTATE
 *   alone: four constraints of this table raise the same one.
 */
export function refusedEdit(prId: string, epicId: string | null, error: unknown): unknown {
  if (!isDatabaseFailure(error)) {
    return error;
  }

  if (error.code === CHECK_VIOLATION && error.constraint === BACK_ANNOTATE_HAS_EPIC) {
    return mergePlanEpicRequired(prId);
  }

  if (error.code === CHECK_VIOLATION && error.constraint === MERGED_FINAL) {
    return mergePlanMerged(prId);
  }

  if (
    (error.code === FOREIGN_KEY_VIOLATION || error.code === CHECK_VIOLATION) &&
    error.constraint !== undefined &&
    EPIC_CONSTRAINTS.has(error.constraint)
  ) {
    return mergePlanEpicNotFound(prId, epicId);
  }

  return error;
}

/**
 * The switched-on actions that did not run and have no failure recorded yet — a ticket the host
 * left open, a branch it kept, an epic that went.
 *
 * @param plan - The plan's switches.
 * @param outcomes - What ran.
 * @param ticket - The ticket's closure.
 * @param recorded - Failures already recorded.
 * @returns The rest, each with its reason.
 */
function unmet(
  plan: StoredMergePlan,
  outcomes: ActionOutcomes,
  ticket: TicketClosure | null,
  recorded: readonly FailedActionResource[],
): FailedActionResource[] {
  const switches: Record<PrMergeAction, boolean> = {
    close_ticket: plan.closeTicket && ticket !== null,
    comment_evidence: plan.commentEvidence,
    back_annotate_epic: plan.backAnnotateEpic,
    delete_branch: plan.deleteBranch,
  };
  const reasons: Record<PrMergeAction, string> = {
    close_ticket: ticket?.detail ?? "the ticket is still open",
    comment_evidence: "the evidence summary was not published",
    back_annotate_epic: "the plan's epic no longer exists",
    delete_branch: "the host did not delete the branch",
  };

  return (Object.keys(switches) as PrMergeAction[])
    .filter(
      (action) =>
        switches[action] &&
        !outcomes[action] &&
        !recorded.some((failure) => failure.action === action),
    )
    .map((action) => ({ action, detail: reasons[action] }));
}

/**
 * A host failure, in words fit for the merge card — never the provider's detail.
 *
 * @param step - What was being asked.
 * @param error - What was thrown.
 * @returns The sentence.
 */
export function hostFailure(step: "read" | "merge" | "comment", error: unknown): string {
  if (TicketSourceError.is(error)) {
    if (step === "merge" && error.errorClass === "validation") {
      return "The host refused the merge — branch protection, a required check or a conflict.";
    }

    return `The host could not ${step === "read" ? "be read" : step}: ${statusReasonFor(error)}.`;
  }

  if (error instanceof DomainError) {
    return error.envelope().message;
  }

  return `The host could not ${step === "read" ? "be read" : step}.`;
}

/**
 * An error, for a log line — its message, never its payload.
 *
 * @param error - What was thrown.
 * @returns The message.
 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What the org policy says about one PR, for one decision (#481). */
interface PrPolicyStanding {
  /** Whether it is in dry-run, and which said so. */
  readonly dryRun: EffectiveDryRun;
  /** `dry_run_new_repos`' sentence — what a refusal quotes when the rule is the cause. */
  readonly dryRunReason: string;
  /** The `auto_merge` rule's verdict. */
  readonly autoMerge: PolicyVerdict<AutoMergeValue>;
  /** Whether the pinned workflow's terminal asks for auto-merge. */
  readonly workflowAutoMerges: boolean;
}

/**
 * A dry-run refusal's standing.
 *
 * @param standing - The PR's standing, in dry-run.
 * @returns What the refusal names.
 */
function dryRunStandingOf(standing: PrPolicyStanding): DryRunStanding {
  return standing.dryRun.source === "dry_run_new_repos"
    ? {
        source: "dry_run_new_repos",
        version: standing.dryRun.version,
        reason: standing.dryRunReason,
      }
    : { source: "org_override", version: null };
}
