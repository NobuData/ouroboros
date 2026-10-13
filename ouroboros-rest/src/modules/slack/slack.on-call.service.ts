/**
 * Who an escalation DMs (CA.3, [#543](https://github.com/NobuData/ouroboros/issues/543)) — the
 * on-call designee the Chat Ops page's routing card names beside *+ DM on-call*, and its picker.
 *
 * ```
 * read     the active assignment (scope decisions) · the members a DM could reach
 * assign   member ∈ workspace ─▶ linked on the active connection
 *          ─▶ one transaction: current stood down ─▶ new assignment
 *          ─▶ audit chat.on_call_changed (only when somebody else is now on call, or nobody)
 * ```
 *
 * **One designee, no rotation.** V132 allows one active assignment per (workspace, scope); the
 * publisher's *DM on-call* routes read it each time they enqueue (`chat/chat.outbox.ts`), so the
 * next blocking question goes to whoever was just chosen. Rotations are #548.
 *
 * **Only somebody a DM can reach.** A member becomes the designee only with a linked Slack
 * identity on the workspace's active connection. The database enforces that with a trigger; it is
 * checked here first so the answer is a sentence, not a constraint.
 */

import { Injectable } from "@nestjs/common";

import { CHAT_ON_CALL_CHANGED_EVENT } from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import { ON_CALL_SCOPE } from "../chat/chat.outbox";
import { chatMemberNotFound, chatOnCallNotLinked } from "../chatops/chatops.errors";
import { SlackOnCallRepository } from "./slack.on-call.repository";

/** A member the page names. */
export interface OnCallMemberResource {
  /** The `member` row's id — what `PUT /chat/on-call` takes. */
  readonly memberId: string;
  readonly name: string;
}

/** The person on call. */
export interface OnCallDesigneeResource extends OnCallMemberResource {
  /**
   * Whether their Slack identity is linked on the workspace's active connection. False when the
   * connection has since stopped working: the assignment stands, and its DM reaches nobody.
   */
  readonly linked: boolean;
}

/** `GET|PUT /api/v1/chat/on-call`. */
export interface OnCallResource {
  /** The one scope this build assigns: the decisions that wait on a person. */
  readonly scope: typeof ON_CALL_SCOPE;
  /** The active assignment's person, or null when nobody is on call. */
  readonly designee: OnCallDesigneeResource | null;
  /** When the designee was chosen, or null. */
  readonly assignedAt: string | null;
  /** The members who may be chosen — those with a linked Slack identity — by name. */
  readonly candidates: OnCallMemberResource[];
}

@Injectable()
export class SlackOnCallService {
  /**
   * @param repository - The assignments and the members a DM could reach.
   * @param audit - The audit plane.
   */
  constructor(
    private readonly repository: SlackOnCallRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * Who is on call, and who could be.
   *
   * @param organizationId - The workspace.
   * @returns The designee and the candidates.
   */
  async read(organizationId: string): Promise<OnCallResource> {
    const [designee, linked] = await Promise.all([
      this.repository.designee(organizationId),
      this.repository.linkedMembers(organizationId),
    ]);

    return {
      scope: ON_CALL_SCOPE,
      designee:
        designee === undefined
          ? null
          : {
              memberId: designee.memberId,
              name: designee.name,
              linked: linked.some((member) => member.memberId === designee.memberId),
            },
      assignedAt: designee?.assignedAt.toISOString() ?? null,
      candidates: [...linked].sort(
        (a, b) => a.name.localeCompare(b.name) || a.memberId.localeCompare(b.memberId),
      ),
    };
  }

  /**
   * Put a member on call, or nobody. Naming whoever already is on call changes nothing and
   * records nothing.
   *
   * @param organizationId - The workspace.
   * @param actorId - The owner or admin choosing.
   * @param memberId - The member, or `null` to leave nobody on call.
   * @returns Who is on call after it.
   * @throws {NotFoundError} `404 chat_member_not_found` — not a member of this workspace.
   * @throws {InvalidRequestError} `422 chat_on_call_not_linked` — the member has no linked Slack
   *   identity on the workspace's active connection.
   */
  async assign(
    organizationId: string,
    actorId: string,
    memberId: string | null,
  ): Promise<OnCallResource> {
    if (memberId !== null) {
      const member = await this.repository.member(organizationId, memberId);

      if (member === undefined) {
        throw chatMemberNotFound();
      }

      const linked = await this.repository.linkedMembers(organizationId);

      if (!linked.some((candidate) => candidate.memberId === memberId)) {
        throw chatOnCallNotLinked(member.name);
      }
    }

    const change = await this.repository.transaction(async (trx) => {
      const previous = await this.repository.lockActive(trx, organizationId);

      if (previous === memberId) {
        return undefined;
      }

      if (previous !== null) {
        await this.repository.standDown(trx, organizationId);
      }
      if (memberId !== null) {
        await this.repository.assign(trx, organizationId, memberId, actorId);
      }

      return { previous };
    });

    if (change !== undefined) {
      await this.audit.record({
        organizationId,
        actorId,
        action: CHAT_ON_CALL_CHANGED_EVENT,
        subjectType: "on_call_assignment",
        subjectId: ON_CALL_SCOPE,
        at: new Date(),
        detail: { scope: ON_CALL_SCOPE, previousMemberId: change.previous, memberId },
      });
    }

    return this.read(organizationId);
  }
}
