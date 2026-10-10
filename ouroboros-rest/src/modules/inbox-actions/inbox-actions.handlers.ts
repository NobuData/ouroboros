/**
 * The handler bindings — one thin adapter per declared action, each onto the plane that owns the
 * operation (BN.2, [#462](https://github.com/NobuData/ouroboros/issues/462), decision **X3**).
 *
 * **The inbox executes nothing itself.** Every handler calls a plane service — the same method that
 * plane's own route calls — and returns a structured receipt (merge SHA, exception id, control id,
 * draft batch id) that becomes the resolution's `outcome`. A handler that throws leaves the item
 * open; the executor records the failure.
 *
 * ```
 * pr.approve_and_merge         AX.5 decide(approve) → AX.4 arm the existing plan → run it once
 * pr.waive_criterion           AX.3 waive → the public host annotation
 * guardrail.allow_once         grant (V096) → AP.3 reevaluatePaths (consumes it) → AP.4 resume
 * run.deny_protected_path      AP.4 correction round carrying the reason (the path stays protected)
 * run.return_with_note         AP.4 correction round with the note
 * run.retry_with_note          AP.4 correction round with the note
 * run.cancel                   AP.4 abort, confirmed with the loop's own number
 * planning.push_batch          AL.3 push
 * planning.require_bench_upgrade  AL.4 compose a one-draft bench-gap batch (planner bench-v1)
 * facts.confirm / facts.retire BF facts: confirm|reconfirm, reject|expire
 * research.dismiss_watch_item  CM.4 dismiss the regression watch item, with the note as its reason
 * ```
 *
 * Declared bindings with no plane operation yet — `workflow.sign_off_plan` (the DSL has no human
 * gate), `planning.abandon_batch`, `estimation.accept_resize` / `keep_size` (BP.4) and
 * `spend.approve_overage` (dormant) — answer `501 decision_action_unbound`, by #462's choice.
 */

import { Injectable } from "@nestjs/common";

import { CONTROL_ROLES, mayRequest } from "../controls/controls.policy";
import { ControlsService, type Requester } from "../controls/controls.service";
import type { DecisionRef } from "../decisions/decision.types";
import { FactsService } from "../facts/facts.service";
import { GuardrailService } from "../guardrails/guardrails.service";
import { BatchesService } from "../planning/batches.service";
import { CriteriaService } from "../pull-requests/criteria/criteria.service";
import { MergeExecutorService } from "../pull-requests/merge/merge.executor";
import { PageActionsService } from "../pull-requests/page/page.actions";
import { watchItemOf } from "../research/watch/watch.inbox";
import { RegressionWatchService } from "../research/watch/watch.service";
import { forbidden } from "../tenancy/tenancy.errors";
import {
  allowOnceStillBlocked,
  benchUpgradeTargetMissing,
  decisionActionUnbound,
  decisionItemRefMissing,
  mergeRefused,
} from "./inbox-actions.errors";
import { InboxActionsRepository, type ActionItem } from "./inbox-actions.repository";

/** A receipt: flat, JSON-safe facts about what the plane did. */
export type ActionOutcome = Readonly<Record<string, string | number | boolean | null>>;

/** Everything a handler is given. */
export interface ActionContext {
  readonly organizationId: string;
  readonly item: ActionItem;
  readonly actionId: string;
  /** The person pressing — the plane's own requester shape. */
  readonly actor: Requester;
  /** The note, when the action takes one. */
  readonly note: string | null;
  /** The attempt's id — handed to a plane's own idempotency key where it has one. */
  readonly attemptId: string;
}

/** One adapter. */
type ActionHandler = (context: ActionContext) => Promise<ActionOutcome>;

/** The planner name a bench-gap draft batch is filed under. */
export const BENCH_UPGRADE_PLANNER = "bench-v1";

/**
 * The item's first ref of a type.
 *
 * @param item - The item.
 * @param type - The ref type.
 * @returns The ref's id.
 * @throws {ConflictError} `decision_item_ref_missing` when the item names none.
 */
export function refOf(item: ActionItem, type: DecisionRef["type"]): string {
  const refs = Array.isArray(item.refs) ? (item.refs as DecisionRef[]) : [];
  const ref = refs.find((candidate) => candidate.type === type);

  if (ref === undefined) {
    throw decisionItemRefMissing(item.id, `${type} ref`);
  }

  return ref.id;
}

/**
 * A segment of the item's `source_ref` — `batch:<id>`, `fact:<id>:proposed`,
 * `pr:<pr>:criterion:<criterion>` — by the label before it.
 *
 * @param item - The item.
 * @param label - The label (`batch`, `fact`, `criterion`).
 * @returns The segment after the label.
 * @throws {ConflictError} `decision_item_ref_missing` when the source ref has no such segment.
 */
