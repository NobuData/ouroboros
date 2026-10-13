/**
 * A button pressed on a decision card (BZ.4,
 * [#538](https://github.com/NobuData/ouroboros/issues/538)) — answered through the inbox's
 * action executor (#462), as the person who pressed it.
 *
 * ```
 * press ─▶ signed by this workspace? ─▶ on the card we posted for that decision?   else rejected
 *       ─▶ presser linked?  (no → the link prompt, nothing changes)
 *       ─▶ already answered? (yes → who answered, nothing changes)
 *       ─▶ merge-class?     (yes → a link to confirm in the app, nothing changes)
 *       ─▶ may they press it? (no → the capability or role it needs, nothing changes)
 *       ─▶ takes a note?    (yes → a link to give it in the app, nothing changes)
 *       ─▶ InboxActionsService.execute(…, channel: slack) ─▶ audit
 * ```
 *
 * **This is not a second answer path.** Nothing here grants an exception, records a resolution
 * or resumes a run: `execute` does, exactly as it does for the inbox's own button. What follows
 * an answer in the channel — the card edited to its resolved form, the system line, the outcome
 * on the message row — is the publisher hearing the decision's lifecycle (#536), and the
 * escalation timer is cancelled by the database when the item resolves (`V135`).
 *
 * **A reference is spent with its decision.** A signed value names one decision and one action.
 * Once the decision is answered — by this press, another person's, the inbox or a policy —
 * every value for it only ever reports who answered. Two people pressing at once race inside the
 * executor, which lets one through and refuses the other with `decision_already_answered` or
 * `decision_action_in_progress`; both are reported here, never retried.
 *
 * **A forged or replayed payload does nothing.** The value must carry this workspace's signature
 * *and* arrive from a message this connection posted as that decision's card. A genuine value
 * lifted onto another message, or presented with no message, is rejected with the forged ones.
 *
 * No platform appears here: the Slack adapter resolves the presser's link and hands over ids.
 */

import { Injectable, Logger } from "@nestjs/common";

import { CHAT_DECISION_ANSWERED_EVENT } from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import { AppConfigService } from "../config/config.service";
import { DecisionKindRegistry } from "../decisions/decision-kind.registry";
import { holdsRole } from "../decisions/decision.actions";
import type { DecisionAction, DecisionRequiredRole } from "../decisions/decision.types";
import { InboxRepository } from "../decisions/inbox.repository";
import { DomainError } from "../errors/error.envelope";
import { describeForLog } from "../errors/failure";
import { INBOX_ACTION_ERRORS } from "../inbox-actions/inbox-actions.errors";
import { InboxActionsService } from "../inbox-actions/inbox-actions.service";
import { effectiveCanApproveLoops } from "../tenancy/capabilities";
import { CapabilityRepository } from "../tenancy/capability.repository";
import { OrganizationRepository } from "../tenancy/organization.repository";
import { answers, resolutionFootnote } from "./chat.cards.decision";
import { ChatComposer } from "./chat.composer";
import { ChatEscalationRepository } from "./chat.escalation.repository";
import { ChatPublisher } from "./chat.publisher";
import { ChatRepository } from "./chat.repository";

/** The capability an `approver` action asks for (#485), as people and the audit log name it. */
export const APPROVER_CAPABILITY = "can_approve_loops";

/** A button press, as a platform adapter hands it over. */
export interface ChatPress {
  readonly organizationId: string;
  readonly connectionId: string;
  /** The platform's id of the channel or DM the message is in. */
  readonly platformChannelId: string | undefined;
  /** The platform's timestamp of the message the button is on. */
  readonly platformTs: string | undefined;
  /** The button's value, exactly as the platform sent it back. */
  readonly value: unknown;
  /** The platform's id of whoever pressed it. */
  readonly platformUserId: string;
  /** The person their identity is linked to; undefined when it is not linked. */
  readonly userId: string | undefined;
}

