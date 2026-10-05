/**
 * `InboxActionsService` — the action executor (BN.2, [#462](https://github.com/NobuData/ouroboros/issues/462),
 * decision **X3**): where *"the loop resumes instantly"* stops being copy.
 *
 * ```
 * press ─▶ item (this workspace) · pinned kind · declared action · answers the item? (not a link)
 *       ─▶ role check against the declaration (approver = can_approve_loops) · note iff takes_note
 *       ─▶ claim, in one transaction holding the item's row lock:
 *            same idempotency key? → replay what that attempt did (never press twice)
 *            item resolved?        → 409 decision_already_answered + who, what, when
 *            another attempt running? → 409 decision_action_in_progress + whose
 *            → insert the attempt, running
 *       ─▶ the handler — one adapter onto the owning plane (inbox-actions.handlers.ts)
 *       ─▶ failed:    attempt failed (code, sentence, status), audit decision.answer_failed,
 *                     the plane's error re-thrown — the item stays OPEN
 *       ─▶ succeeded: one transaction — the V095 resolution (the item closes, spans computed) and
 *                     the attempt succeeded with the receipt; then audit decision.answered and the
 *                     lifecycle's `resolved` (BN.3's channel echo; V096's trigger already revoked
 *                     every outstanding action token)
 * ```
 *
 * **First answer wins.** The claim serialises on the item's row lock and V099 allows one running
 * attempt per item, so two presses cannot both reach a plane; V099 also keeps the out-of-band
 * closure off an item while an answer is running, so *Approve & merge* never loses its own
 * resolution to the PR-merged watcher.
 *
 * **Roles are declared, not implied.** The action's `required_role` is checked here, server-side,
 * whatever the UI showed; the plane then applies its own policy too (AP.4's resume is an
 * administrator's), and a plane's refusal is a failed attempt like any other.
 */

import { randomUUID } from "node:crypto";

import { HttpStatus, Injectable, Logger } from "@nestjs/common";

import {
  DECISION_ANSWERED_EVENT,
  DECISION_ANSWER_FAILED_EVENT,
  type AuditDetail,
} from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import type { Requester } from "../controls/controls.service";
import type { DecisionChannel } from "../db/schema";
import { holdsRole } from "../decisions/decision.actions";
import { DecisionKindRegistry } from "../decisions/decision-kind.registry";
import { DecisionLifecycle } from "../decisions/decision.lifecycle";
import type { DecisionAction, PublishedDecisionKind } from "../decisions/decision.types";
import { DomainError } from "../errors/error.envelope";
import { CapabilityRepository } from "../tenancy/capability.repository";
import { effectiveCanApproveLoops } from "../tenancy/capabilities";
import {
  decisionActionForbidden,
  decisionActionInProgress,
  decisionActionNeedsPerson,
  decisionActionNotAnAnswer,
  decisionActionNotFound,
  decisionAlreadyAnswered,
  decisionIdempotencyKeyReused,
  decisionItemExpired,
  decisionItemNotFound,
  decisionNoteNotTaken,
  decisionNoteRequired,
  type WinningResolution,
} from "./inbox-actions.errors";
import { MAX_NOTE_LENGTH } from "./inbox-actions.dto";
import { InboxActionHandlers, type ActionOutcome } from "./inbox-actions.handlers";
import {
  InboxActionsRepository,
  type ActionAttempt,
  type ActionFailure,
  type ActionItem,
  type ActionResolution,
} from "./inbox-actions.repository";
import { actionResultResource, type ActionResultResource } from "./inbox-actions.resources";

/** What a press carries beyond the route. */
export interface ActionRequest {
  /** The note — required exactly when the action `takes_note`. */
  readonly note?: string;
  /** The client's key; generated when absent, so every attempt has one. */
  readonly idempotencyKey?: string;
}

/**
 * How long a running attempt may hold an item before a new press treats it as abandoned — a
 * process that died mid-handler must not lock a card forever. Longer than any plane call.
 */
export const ABANDONED_ATTEMPT_MS = 10 * 60 * 1000;

/** What the claim decided. */
type Claim =
  | { readonly kind: "claimed"; readonly attemptId: string; readonly key: string }
  | { readonly kind: "replay"; readonly attempt: ActionAttempt };

/**
 * A resolution as a loser of the race is told it.
 *
 * @param resolution - The stored resolution.
 * @returns Who, what, how and when.
 */
function winning(resolution: ActionResolution): WinningResolution {
  return {
    actionId: resolution.actionId,
    resolver: resolution.resolver,
    policy: resolution.policy,
    actor: resolution.actor,
    channel: resolution.channel,
    resolvedAt: resolution.resolvedAt.toISOString(),
  };
}

