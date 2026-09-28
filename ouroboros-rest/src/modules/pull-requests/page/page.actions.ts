/**
 * `PageActionsService` — the PR page's two composed head actions and the approval answer (AX.5,
 * [#361](https://github.com/NobuData/ouroboros/issues/361), decision **V5**).
 *
 * ```
 * POST …/return-to-loop {gates, revisionId?, note?}
 *   ─▶ each gate red on the revision?  ─▶ steer = "<gate>: <evidence>" per gate (+ note)
 *   ─▶ ControlsService.correctionRound  (AP.4 steer + V061 stage retry — the queue's own path)
 *   ─▶ pr_loop_returns                   (the attempt the next revision is expected from)
 *
 * POST …/request-review {reviewer?}
 *   ─▶ lock PR ─▶ open the approval slot (or answer the one open)       — the needs-you item
 *   ─▶ gate engine: approval_recorded   (human_approval → required, pending)
 *   ─▶ SPI requestReview, when a host login was named                   — recorded, never thrown
 *
 * POST …/approvals {decision, note?}
 *   ─▶ lock PR ─▶ answer the open slot (opening one first if none) on the latest revision
 *   ─▶ gate engine: approval_recorded   (green or red — and the aggregate may flip)
 * ```
 *
 * **No new control path.** *Return to loop* is the correction round the Mark & Route card already
 * queues (#332): the same role policy, transcript entry, TTL and audit trigger. What this adds is the
 * *context* — the agent receives `physical_hil: overshoot 2.4% > 2.0% · rig helios-rig-02`, not
 * "please fix the PR" — so there is one way to nudge a loop, and it cannot diverge from itself.
 *
 * **A gate mutation, not a message.** *Request human review* writes an approval slot, and the gate
 * engine turns it into `human_approval`'s verdict under the PR's lock; the response carries the
 * re-evaluated gate and aggregate, so the UI shows what the engine decided, not what it expects.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";

import {
  PR_APPROVAL_APPROVED_EVENT,
  PR_APPROVAL_DECLINED_EVENT,
  PR_APPROVAL_REQUESTED_EVENT,
  type AuditRecord,
} from "../../audit/audit.events";
import { AuditService } from "../../audit/audit.service";
import type { RunControlResource } from "../../controls/controls.resources";
import { ControlsService, type Requester } from "../../controls/controls.service";
import type { PrApprovalHostRequest } from "../../db/schema";
import { GATE_EVIDENCE, type GateEvidenceSink } from "../gates/gate.evidence";
import { pullRequestNotFound } from "../criteria/criteria.errors";
import { PrSyncService } from "../pr-sync.service";
import type { ApprovalDecisionDto, RequestReviewDto, ReturnToLoopDto } from "./page.dto";
import {
  declineNoteRequired,
  gateNotRed,
  pullRequestHasNoRevision,
  pullRequestHasNoRun,
  pullRequestNotOpen,
  revisionNotFound,
} from "./page.errors";
import {
  PageRepository,
  type LockedPr,
  type PageStore,
  type PageTransaction,
} from "./page.repository";
import {
  aggregateResource,
  gateRowResource,
  loopReturnResource,
  reviewResource,
  type ReturnToLoopResource,
  type ReviewOutcomeResource,
} from "./page.resources";
import { composeSteer } from "./page.steer";

/** The PR states the host owns — nothing is sent back or approved on them. */
const HOST_OWNED: ReadonlySet<string> = new Set(["merged", "closed"]);

/** V065's `pr_approvals_host_detail_bounded`. */
export const MAX_HOST_DETAIL_LENGTH = 512;

/** Who is acting — the controls queue's requester: id, display name, roles here. */
export type PageActor = Requester;

/** The correction round, as this service reaches it — `ControlsService.correctionRound`. */
export interface PageControls {
  /**
   * @param organizationId - The workspace.
   * @param runId - The run.
   * @param requester - Who is asking.
   * @param note - The steer's text.
   * @param idempotencyKey - Optional replay key.
   * @returns The control.
   */
  correctionRound(
    organizationId: string,
    runId: string,
    requester: Requester,
    note: string,
    idempotencyKey?: string,
  ): Promise<RunControlResource>;
}