export function sourceSegment(item: ActionItem, label: string): string {
  const parts = item.sourceRef.split(":");
  const index = parts.indexOf(label);

  if (index < 0 || index + 1 >= parts.length || parts[index + 1] === "") {
    throw decisionItemRefMissing(item.id, `${label} in its source reference`);
  }

  return parts[index + 1];
}

/**
 * The reason a denied allow-once carries to the run — the run learns *why*, not just *no*.
 *
 * @param path - The protected path.
 * @returns The steering text.
 */
export function denyReason(path: string): string {
  return `A person denied the one-time edit to ${path}: it stays protected. Make the change without editing that file.`;
}

/**
 * A text fact of the item's payload — the kind's schema already made it a string when it was filed.
 *
 * @param value - The payload value.
 * @returns The string, or `""` for anything else.
 */
function factText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

@Injectable()
export class InboxActionHandlers {
  /** The bound adapters, by `handler_binding`. */
  private readonly bindings: ReadonlyMap<string, ActionHandler>;

  /**
   * @param repository - The executor's statements, for the plane reads no service hands out.
   * @param pages - AX.5's approval.
   * @param merges - AX.4's executor.
   * @param criteria - AX.3's waiver.
   * @param guardrails - AP.3's evaluation.
   * @param controls - AP.4's control queue.
   * @param batches - AL.3/AL.4's batches.
   * @param facts - The knowledge plane's facts.
   * @param watch - CM.4's regression watch.
   */
  constructor(
    private readonly repository: InboxActionsRepository,
    private readonly pages: PageActionsService,
    private readonly merges: MergeExecutorService,
    private readonly criteria: CriteriaService,
    private readonly guardrails: GuardrailService,
    private readonly controls: ControlsService,
    private readonly batches: BatchesService,
    private readonly facts: FactsService,
    private readonly watch: RegressionWatchService,
  ) {
    this.bindings = new Map<string, ActionHandler>([
      ["pr.approve_and_merge", (context) => this.approveAndMerge(context)],
      ["pr.waive_criterion", (context) => this.waiveCriterion(context)],
      ["guardrail.allow_once", (context) => this.allowOnce(context)],
      ["run.deny_protected_path", (context) => this.denyProtectedPath(context)],
      ["run.return_with_note", (context) => this.correctionRound(context)],
      ["run.retry_with_note", (context) => this.correctionRound(context)],
      ["run.cancel", (context) => this.cancelRun(context)],
      ["planning.push_batch", (context) => this.pushBatch(context)],
      ["planning.require_bench_upgrade", (context) => this.requireBenchUpgrade(context)],
      ["facts.confirm", (context) => this.confirmFact(context)],
      ["facts.retire", (context) => this.retireFact(context)],
      ["research.dismiss_watch_item", (context) => this.dismissWatchItem(context)],
    ]);
  }

  /**
   * Whether a binding has an adapter.
   *
   * @param binding - The action's `handler_binding`.
   * @returns `true` when the inbox can execute it.
   */
  isBound(binding: string): boolean {
    return this.bindings.has(binding);
  }

  /**
   * Execute one action through its plane.
   *
   * @param binding - The action's `handler_binding`.
   * @param context - The item, the person and the note.
   * @returns The receipt.
   * @throws {NotImplementedError} `decision_action_unbound` for a binding with no adapter; any
   *   plane's own refusal otherwise.
   */
  async execute(binding: string, context: ActionContext): Promise<ActionOutcome> {
    const handler = this.bindings.get(binding);

    if (handler === undefined) {
      throw decisionActionUnbound(context.actionId, binding);
    }

    return handler(context);
  }

  /**
   * **Approve & merge** — AX.5 records the approval (the gate flips), AX.4 arms the PR's existing
   * merge plan against its latest revision, and the executor is asked to run it once now. Never a
   * second merge path: when the gates are not green yet the plan stays armed and AX.4 merges when
   * they are.
   *
   * @param context - The item and the person.
   * @returns `{approval_id, merge: "merged" | "armed", merge_sha}`.
   */
  private async approveAndMerge(context: ActionContext): Promise<ActionOutcome> {
    const prId = refOf(context.item, "pr");
    const review = await this.pages.decide(context.organizationId, prId, context.actor, {
      decision: "approve",
    });
    const pr = await this.repository.pullRequest(context.organizationId, prId);

    if (pr?.latestRevisionId == null) {
      throw decisionItemRefMissing(context.item.id, "PR revision to merge");
    }

    const actor = { id: context.actor.id, roles: context.actor.roles };
    await this.merges.arm(context.organizationId, prId, actor, pr.latestRevisionId);
    const run = await this.merges.run(context.organizationId, prId, { kind: "armed" });

    if (run.kind === "refused" && run.disarmed) {
      throw mergeRefused(prId, run.refusal.code, run.refusal.message);
    }

    const merged = run.kind === "merged" || run.kind === "already_merged";

    return {
      approval_id: review.review.id,
      pr_id: prId,
      merge: merged ? "merged" : "armed",
      merge_sha: merged ? (run.plan.mergedResult?.sha ?? null) : null,
    };
  }