/**
 * An error as an attempt records it.
 *
 * @param error - What the handler threw.
 * @returns The code, sentence and status; a non-domain error is a 500 the person cannot fix.
 */
export function failureOf(error: unknown): ActionFailure {
  if (error instanceof DomainError) {
    return { code: error.code, message: error.envelope().message, status: error.getStatus() };
  }

  return {
    code: "decision_handler_failed",
    message: "The plane that owns this action failed; nothing was decided.",
    status: HttpStatus.INTERNAL_SERVER_ERROR,
  };
}

/**
 * A receipt as flat audit detail — every key prefixed `outcome_`.
 *
 * @param outcome - The receipt.
 * @returns The detail entries.
 */
function outcomeDetail(outcome: ActionOutcome): AuditDetail {
  return Object.fromEntries(
    Object.entries(outcome).map(([key, value]) => [`outcome_${key}`, value]),
  );
}

@Injectable()
export class InboxActionsService {
  private readonly logger = new Logger(InboxActionsService.name);

  /**
   * @param repository - Every statement the executor issues.
   * @param handlers - The adapters onto the planes.
   * @param registry - The kinds, pinned.
   * @param lifecycle - Who hears that an item was answered (BN.3, #536).
   * @param audit - Where every execution is recorded (X9).
   * @param capabilities - `can_approve_loops`, for `approver` actions.
   */
  constructor(
    private readonly repository: InboxActionsRepository,
    private readonly handlers: InboxActionHandlers,
    private readonly registry: DecisionKindRegistry,
    private readonly lifecycle: DecisionLifecycle,
    private readonly audit: AuditService,
    private readonly capabilities: CapabilityRepository,
  ) {}

  /**
   * Press one action of one item.
   *
   * @param organizationId - The workspace.
   * @param itemId - The item.
   * @param actionId - The declared action.
   * @param actor - The signed-in person and their roles, or `undefined` for a caller with no person.
   * @param request - The note and the idempotency key.
   * @param channel - Where the press came from — `web` for the route; BN.3/#538 pass their own.
   * @returns The answer, with the plane's receipt. A replayed key answers what the first did.
   * @throws {NotFoundError} `decision_item_not_found`, `decision_action_not_found`.
   * @throws {InvalidRequestError} `decision_action_not_an_answer`, `decision_note_required`,
   *   `decision_note_not_taken`.
   * @throws {ForbiddenError} `decision_action_forbidden`, `decision_action_needs_person`.
   * @throws {ConflictError} `decision_already_answered`, `decision_action_in_progress`,
   *   `decision_item_expired`, `decision_idempotency_key_reused`.
   * @throws {NotImplementedError} `decision_action_unbound`.
   * @throws {DomainError} Whatever the owning plane refused with; the item stays open.
   */
  async execute(
    organizationId: string,
    itemId: string,
    actionId: string,
    actor: Requester | undefined,
    request: ActionRequest,
    channel: DecisionChannel = "web",
  ): Promise<ActionResultResource> {
    if (actor === undefined) {
      throw decisionActionNeedsPerson();
    }

    const item = await this.repository.item(this.repository.db, organizationId, itemId);

    if (item === undefined) {
      throw decisionItemNotFound(itemId);
    }

    const kind = await this.registry.pinnedKind(item.kindId, item.kindVersion);
    const action = this.declaredAnswer(kind, actionId);
    await this.assertMayPress(organizationId, actor, action);
    const note = this.noteFor(action, request.note);

    const claim = await this.claim(item, action, actor, channel, request.idempotencyKey);

    if (claim.kind === "replay") {
      return this.replay(item, kind, claim.attempt);
    }

    const context = {
      organizationId,
      item,
      actionId,
      actor,
      note,
      attemptId: claim.attemptId,
    };

    let outcome: ActionOutcome;

    try {
      outcome = await this.handlers.execute(action.handler_binding, context);
    } catch (error) {
      await this.recordFailure(item, action, actor, channel, claim.attemptId, error);
      throw error;
    }

    return this.resolve(item, kind, action, actor, channel, note, claim, outcome);
  }

  /**
   * The declared action, held to being an answer.
   *
   * @param kind - The item's pinned kind.
   * @param actionId - The action asked for.
   * @returns The action.
   * @throws {NotFoundError} When the kind declares no such action.
   * @throws {InvalidRequestError} When it is a link rather than an answer.
   */
  private declaredAnswer(kind: PublishedDecisionKind, actionId: string): DecisionAction {
    const action = kind.actions.find((candidate) => candidate.id === actionId);

    if (action === undefined) {
      throw decisionActionNotFound(kind.kindId, actionId);
    }

    if (!kind.resolutionSemantics.answered_by.includes(actionId)) {
      throw decisionActionNotAnAnswer(actionId);
    }

    return action;
  }