/** How a press ended. Only `answered` changed anything. */
export type ChatPressOutcome =
  /** Not this workspace's signature, or not on the card it was issued for. */
  | { readonly kind: "rejected" }
  /** The presser's chat identity is not linked to an account. */
  | { readonly kind: "unlinked" }
  /** Their link names somebody who is no longer a member of the workspace. */
  | { readonly kind: "not_a_member" }
  /** The decision was answered before this press — `summary` says by whom and how. */
  | { readonly kind: "already_answered"; readonly summary: string | undefined }
  /** Somebody else's press is executing right now. */
  | { readonly kind: "in_progress" }
  /** The decision is no longer waiting — it expired or was withdrawn. */
  | { readonly kind: "closed" }
  /** A merge-class action: it is confirmed in the app, at `url` (X5). */
  | { readonly kind: "confirm_in_app"; readonly url: string }
  /** The answer takes a note, which a button cannot carry: it is given in the app, at `url`. */
  | { readonly kind: "needs_note"; readonly action: string; readonly url: string }
  /** The presser lacks what the action asks for — `needs` names it. */
  | { readonly kind: "denied"; readonly action: string; readonly needs: string }
  /** The executor, or the plane behind it, refused — in its own words. Nothing was answered. */
  | { readonly kind: "refused"; readonly message: string }
  /** Answered: what the plane did. */
  | { readonly kind: "answered"; readonly action: string; readonly effects: readonly string[] };

/**
 * What an action asks of whoever presses it, as a person reads it.
 *
 * @param required - The action's `required_role`.
 * @returns ``the `can_approve_loops` capability``, or `the admin role`.
 */
export function requirementWords(required: DecisionRequiredRole): string {
  return required === "approver"
    ? `the \`${APPROVER_CAPABILITY}\` capability`
    : `the ${required} role`;
}

@Injectable()
export class ChatAnswers {
  private readonly logger = new Logger(ChatAnswers.name);

