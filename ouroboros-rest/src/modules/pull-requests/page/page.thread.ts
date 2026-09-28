/**
 * `ThreadActionsService` — resolving an entry of the PR's review thread
 * ([#368](https://github.com/NobuData/ouroboros/issues/368)).
 *
 * ```
 * POST …/thread/{entryId}/resolve {reply?, mirror?}
 *   ─▶ lock PR ─▶ lock entry ─▶ resolved = true, resolution_body = reply   (V057: one-way)
 *   ─▶ SPI commentPR, when `mirror`                                         — answered, never thrown
 *   ─▶ audit: pr_thread.resolved                                            — the person, never the reply
 * ```
 *
 * **Reply and resolve are one act.** V057 holds a resolving reply to a resolved entry
 * (`pr_thread_entries_resolution_when_resolved`) and fixes both afterwards, so
 * *was blocking → "Addressed in attempt 4" → resolved* is written once and stays written. An entry
 * already resolved is `409`, not an edit.
 *
 * **Nothing here writes an entry, and nothing can author one as a model.** The route raises the
 * lifecycle of a row that exists; who said what is untouched. The row does not record who
 * resolved it — the audit trail does.
 *
 * **A policy entry is not resolvable**: it states the rule that applied, not an objection.
 *
 * **Any PR state.** The thread is this plane's record, not the host's, so an entry left open on
 * a merged PR can still be closed out.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";

import { PR_THREAD_RESOLVED_EVENT } from "../../audit/audit.events";
import { AuditService } from "../../audit/audit.service";
import { annotationError } from "../criteria/criteria.service";
import { pullRequestNotFound } from "../criteria/criteria.errors";
import { PrSyncService } from "../pr-sync.service";
import type { PageActor, PageAudit } from "./page.actions";
import type { ResolveThreadEntryDto } from "./page.dto";
import {
  threadEntryNotFound,
  threadEntryNotResolvable,
  threadEntryResolved,
  threadMirrorNeedsReply,
} from "./page.errors";
import { threadMirrorBody, threadMirrorKey } from "./page.mirror";
import { PageRepository, type LockedPr, type PageStore, type ThreadRow } from "./page.repository";
import {
  threadEntryResource,
  type ThreadMirrorResource,
  type ThreadResolutionResource,
} from "./page.resources";

/** The host, as this service reaches it — `PrSyncService.comment`. */
export type ThreadHost = Pick<PrSyncService, "comment">;

/** What a refused mirror says when the refusal was not the host's own. */
export const MIRROR_FAILED = {
  code: "mirror_failed",
  message: "The reply could not be posted to the host.",
} as const;

@Injectable()
export class ThreadActionsService {
  private readonly logger = new Logger(ThreadActionsService.name);

  /**
   * @param store - The page's statements.
   * @param host - The PR sync service, for the optional mirror.
   * @param audit - The trail.
   */
  constructor(
    @Inject(PageRepository) private readonly store: PageStore,
    @Inject(PrSyncService) private readonly host: ThreadHost,
    @Inject(AuditService) private readonly audit: PageAudit,
  ) {}

  /**
   * Resolve an entry, with the reply that resolves it, and optionally mirror the reply to the host.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @param entryId - The entry.
   * @param actor - Who is resolving.
   * @param request - The reply, and whether to mirror it.
   * @returns The entry as it now stands, and how the mirror landed — `failed` with the host's
   *   refusal when it refused; the resolution stands either way.
   * @throws {InvalidRequestError} `pr_thread_mirror_needs_reply`.
   * @throws {NotFoundError} `pull_request_not_found`, `pr_thread_entry_not_found`.
   * @throws {ConflictError} `pr_thread_entry_resolved`, `pr_thread_entry_not_resolvable`.
   */
  async resolve(
    organizationId: string,
    prId: string,
    entryId: string,
    actor: PageActor,
    request: ResolveThreadEntryDto,
  ): Promise<ThreadResolutionResource> {
    const reply = request.reply ?? null;

    if (request.mirror === true && reply === null) {
      throw threadMirrorNeedsReply();
    }

    const { pr, before } = await this.store.transaction(async (tx) => {
      const locked = await tx.lockPr(organizationId, prId);

      if (locked === undefined) {
        throw pullRequestNotFound(prId);
      }

      const entry = await tx.lockThreadEntry(prId, entryId);

      if (entry === undefined) {
        throw threadEntryNotFound(prId, entryId);
      }

      if (entry.authorKind === "policy_bot") {
        throw threadEntryNotResolvable(entryId);
      }

      if (entry.resolved) {
        throw threadEntryResolved(entryId);
      }

      await tx.resolveThreadEntry(entryId, reply);

      return { pr: locked, before: entry };
    });

    const mirror =
      request.mirror === true && reply !== null
        ? await this.mirror(organizationId, pr, before, reply, actor.name)
        : ({ state: "not_requested", url: null, error: null } as const);

    await this.audit.record({
      organizationId,
      actorId: actor.id,
      action: PR_THREAD_RESOLVED_EVENT,
      subjectType: "pr_thread_entry",
      subjectId: entryId,
      at: new Date(),
      detail: {
        pr_id: prId,
        was_blocking: before.blocking,
        replied: reply !== null,
        mirror: mirror.state,
      },
    });

    const entry = await this.store.threadEntry(prId, entryId);

    if (entry === undefined) {
      // Entries are never deleted; only a cascade from a deleted PR could remove it.
      throw pullRequestNotFound(prId);
    }

    return { entry: threadEntryResource(entry), mirror };
  }

  /**
   * Post the reply to the host PR. Never throws for the host: the resolution is the product's
   * record, and the comment is a courtesy to people living there.
   *
   * @param organizationId - The workspace.
   * @param pr - The PR.
   * @param entry - The entry, as it stood before it was resolved.
   * @param reply - The resolving reply.
   * @param resolvedBy - The person's display name.
   * @returns How it landed.
   */
  private async mirror(
    organizationId: string,
    pr: LockedPr,
    entry: ThreadRow,
    reply: string,
    resolvedBy: string,
  ): Promise<ThreadMirrorResource> {
    try {
      const posted = await this.host.comment(organizationId, pr.sourceId, pr.number, {
        key: threadMirrorKey(entry.id),
        body: threadMirrorBody({ ...entry, reply, resolvedBy }),
      });

      return { state: "posted", url: posted.url, error: null };
    } catch (error) {
      const refusal = mirrorError(error);

      if (refusal.code === MIRROR_FAILED.code) {
        this.logger.error(`thread entry ${entry.id}'s mirror failed unexpectedly`, error);
      }

      return { state: "failed", url: null, error: refusal };
    }
  }
}

/**
 * What a refused mirror tells the caller — the waiver annotation's classification (#359), with
 * this surface's own words for a failure that was not the host's.
 *
 * @param error - What the host surface threw.
 * @returns `host_<class>` for a host refusal, the domain code for a source that cannot post, and
 *   {@link MIRROR_FAILED} for anything else.
 */
export function mirrorError(error: unknown): { code: string; message: string } {
  const refusal = annotationError(error);

  return refusal.code === "annotation_failed" ? { ...MIRROR_FAILED } : refusal;
}