  /**
   * Refuse a person who lacks the action's declared role (or, for `approver`, the capability).
   *
   * @param organizationId - The workspace.
   * @param actor - The person.
   * @param action - The action.
   * @throws {ForbiddenError} `decision_action_forbidden`.
   */
  private async assertMayPress(
    organizationId: string,
    actor: Requester,
    action: DecisionAction,
  ): Promise<void> {
    const canApproveLoops =
      action.required_role === "approver"
        ? effectiveCanApproveLoops(
            actor.roles,
            await this.capabilities.explicitFor(organizationId, actor.id),
          )
        : false;

    if (!holdsRole(action.required_role, { roles: actor.roles, canApproveLoops })) {
      throw decisionActionForbidden(action.id, action.required_role);
    }
  }

  /**
   * The note, held to the declaration.
   *
   * @param action - The action.
   * @param raw - What the request carried.
   * @returns The trimmed note, or null when the action takes none.
   * @throws {InvalidRequestError} `decision_note_required` / `decision_note_not_taken`.
   */
  private noteFor(action: DecisionAction, raw: string | undefined): string | null {
    const note = raw?.trim() ?? "";

    if (action.takes_note && note === "") {
      throw decisionNoteRequired(action.id);
    }

    if (!action.takes_note && note !== "") {
      throw decisionNoteNotTaken(action.id);
    }

    return action.takes_note ? note.slice(0, MAX_NOTE_LENGTH) : null;
  }

  /**
   * Claim the item for one press — see the file header.
   *
   * @param item - The item.
   * @param action - The action.
   * @param actor - The person.
   * @param channel - Where the press came from.
   * @param requestedKey - The client's key, if any.
   * @returns A fresh running attempt, or the earlier attempt under the same key to replay.
   */
  private claim(
    item: ActionItem,
    action: DecisionAction,
    actor: Requester,
    channel: DecisionChannel,
    requestedKey: string | undefined,
  ): Promise<Claim> {
    const key = requestedKey ?? randomUUID();

    return this.repository.transaction(async (trx) => {
      const locked = await this.repository.item(trx, item.organizationId, item.id, true);

      if (locked === undefined) {
        throw decisionItemNotFound(item.id);
      }

      const earlier = await this.repository.attemptByKey(trx, item.id, key);

      if (earlier !== undefined) {
        if (earlier.actionId !== action.id || earlier.actorId !== actor.id) {
          throw decisionIdempotencyKeyReused(key);
        }

        return { kind: "replay", attempt: earlier };
      }

      if (locked.status === "resolved") {
        const resolution = await this.repository.resolution(trx, item.id);

        throw decisionAlreadyAnswered(
          item.id,
          resolution === undefined
            ? {
                actionId: "unknown",
                resolver: "human",
                policy: null,
                actor: null,
                channel: "web",
                resolvedAt: new Date(0).toISOString(),
              }
            : winning(resolution),
        );
      }

      if (locked.status === "expired") {
        throw decisionItemExpired(item.id);
      }

      const running = await this.repository.runningAttempt(trx, item.id);

      if (
        running !== undefined &&
        Date.now() - running.startedAt.getTime() > ABANDONED_ATTEMPT_MS
      ) {
        await this.repository.fail(trx, running.id, {
          code: "decision_attempt_abandoned",
          message: "This attempt never finished; a later press took the item over.",
          status: HttpStatus.INTERNAL_SERVER_ERROR,
        });
      } else if (running !== undefined) {
        throw decisionActionInProgress(item.id, {
          actionId: running.actionId,
          actor: running.actor,
          startedAt: running.startedAt.toISOString(),
        });
      }

      const attemptId = await this.repository.insertAttempt(trx, {
        organizationId: item.organizationId,
        itemId: item.id,
        actionId: action.id,
        actorId: actor.id,
        channel,
        idempotencyKey: key,
      });

      return { kind: "claimed", attemptId, key };
    });
  }