  /**
   * **Waive & annotate** — AX.3 writes the waiver with the note as its reason and posts the public
   * host annotation the card warns about. A host that refused the comment is AX.3's to record; the
   * receipt says which.
   *
   * @param context - The item, the person and the reason.
   * @returns `{criterion_id, waived: true, annotation}`.
   */
  private async waiveCriterion(context: ActionContext): Promise<ActionOutcome> {
    const prId = refOf(context.item, "pr");
    const criterionId = sourceSegment(context.item, "criterion");
    const result = await this.criteria.waive(
      context.organizationId,
      prId,
      criterionId,
      { id: context.actor.id, name: context.actor.name },
      { reason: context.note ?? "" },
    );

    return {
      pr_id: prId,
      criterion_id: criterionId,
      waived: result.criterion.status === "waived",
      annotation: result.annotation.state,
    };
  }

  /**
   * **Allow once** — the one new mechanism. In one transaction: grant a single-use exception for
   * exactly this run and path, then ask AP.3 to judge `allowed_paths` again; the grant is consumed
   * by that verdict. If AP.3 still says no, the transaction rolls back and nothing was granted —
   * the inbox never decides writability. Then AP.4 resumes the run.
   *
   * @param context - The item and the person.
   * @returns `{exception_id, evaluation_id, control_id}`.
   */
  private async allowOnce(context: ActionContext): Promise<ActionOutcome> {
    const runId = refOf(context.item, "run");
    const path = refOf(context.item, "path");

    // Resume is AP.4's administrators' control; refuse before granting anything a person could
    // not then resume.
    if (!mayRequest("resume", context.actor.roles)) {
      throw forbidden(context.actor.roles.join(","), CONTROL_ROLES.resume);
    }

    const granted = await this.repository.transaction(async (trx) => {
      const exceptionId = await this.repository.grantException(trx, {
        organizationId: context.organizationId,
        runId,
        pathGlob: path,
        grantedBy: context.actor.id,
        itemId: context.item.id,
      });
      const verdict = await this.guardrails.reevaluatePaths(trx, runId);

      if (verdict?.verdict !== "pass" || !verdict.grantsSpent.includes(exceptionId)) {
        throw allowOnceStillBlocked(runId, {
          verdict: verdict?.verdict ?? null,
          changeSetSeq: verdict?.changeSetSeq ?? null,
        });
      }

      return { exceptionId, evaluationId: verdict.evaluationId };
    });

    const resumed = await this.controls.submit(context.organizationId, runId, context.actor, {
      kind: "resume",
      idempotencyKey: `inbox:${context.attemptId}`,
    });

    return {
      run_id: runId,
      exception_id: granted.exceptionId,
      evaluation_id: granted.evaluationId,
      control_id: resumed.id,
      control_state: resumed.state,
    };
  }

  /**
   * **Deny** — AP.4 sends the loop back with the reason, so it learns why; the path stays
   * protected because nothing was granted.
   *
   * @param context - The item and the person.
   * @returns `{control_id}`.
   */
  private async denyProtectedPath(context: ActionContext): Promise<ActionOutcome> {
    const runId = refOf(context.item, "run");
    const path = refOf(context.item, "path");
    const control = await this.controls.correctionRound(
      context.organizationId,
      runId,
      context.actor,
      denyReason(path),
      `inbox:${context.attemptId}`,
    );

    return { run_id: runId, control_id: control.id, control_state: control.state };
  }

  /**
   * **Return to loop with note** / **Retry with note** — AP.4's correction round, the note as the
   * steering text.
   *
   * @param context - The item, the person and the note.
   * @returns `{control_id}`.
   */
  private async correctionRound(context: ActionContext): Promise<ActionOutcome> {
    const runId = refOf(context.item, "run");
    const control = await this.controls.correctionRound(
      context.organizationId,
      runId,
      context.actor,
      context.note ?? "",
      `inbox:${context.attemptId}`,
    );

    return { run_id: runId, control_id: control.id, control_state: control.state };
  }