/** The host, as this service reaches it — `PrSyncService.requestReview`. */
export type PageHost = Pick<PrSyncService, "requestReview">;

/** The trail — `AuditService.record`. */
export interface PageAudit {
  /**
   * @param event - The event.
   * @returns The row id.
   */
  record(event: AuditRecord): Promise<string>;
}

@Injectable()
export class PageActionsService {
  private readonly logger = new Logger(PageActionsService.name);

  /**
   * @param store - The page's statements.
   * @param controls - AP.4's queue.
   * @param gates - The gate engine's sink — re-evaluates human approval after a slot moves.
   * @param host - The PR sync service, for the optional host review request.
   * @param audit - The trail.
   */
  constructor(
    @Inject(PageRepository) private readonly store: PageStore,
    @Inject(ControlsService) private readonly controls: PageControls,
    @Inject(GATE_EVIDENCE) private readonly gates: GateEvidenceSink,
    @Inject(PrSyncService) private readonly host: PageHost,
    @Inject(AuditService) private readonly audit: PageAudit,
  ) {}

  // --- Return to loop ------------------------------------------------------------------------

  /**
   * Send the selected red gates' evidence back to the loop as a correction round.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @param actor - Who is asking.
   * @param request - The gates, and optionally the revision, a note and a replay key.
   * @returns The control, the steer's text and the recorded expectation.
   * @throws {NotFoundError} `pull_request_not_found`, `pr_revision_not_found`, `run_not_found`.
   * @throws {ConflictError} `pull_request_not_open`, `pull_request_has_no_run`,
   *   `pull_request_has_no_revision`, `control_key_reused`.
   * @throws {InvalidRequestError} `pr_gate_not_red`.
   * @throws {ForbiddenError} `forbidden` — a role that may not steer.
   */
  async returnToLoop(
    organizationId: string,
    prId: string,
    actor: PageActor,
    request: ReturnToLoopDto,
  ): Promise<ReturnToLoopResource> {
    const head = await this.store.head(organizationId, prId);

    if (head === undefined) {
      throw pullRequestNotFound(prId);
    }

    if (HOST_OWNED.has(head.state)) {
      throw pullRequestNotOpen(prId, head.state);
    }

    if (head.run === null) {
      throw pullRequestHasNoRun(prId);
    }

    const revisions = await this.store.revisions(prId);
    const revision =
      request.revisionId === undefined
        ? revisions.at(-1)
        : revisions.find((each) => each.id === request.revisionId);

    if (revision === undefined) {
      throw request.revisionId === undefined
        ? pullRequestHasNoRevision(prId)
        : revisionNotFound(prId, request.revisionId);
    }

    const rows = (await this.store.gateRows(prId)).filter((row) => row.revisionId === revision.id);
    const notRed = request.gates.flatMap((key) => {
      const row = rows.find((each) => each.key === key);
      return row?.verdict === "red" ? [] : [{ key, verdict: row?.verdict ?? null }];
    });

    if (notRed.length > 0) {
      throw gateNotRed(revision.id, notRed);
    }

    // The card's order, so a selection is one text whatever order it was clicked in.
    const selected = rows.filter((row) => request.gates.includes(row.key));
    const payload = composeSteer(selected, request.note);
    const stage = await this.store.currentStage(head.run.id);
    const control = await this.controls.correctionRound(
      organizationId,
      head.run.id,
      actor,
      payload,
      request.idempotencyKey,
    );
    const gates = selected.map((row) => row.key);

    if (control.state === "rejected") {
      return {
        control,
        payload,
        revisionId: revision.id,
        gates,
        loopReturn: null,
        skipped: [
          `The run has finished, so no correction round was queued: ${control.detail ?? "rejected"}.`,
        ],
      };
    }

    const loopReturn = await this.store.recordLoopReturn({
      prId,
      revisionId: revision.id,
      controlId: control.id,
      gateKeys: gates,
      expected:
        stage === undefined ? null : { stageKey: stage.stageKey, attempt: stage.attempt + 1 },
      requestedBy: actor.id,
    });

    return {
      control,
      payload,
      revisionId: revision.id,
      gates,
      loopReturn: loopReturnResource(loopReturn),
      skipped:
        stage === undefined
          ? ["No stage of the run has started, so no attempt is expected yet."]
          : [],
    };
  }