  /**
   * @param composer - Checks a button value's signature.
   * @param messages - The stored message a press arrived from.
   * @param repository - How a decision ended.
   * @param publisher - Re-intends a resolved card's edit, for a press on one not yet edited.
   * @param inbox - Decision items.
   * @param registry - The kinds, pinned: an action's requirement and whether it is a merge.
   * @param actions - The inbox's action executor (#462).
   * @param organizations - A member's roles.
   * @param capabilities - A member's explicit capability.
   * @param audit - The audit plane.
   * @param config - `OURO_UI_URL`, for the confirmation link.
   */
  constructor(
    private readonly composer: ChatComposer,
    private readonly messages: ChatEscalationRepository,
    private readonly repository: ChatRepository,
    private readonly publisher: ChatPublisher,
    private readonly inbox: InboxRepository,
    private readonly registry: DecisionKindRegistry,
    private readonly actions: InboxActionsService,
    private readonly organizations: OrganizationRepository,
    private readonly capabilities: CapabilityRepository,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Handle one press.
   *
   * @param press - The press.
   * @param now - The instant, for the audit entry.
   * @returns How it ended. Every outcome but `answered` left all state as it was.
   * @throws {Error} Only for a failure nobody named — a lost database, say. A refusal by the
   *   executor or a plane is an outcome, not an exception.
   */
  async press(press: ChatPress, now: Date = new Date()): Promise<ChatPressOutcome> {
    // 1. The reference: signed by this workspace, and pressed on the card it was issued for.
    const reference = await this.composer.verifiedAction(press.organizationId, press.value);

    if (
      reference === undefined ||
      press.platformChannelId === undefined ||
      press.platformTs === undefined
    ) {
      return { kind: "rejected" };
    }

    const message = await this.messages.pressedMessage(
      press.connectionId,
      press.platformChannelId,
      press.platformTs,
    );

    if (
      message === undefined ||
      message.organizationId !== press.organizationId ||
      message.kind !== "decision_card" ||
      message.decisionItemId !== reference.itemId
    ) {
      return { kind: "rejected" };
    }

    // 2. Who pressed it.
    if (press.userId === undefined) {
      return { kind: "unlinked" };
    }

    const roles = await this.organizations.rolesFor(press.organizationId, press.userId);
    const name = roles === undefined ? undefined : await this.messages.personName(press.userId);

    if (roles === undefined || name === undefined) {
      return { kind: "not_a_member" };
    }

    // 3. Whether there is still anything to answer.
    const item = await this.inbox.item(press.organizationId, reference.itemId);

    if (item === undefined) {
      return { kind: "rejected" };
    }

    if (item.status === "resolved") {
      return this.alreadyAnswered(item.id);
    }

    if (item.status === "expired") {
      return { kind: "closed" };
    }

    const kind = await this.registry.pinnedKind(item.kindId, item.kindVersion);
    const action = kind.actions.find((candidate) => candidate.id === reference.actionId);

    if (action === undefined || !answers(kind, action)) {
      return { kind: "rejected" };
    }

    // 4. Chat is not the last word on a merge (X5) — whatever the card it came from looked like.
    if (kind.mergeClass) {
      return { kind: "confirm_in_app", url: this.itemUrl(item.id) };
    }

    // 5. Whether they may press it — the executor's own rule, asked first so it can be named.
    const explicit = await this.capabilities.explicitFor(press.organizationId, press.userId);
    const canApproveLoops = effectiveCanApproveLoops(roles, explicit);

    if (!holdsRole(action.required_role, { roles, canApproveLoops })) {
      return {
        kind: "denied",
        action: action.label,
        needs: requirementWords(action.required_role),
      };
    }

    // A button carries no text, so an answer that must come with a note is given in the app —
    // said plainly here rather than left to the executor's `decision_note_required`.
    if (action.takes_note) {
      return { kind: "needs_note", action: action.label, url: this.itemUrl(item.id) };
    }

    // 6. The executor. It checks again, claims the item, runs the plane and records the answer.
    try {
      const result = await this.actions.execute(
        press.organizationId,
        item.id,
        action.id,
        { id: press.userId, name, roles },
        {},
        "slack",
      );

      await this.audited(press, item.id, message.id, action, result.attempt.id, now);

      return { kind: "answered", action: action.label, effects: result.receipt.effects };
    } catch (error) {
      if (!(error instanceof DomainError)) {
        throw error;
      }

      switch (error.code) {
        case INBOX_ACTION_ERRORS.alreadyAnswered:
          return this.alreadyAnswered(item.id);
        case INBOX_ACTION_ERRORS.inProgress:
          return { kind: "in_progress" };
        case INBOX_ACTION_ERRORS.itemExpired:
          return { kind: "closed" };
        case INBOX_ACTION_ERRORS.confirmInApp:
          return { kind: "confirm_in_app", url: this.itemUrl(item.id) };
        case INBOX_ACTION_ERRORS.forbidden:
          return {
            kind: "denied",
            action: action.label,
            needs: requirementWords(action.required_role),
          };
        default:
          return { kind: "refused", message: error.message };
      }
    }
  }

  /**
   * Where a decision is answered in the app.
   *
   * @param itemId - The decision.
   * @returns `/inbox?item=<id>` on the UI origin.
   */
  private itemUrl(itemId: string): string {
    return `${this.config.uiUrl.replace(/\/+$/, "")}/inbox?item=${encodeURIComponent(itemId)}`;
  }

  /**
   * The outcome for a decision somebody already answered.
   *
   * It also intends the card's resolved form again. That is a no-op when the lifecycle hook
   * already did (the intent is unique per card), and the repair when it did not — so a presser
   * looking at a stale card sees it close.
   *
   * @param itemId - The decision.
   * @returns `already_answered`, with who answered and how when that is on record.
   */
  private async alreadyAnswered(itemId: string): Promise<ChatPressOutcome> {
    const resolution = await this.repository.resolution(itemId);

    if (resolution !== undefined) {
      await this.publisher.decisionResolved(itemId, resolution.actionId);
    }

    return {
      kind: "already_answered",
      summary: resolution === undefined ? undefined : resolutionFootnote(resolution),
    };
  }

  /**
   * Record who answered from chat, what let them, and where the press came from.
   *
   * The answer has already executed and been recorded by its own plane; a failure here is
   * logged and does not turn a completed answer into an error for the presser.
   *
   * @param press - The press.
   * @param itemId - The decision answered.
   * @param messageId - The `chat_messages` row the button was on.
   * @param action - The action executed.
   * @param attemptId - The executor's attempt (`decision_action_attempts`).
   * @param at - When.
   */
  private async audited(
    press: ChatPress,
    itemId: string,
    messageId: string,
    action: DecisionAction,
    attemptId: string,
    at: Date,
  ): Promise<void> {
    try {
      await this.audit.record({
        organizationId: press.organizationId,
        actorId: press.userId ?? null,
        action: CHAT_DECISION_ANSWERED_EVENT,
        subjectType: "decision_item",
        subjectId: itemId,
        at,
        detail: {
          surface: "slack",
          actionId: action.id,
          // What permitted it: the capability for an approver action, else the role it asks for.
          permittedBy:
            action.required_role === "approver"
              ? APPROVER_CAPABILITY
              : `role:${action.required_role}`,
          attemptId,
          connectionId: press.connectionId,
          messageId,
          platformChannelId: press.platformChannelId,
          platformTs: press.platformTs,
          platformUserId: press.platformUserId,
        },
      });
    } catch (error) {
      this.logger.error(
        `Could not audit the chat answer on message ${messageId}.`,
        describeForLog(error),
      );
    }
  }
}