  /**
   * Answer a repeated key with what its first attempt did.
   *
   * @param item - The item.
   * @param kind - Its pinned kind, for the receipt's wording.
   * @param attempt - The earlier attempt.
   * @returns The stored answer.
   * @throws {ConflictError} While the earlier attempt is still running.
   * @throws {DomainError} The earlier attempt's failure, as it was answered.
   */
  private async replay(
    item: ActionItem,
    kind: PublishedDecisionKind,
    attempt: ActionAttempt,
  ): Promise<ActionResultResource> {
    if (attempt.status === "running") {
      throw decisionActionInProgress(item.id, {
        actionId: attempt.actionId,
        actor: attempt.actor,
        startedAt: attempt.startedAt.toISOString(),
      });
    }

    if (attempt.status === "failed") {
      throw new DomainError(
        attempt.errorStatus ?? HttpStatus.INTERNAL_SERVER_ERROR,
        attempt.errorCode ?? "decision_handler_failed",
        attempt.errorMessage ?? "This action failed.",
        { itemId: item.id, attemptId: attempt.id, replayed: true },
      );
    }

    const resolution = await this.repository.resolution(this.repository.db, item.id);

    if (resolution === undefined) {
      throw new Error(`attempt ${attempt.id} succeeded but item ${item.id} has no resolution`);
    }

    return actionResultResource(
      item,
      attempt.id,
      attempt.idempotencyKey,
      resolution,
      true,
      // The item may have been answered by a different action than this key's (a policy, another
      // person): the receipt is worded by the action that actually answered.
      kind.actions.find((declared) => declared.id === resolution.actionId)?.handler_binding,
    );
  }

  /**
   * Record a handler's failure: the attempt ends failed and the item stays open.
   *
   * @param item - The item.
   * @param action - The action.
   * @param actor - The person.
   * @param channel - Where the press came from.
   * @param attemptId - The running attempt.
   * @param error - What the handler threw.
   */
  private async recordFailure(
    item: ActionItem,
    action: DecisionAction,
    actor: Requester,
    channel: DecisionChannel,
    attemptId: string,
    error: unknown,
  ): Promise<void> {
    const failure = failureOf(error);

    if (!(error instanceof DomainError)) {
      this.logger.error(
        `Handler ${action.handler_binding} failed for decision item ${item.id}.`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    await this.repository.fail(this.repository.db, attemptId, failure);
    await this.audit.record({
      organizationId: item.organizationId,
      actorId: actor.id,
      action: DECISION_ANSWER_FAILED_EVENT,
      subjectType: "decision_item",
      subjectId: item.id,
      at: new Date(),
      detail: {
        kind: item.kindId,
        version: item.kindVersion,
        action: action.id,
        channel,
        attempt: attemptId,
        error: failure.code,
        status: failure.status,
      },
    });
  }

  /**
   * Write the answer: the resolution and the finished attempt in one transaction, then the audit
   * line and the lifecycle event.
   *
   * @param item - The item.
   * @param kind - Its pinned kind.
   * @param action - The action.
   * @param actor - The person.
   * @param channel - Where the press came from.
   * @param note - The note, or null.
   * @param claim - The running attempt.
   * @param outcome - The plane's receipt.
   * @returns The answer.
   */
  private async resolve(
    item: ActionItem,
    kind: PublishedDecisionKind,
    action: DecisionAction,
    actor: Requester,
    channel: DecisionChannel,
    note: string | null,
    claim: Extract<Claim, { kind: "claimed" }>,
    outcome: ActionOutcome,
  ): Promise<ActionResultResource> {
    let resolution: ActionResolution | undefined;

    try {
      resolution = await this.repository.transaction(async (trx) => {
        await this.repository.insertResolution(trx, {
          itemId: item.id,
          organizationId: item.organizationId,
          actionId: action.id,
          userId: actor.id,
          channel,
          note,
          outcome,
        });
        await this.repository.succeed(trx, claim.attemptId, outcome);

        return this.repository.resolution(trx, item.id);
      });
    } catch (error) {
      // The plane acted but the answer could not be written: never leave the attempt running.
      await this.recordFailure(item, action, actor, channel, claim.attemptId, error);
      throw error;
    }

    if (resolution === undefined) {
      throw new Error(`item ${item.id} has no resolution after it was answered`);
    }

    await this.audit.record({
      organizationId: item.organizationId,
      actorId: actor.id,
      action: DECISION_ANSWERED_EVENT,
      subjectType: "decision_item",
      subjectId: item.id,
      at: new Date(),
      detail: {
        kind: kind.kindId,
        version: kind.version,
        action: action.id,
        channel,
        attempt: claim.attemptId,
        ...outcomeDetail(outcome),
      },
    });
    this.lifecycle.emit({
      type: "resolved",
      itemId: item.id,
      organizationId: item.organizationId,
      kindId: item.kindId,
      resolver: "human",
      policy: null,
      actionId: action.id,
      channel,
    });

    return actionResultResource(
      item,
      claim.attemptId,
      claim.key,
      resolution,
      false,
      action.handler_binding,
    );
  }
}
