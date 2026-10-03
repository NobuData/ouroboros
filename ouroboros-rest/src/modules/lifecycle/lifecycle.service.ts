/**
 * The Danger zone's operations (BR.5, [#489](https://github.com/NobuData/ouroboros/issues/489)):
 * pause, resume, disconnect, delete and restore. The purge is `lifecycle.purge.ts`.
 *
 * Every transition is one shape:
 *
 * ```
 * transaction { lock the row · check the move · write the state · side effects · outbox event }
 * then        audit row (a separate statement, as every writer of the trail does — AD.4)
 * ```
 *
 * Who may ask is decided by the controller's `@Roles()` — administrators pause, resume and
 * disconnect; only an owner deletes and restores. What this file adds is everything a role
 * cannot express: the confirmations, the typed name, the step-up, and which moves exist.
 */

import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";

import { AuditService } from "../audit/audit.service";
import {
  WORKSPACE_DELETE_REQUESTED_EVENT,
  WORKSPACE_DISCONNECTED_EVENT,
  WORKSPACE_PAUSED_EVENT,
  WORKSPACE_RESTORED_EVENT,
  WORKSPACE_RESUMED_EVENT,
  type AuditAction,
  type AuditDetail,
} from "../audit/audit.events";
import type { AuthRequest } from "../auth/http";
import type { Principal } from "../auth/principal";
import type { Database, WorkspaceLifecycleState } from "../db/schema";
import { GithubCredentialsService } from "../github/github.credentials.service";
import {
  STEP_UP_MAX_AGE_SECONDS,
  STEP_UP_METHODS,
  StepUpService,
} from "../provider-connections/step-up";
import { WORKSPACE_AUTH_STORE, type WorkspaceAuthStore } from "./lifecycle.auth";
import {
  confirmationRequired,
  nameMismatch,
  stateConflict,
  stepUpRequired,
} from "./lifecycle.errors";
import { LifecycleRepository } from "./lifecycle.repository";
import {
  disconnectPreview,
  lifecycleResource,
  type DisconnectPreviewResource,
  type LifecycleResource,
} from "./lifecycle.resources";
import { WorkspaceStateReader } from "./lifecycle.state";
import { LIFECYCLE_MOVES, canMove, purgeAfter, type LifecycleMove } from "./lifecycle.states";
import type { ConfirmDto, DeleteWorkspaceDto } from "./lifecycle.dto";

/**
 * The outbox event type for an audit action — the `audit.*` webhook family.
 *
 * @param action - The audit action.
 * @returns `audit.<action>`.
 */
export function outboxEventType(action: AuditAction): string {
  return `audit.${action}`;
}

/** What one transition hands the shared writer. */
interface Transition {
  /** The workspace. */
  readonly organizationId: string;
  /** Who asked — `"user".id`. */
  readonly actorId: string;
  /** The machine's move, or `null` for a disconnect from a workspace already paused. */
  readonly move: LifecycleMove | null;
  /** What the audit trail and the outbox call it. */
  readonly action: AuditAction;
  /** When. */
  readonly at: Date;
  /** Work inside the transaction, returning extra detail for the event. */
  readonly within?: (trx: Transaction<Database>) => Promise<AuditDetail>;
}

@Injectable()
export class LifecycleService {
  /**
   * @param lifecycle - The statements.
   * @param states - Where a workspace stands, for the read route.
   * @param audit - The trail.
   * @param github - The stored GitHub token, which a disconnect clears.
   * @param stepUp - The re-authentication a deletion charges.
   * @param auth - The library's rows: sessions to revoke.
   */
  constructor(
    private readonly lifecycle: LifecycleRepository,
    private readonly states: WorkspaceStateReader,
    private readonly audit: AuditService,
    private readonly github: GithubCredentialsService,
    private readonly stepUp: StepUpService,
    @Inject(WORKSPACE_AUTH_STORE) private readonly auth: WorkspaceAuthStore,
  ) {}