  // --- Request human review ------------------------------------------------------------------

  /**
   * Open the PR's approval slot — or answer with the one already open — and re-evaluate human
   * approval, which the slot makes required and pending. Optionally ask a host login too.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @param actor - Who is asking.
   * @param request - Optionally, the host login to ask.
   * @returns The slot, whether this call opened it, and the re-evaluated gate and aggregate.
   * @throws {NotFoundError} `pull_request_not_found`.
   * @throws {ConflictError} `pull_request_not_open`, `pull_request_has_no_revision`.
   */
  async requestReview(
    organizationId: string,
    prId: string,
    actor: PageActor,
    request: RequestReviewDto,
  ): Promise<ReviewOutcomeResource> {
    const opened = await this.store.transaction(async (tx) => {
      const pr = await this.lockOpen(tx, organizationId, prId);
      const open = await tx.openApproval(prId);

      if (open !== undefined) {
        return { pr, approvalId: open.id, created: false };
      }

      const approvalId = await tx.insertApproval(prId, pr.latestRevisionId as string, actor.id);

      return { pr, approvalId, created: true };
    });

    await this.gates.notify(organizationId, { kind: "approval_recorded", prId });

    if (request.reviewer !== undefined) {
      await this.askHost(organizationId, opened.pr, opened.approvalId, request.reviewer);
    }

    if (opened.created) {
      await this.audit.record({
        organizationId,
        actorId: actor.id,
        action: PR_APPROVAL_REQUESTED_EVENT,
        subjectType: "pr_approval",
        subjectId: opened.approvalId,
        at: new Date(),
        detail: {
          pr_id: prId,
          revision_id: opened.pr.latestRevisionId,
          host_reviewer_asked: request.reviewer !== undefined,
        },
      });
    }

    return this.outcome(prId, opened.approvalId, opened.created);
  }

  // --- Approve / decline ---------------------------------------------------------------------

  /**
   * Answer the PR's approval slot on its latest revision — opening one first when none is open —
   * and re-evaluate human approval.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @param actor - Who is answering.
   * @param request - The decision and its note.
   * @returns The answered slot, whether this call opened it, and the re-evaluated gate and
   *   aggregate — which an approval can flip to merge-ready.
   * @throws {InvalidRequestError} `pr_decline_note_required`.
   * @throws {NotFoundError} `pull_request_not_found`.
   * @throws {ConflictError} `pull_request_not_open`, `pull_request_has_no_revision`.
   */
  async decide(
    organizationId: string,
    prId: string,
    actor: PageActor,
    request: ApprovalDecisionDto,
  ): Promise<ReviewOutcomeResource> {
    if (request.decision === "decline" && request.note === undefined) {
      throw declineNoteRequired();
    }

    const state = request.decision === "approve" ? "approved" : "declined";
    const decided = await this.store.transaction(async (tx) => {
      const pr = await this.lockOpen(tx, organizationId, prId);
      const revisionId = pr.latestRevisionId as string;
      const open = await tx.openApproval(prId);
      const approvalId = open?.id ?? (await tx.insertApproval(prId, revisionId, actor.id));

      await tx.decideApproval(approvalId, state, actor.id, revisionId, request.note ?? null);

      return { approvalId, revisionId, created: open === undefined };
    });

    await this.gates.notify(organizationId, { kind: "approval_recorded", prId });
    await this.audit.record({
      organizationId,
      actorId: actor.id,
      action: state === "approved" ? PR_APPROVAL_APPROVED_EVENT : PR_APPROVAL_DECLINED_EVENT,
      subjectType: "pr_approval",
      subjectId: decided.approvalId,
      at: new Date(),
      detail: { pr_id: prId, revision_id: decided.revisionId, opened_by_answer: decided.created },
    });

    return this.outcome(prId, decided.approvalId, decided.created);
  }