  /**
   * **Cancel loop** / **Stop loop** — AP.4's abort, confirmed with the run's own loop number (the
   * card's press is the confirmation).
   *
   * @param context - The item and the person.
   * @returns `{control_id}`.
   */
  private async cancelRun(context: ActionContext): Promise<ActionOutcome> {
    const runId = refOf(context.item, "run");
    const loopSeq = await this.repository.loopSeq(context.organizationId, runId);
    const control = await this.controls.submit(context.organizationId, runId, context.actor, {
      kind: "abort",
      confirmation: loopSeq === undefined ? "" : String(loopSeq),
      idempotencyKey: `inbox:${context.attemptId}`,
    });

    return { run_id: runId, control_id: control.id, control_state: control.state };
  }

  /**
   * **Dismiss drift** — CM.4 dismisses the watch item the card is about, the note as its reason.
   *
   * @param context - The item, the person and the note.
   * @returns `{watch_item_id, status}`.
   */
  private async dismissWatchItem(context: ActionContext): Promise<ActionOutcome> {
    const itemId = watchItemOf(context.item.sourceRef);

    if (itemId === undefined) {
      throw decisionItemRefMissing(context.item.id, "a watch item in its source reference");
    }

    const dismissed = await this.watch.dismiss(
      context.organizationId,
      context.actor.id,
      itemId,
      context.note?.trim() || "Dismissed from the inbox.",
    );

    return { watch_item_id: dismissed.id, status: dismissed.status };
  }

  /**
   * **Approve & push** — AL.3 pushes the split's batch.
   *
   * @param context - The item.
   * @returns `{draft_batch_id, push, pushed}`.
   */
  private async pushBatch(context: ActionContext): Promise<ActionOutcome> {
    const batchId = sourceSegment(context.item, "batch");
    const result = await this.batches.push(context.organizationId, batchId);

    return {
      draft_batch_id: batchId,
      push: result.report.outcome,
      pushed: result.report.pushedThisRun,
    };
  }

  /**
   * **Require bench upgrade** — AL.4 stores a one-draft batch for the bench gap, composed from the
   * card's facts, targeting the PR's ticket source. The item resolves carrying the draft's ref.
   *
   * @param context - The item and the person.
   * @returns `{draft_batch_id, draft_id}`.
   */
  private async requireBenchUpgrade(context: ActionContext): Promise<ActionOutcome> {
    const prId = refOf(context.item, "pr");
    const pr = await this.repository.pullRequest(context.organizationId, prId);

    if (pr?.ticketSourceId == null) {
      throw benchUpgradeTargetMissing(prId);
    }

    const claim = factText(context.item.payload.claim);
    const capability = factText(context.item.payload.missing_capability);
    const batch = await this.batches.compose(context.organizationId, context.actor.id, {
      prompt: `Bench gap from PR #${String(pr.number)}: “${claim}” needs a ${capability}.`,
      planner: BENCH_UPGRADE_PLANNER,
      targetSourceId: pr.ticketSourceId,
      drafts: [
        {
          localKey: "bench-1",
          title: `Bench: add a ${capability} to the rig`,
          body:
            `PR #${String(pr.number)}${pr.ticketKey === null ? "" : ` (${pr.ticketKey})`} claims ` +
            `“${claim}”, and the bench cannot verify it: the rig has no ${capability}.\n\n` +
            "Drafted from the Needs-You inbox by Require bench upgrade; the claim stays unverified " +
            "until the rig can exercise it.",
        },
      ],
    });
    const draft = batch.drafts[0];

    return { pr_id: prId, draft_batch_id: batch.id, draft_id: draft?.id ?? null };
  }

  /**
   * **Confirm** — a proposed fact is confirmed; a stale one reconfirmed.
   *
   * @param context - The item and the person.
   * @returns `{fact_id, status}`.
   */
  private async confirmFact(context: ActionContext): Promise<ActionOutcome> {
    const factId = sourceSegment(context.item, "fact");
    const status = await this.repository.factStatus(context.organizationId, factId);
    const fact =
      status === "stale"
        ? await this.facts.reconfirm(context.organizationId, factId, context.actor.id)
        : await this.facts.confirm(context.organizationId, factId, context.actor.id);

    return { fact_id: factId, status: fact.status };
  }

  /**
   * **Retire** — a proposed fact is rejected; a confirmed or stale one expired. The note is the
   * reason either way.
   *
   * @param context - The item, the person and the reason.
   * @returns `{fact_id, status}`.
   */
  private async retireFact(context: ActionContext): Promise<ActionOutcome> {
    const factId = sourceSegment(context.item, "fact");
    const status = await this.repository.factStatus(context.organizationId, factId);
    const reason = context.note ?? "";
    const fact =
      status === "proposed"
        ? await this.facts.reject(context.organizationId, factId, context.actor.id, reason)
        : await this.facts.expire(context.organizationId, factId, context.actor.id, reason);

    return { fact_id: factId, status: fact.status };
  }
}