  /**
   * Where the workspace stands, with the app-wide banner.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns The resource.
   */
  async read(organizationId: string): Promise<LifecycleResource> {
    return lifecycleResource(await this.states.standing(organizationId));
  }

  /**
   * Pause all loops: running stages finish, nothing new starts.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who asked.
   * @param body - Must carry `confirm: true`.
   * @returns The workspace's lifecycle afterwards.
   * @throws {BadRequestError} `400 confirmation_required`.
   * @throws {ConflictError} `409 workspace_state_conflict` unless `active`.
   */
  async pause(
    organizationId: string,
    actorId: string,
    body: ConfirmDto,
  ): Promise<LifecycleResource> {
    if (body.confirm !== true) {
      throw confirmationRequired("pause");
    }

    await this.transition({
      organizationId,
      actorId,
      move: "pause",
      action: WORKSPACE_PAUSED_EVENT,
      at: new Date(),
    });

    return this.read(organizationId);
  }

  /**
   * Resume: the queue is released and the next stage may start. Nothing was lost while paused —
   * queued work stayed queued and every finished stage was recorded.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who asked.
   * @returns The workspace's lifecycle afterwards.
   * @throws {ConflictError} `409 workspace_state_conflict` unless `paused`.
   */
  async resume(organizationId: string, actorId: string): Promise<LifecycleResource> {
    await this.transition({
      organizationId,
      actorId,
      move: "resume",
      action: WORKSPACE_RESUMED_EVENT,
      at: new Date(),
    });

    return this.read(organizationId);
  }

  /**
   * What a disconnect would do, from live state.
   *
   * @param organizationId - The workspace.
   * @returns The counts and the sentences the confirm dialog lists.
   */
  async previewDisconnect(organizationId: string): Promise<DisconnectPreviewResource> {
    return disconnectPreview(await this.lifecycle.disconnectCounts(organizationId));
  }

  /**
   * Disconnect GitHub: pause all loops (so they halt cleanly rather than failing mid-stage), stop
   * every GitHub source syncing, and delete the stored token. Open pull requests are not touched —
   * they are on GitHub, and they stay there.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who asked.
   * @param body - Must carry `confirm: true`.
   * @returns The preview's counts as they stood when the disconnect ran.
   * @throws {BadRequestError} `400 confirmation_required`.
   * @throws {ConflictError} `409 workspace_state_conflict` while pending deletion.
   */
  async disconnect(
    organizationId: string,
    actorId: string,
    body: ConfirmDto,
  ): Promise<DisconnectPreviewResource> {
    if (body.confirm !== true) {
      throw confirmationRequired("disconnect");
    }

    const preview = await this.previewDisconnect(organizationId);
    const at = new Date();

    await this.transition({
      organizationId,
      actorId,
      // Disconnecting a workspace that is already paused keeps it paused: the move is the pause
      // when there is one to make, and none otherwise. `pending_delete` refuses either way.
      move: null,
      action: WORKSPACE_DISCONNECTED_EVENT,
      at,
      within: async (trx) => ({
        sources_paused: await this.lifecycle.pauseGithubSources(trx, organizationId),
        open_pull_requests: preview.openPullRequests,
        active_runs: preview.activeRuns,
      }),
    });

    // The token's own writer, so its audit row (`github.token_cleared`) is the same one a manual
    // clear writes. After the commit: a pause that rolled back must not have deleted the token.
    await this.github.clear({ organizationId, actorId, at });

    return preview;
  }