  // --- shared --------------------------------------------------------------------------------

  /**
   * Lock a PR a head action may act on.
   *
   * @param tx - The transaction.
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @returns It, open-ish and with a revision.
   * @throws {NotFoundError} `pull_request_not_found`.
   * @throws {ConflictError} `pull_request_not_open`, `pull_request_has_no_revision`.
   */
  private async lockOpen(
    tx: PageTransaction,
    organizationId: string,
    prId: string,
  ): Promise<LockedPr> {
    const pr = await tx.lockPr(organizationId, prId);

    if (pr === undefined) {
      throw pullRequestNotFound(prId);
    }

    if (HOST_OWNED.has(pr.state)) {
      throw pullRequestNotOpen(prId, pr.state);
    }

    if (pr.latestRevisionId === null) {
      throw pullRequestHasNoRevision(prId);
    }

    return pr;
  }

  /**
   * Ask a host login to review, and record how it landed. A refusal is recorded, never thrown:
   * the slot is the product's record, and the host request is a courtesy to people living there.
   *
   * @param organizationId - The workspace.
   * @param pr - The PR.
   * @param approvalId - The slot.
   * @param reviewer - The login.
   */
  private async askHost(
    organizationId: string,
    pr: LockedPr,
    approvalId: string,
    reviewer: string,
  ): Promise<void> {
    let outcome: PrApprovalHostRequest;
    let detail: string | null = null;

    try {
      const answer = await this.host.requestReview(
        organizationId,
        pr.sourceId,
        pr.number,
        reviewer,
      );
      outcome = answer === null ? "unsupported" : "requested";
    } catch (error) {
      outcome = "failed";
      detail = hostDetail(error);
      this.logger.warn(`The host refused a review request on pr ${pr.id}: ${detail}`);
    }

    await this.store.setHostRequest(approvalId, reviewer, outcome, detail);
  }

  /**
   * The slot and the latest revision's human approval and aggregate, after re-evaluation.
   *
   * @param prId - The PR.
   * @param approvalId - The slot.
   * @param created - Whether this call opened it.
   * @returns The outcome.
   */
  private async outcome(
    prId: string,
    approvalId: string,
    created: boolean,
  ): Promise<ReviewOutcomeResource> {
    const [approval, revisions, gateRows] = await Promise.all([
      this.store.approvalById(approvalId),
      this.store.revisions(prId),
      this.store.gateRows(prId),
    ]);
    const latest = revisions.at(-1);
    const rows = latest === undefined ? [] : gateRows.filter((row) => row.revisionId === latest.id);
    const human = rows.find((row) => row.key === "human_approval");
    const aggregate =
      latest === undefined || rows.length === 0
        ? undefined
        : (await this.store.aggregates([latest.id])).get(latest.id);

    if (approval === undefined) {
      // The slot was written in this request; only a cascade from a deleted PR could remove it.
      throw pullRequestNotFound(prId);
    }

    return {
      review: reviewResource(approval),
      created,
      humanApproval: human === undefined ? null : gateRowResource(human),
      aggregate: aggregate === undefined ? null : aggregateResource(aggregate),
    };
  }
}

/**
 * A host refusal, as V065's `host_detail` holds it.
 *
 * @param error - What the host call threw.
 * @returns Its message, non-empty and at most {@link MAX_HOST_DETAIL_LENGTH} characters.
 */
export function hostDetail(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).trim();
  const text = message === "" ? "the host refused the review request" : message;

  return text.length <= MAX_HOST_DETAIL_LENGTH
    ? text
    : `${text.slice(0, MAX_HOST_DETAIL_LENGTH - 1)}…`;
}