  /**
   * Request deletion: owner only (the controller), the exact name, and a recent step-up. The
   * workspace becomes `pending_delete` for `RECOVERY_WINDOW_DAYS` (30) days; every non-owner
   * session acting in it is revoked; every surface is frozen behind the recovery screen.
   *
   * @param organizationId - The workspace.
   * @param principal - The owner's session, whose step-up is checked.
   * @param request - The request, for the cookie a password step-up authenticates with.
   * @param body - The typed name and, optionally, the password.
   * @returns The workspace's lifecycle afterwards.
   * @throws {InvalidRequestError} `422 workspace_name_mismatch`.
   * @throws {UnauthenticatedError} `401 step_up_required`.
   * @throws {ConflictError} `409 workspace_state_conflict` when already pending deletion.
   */
  async requestDelete(
    organizationId: string,
    principal: Principal,
    request: AuthRequest,
    body: DeleteWorkspaceDto,
  ): Promise<LifecycleResource> {
    const identity = await this.lifecycle.identity(organizationId);

    // The name first: it costs nothing, and a wrong one should not spend a password check.
    if (identity === undefined || body.confirmName !== identity.name) {
      throw nameMismatch();
    }

    const at = new Date();

    if ((await this.stepUp.satisfied(principal, request, body.password, at)) === null) {
      throw stepUpRequired(STEP_UP_METHODS, STEP_UP_MAX_AGE_SECONDS);
    }

    const closes = purgeAfter(at);

    await this.transition({
      organizationId,
      actorId: principal.user.id,
      move: "delete",
      action: WORKSPACE_DELETE_REQUESTED_EVENT,
      at,
      within: () => Promise.resolve({ purge_after: closes.toISOString() }),
    });

    // After the commit, so a refused move revokes nobody. The freeze guard already refuses these
    // sessions; revoking them is what signs those people out rather than only stopping them.
    await this.auth.revokeSessions(organizationId, await this.lifecycle.ownerIds(organizationId));

    return this.read(organizationId);
  }

  /**
   * Restore a workspace pending deletion to `active`, at any point in its window.
   *
   * @param organizationId - The workspace.
   * @param actorId - The owner who restored it.
   * @returns The workspace's lifecycle afterwards.
   * @throws {ConflictError} `409 workspace_state_conflict` unless `pending_delete`.
   */
  async restore(organizationId: string, actorId: string): Promise<LifecycleResource> {
    await this.transition({
      organizationId,
      actorId,
      move: "restore",
      action: WORKSPACE_RESTORED_EVENT,
      at: new Date(),
    });

    return this.read(organizationId);
  }

  /**
   * The one writer every transition goes through.
   *
   * @param transition - What to move, who asked, and what else happens inside the transaction.
   * @throws {ConflictError} `409 workspace_state_conflict` when the move does not exist from the
   *   workspace's state.
   */
  private async transition(transition: Transition): Promise<void> {
    const { organizationId, actorId, action, at } = transition;

    const detail = await this.lifecycle.transaction(async (trx) => {
      const row = await this.lifecycle.lock(trx, organizationId);
      const from = row.state;
      const to = this.target(transition.move, from);
      const extra = (await transition.within?.(trx)) ?? {};

      if (to !== from) {
        await this.lifecycle.write(trx, {
          organizationId,
          state: to,
          changedBy: actorId,
          at,
          purgeAfter: to === "pending_delete" ? purgeAfter(at) : null,
        });
      }

      const eventDetail: AuditDetail = { from, to, ...extra };

      await this.lifecycle.enqueue(
        trx,
        organizationId,
        outboxEventType(action),
        { action, organizationId, actorId, at: at.toISOString(), ...eventDetail },
        at,
      );

      return eventDetail;
    });

    await this.audit.record({
      organizationId,
      actorId,
      action,
      subjectType: "workspace",
      subjectId: organizationId,
      at,
      detail: detail,
    });
  }

  /**
   * Where a move lands from a state — or the disconnect's rule when there is no move.
   *
   * @param move - The machine's move, or `null` for a disconnect.
   * @param from - Where the workspace stands.
   * @returns The new state.
   * @throws {ConflictError} When the move is not allowed from `from`.
   */
  private target(
    move: LifecycleMove | null,
    from: WorkspaceLifecycleState,
  ): WorkspaceLifecycleState {
    if (move === null) {
      if (from === "pending_delete") throw stateConflict("disconnect", from);
      return "paused";
    }

    if (!canMove(move, from)) {
      throw stateConflict(move, from);
    }

    return LIFECYCLE_MOVES[move].to;
  }
}
