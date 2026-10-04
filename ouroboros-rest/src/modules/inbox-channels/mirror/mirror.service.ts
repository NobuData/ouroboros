/**
 * `DecisionMirrorService` — every decision mirrored as **one** PR comment, edited when it changes
 * (BN.3, [#463](https://github.com/NobuData/ouroboros/issues/463), decision **X5**).
 *
 * ```
 * lifecycle filed | refreshed | resolved ─▶ bump the item's mirror revision      (never blocks)
 *                                        ─▶ sync, serialised per item:
 *   target: the item's pr ref ─┐
 *           else its run's PR ─┴▶ none → skip_reason no_pr
 *   compose from the item as it stands (open · resolved receipt · expired)
 *   PrSyncService.comment(org, source, #n, {key: decision-<id>, body})   (the SPI, decision V9)
 *     ├─ accepted → shown_revision = the revision composed, comment ref stored
 *     ├─ the source has no PRs → skip_reason no_comment_surface
 *     └─ anything else → last_error, attempts + 1; the sweep retries
 * ```
 *
 * **Never a second comment.** The stored comment ref is keyed by item; the SPI's marker is keyed by
 * item too, so even a lost row edits rather than reposts. A retry or a redeploy composes the same
 * body from the same rows.
 *
 * **Honest degradation.** Nothing here throws into an emitter: the lifecycle contract says a
 * listener must not block or throw, so a sync runs after the change committed and its failure is a
 * row, not an exception. The item exists regardless.
 *
 * **Provider-agnostic.** The host is reached only through `PrSyncService.comment`, which narrows to
 * a provider with the PR capability — GitLab mirroring follows when its provider implements it.
 */

import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import { AppConfigService } from "../../config/config.service";
import { DecisionKindRegistry } from "../../decisions/decision-kind.registry";
import {
  DecisionLifecycle,
  type DecisionLifecycleEvent,
  type DecisionLifecycleListener,
} from "../../decisions/decision.lifecycle";
import type { DecisionRef } from "../../decisions/decision.types";
import { refsOf } from "../../decisions/inbox.compose";
import { DomainError } from "../../errors/error.envelope";
import { describeForLog } from "../../errors/failure";
import { PR_SYNC_ERRORS } from "../../pull-requests/pr-sync.errors";
import { PrSyncService } from "../../pull-requests/pr-sync.service";
import { composeMirrorComment, mirrorCommentKey } from "./mirror.compose";
import { MirrorRepository, type MirrorItem, type MirrorPr } from "./mirror.repository";

/** Failures in a row after which the sweep leaves an item alone until it changes again. */
export const MAX_MIRROR_ATTEMPTS = 5;

/** How many behind items one sweep retries. */
export const MIRROR_SWEEP_LIMIT = 50;

/** What one sync did — for the sweep's report and the specs. */
export type MirrorSyncOutcome = "posted" | "skipped" | "failed" | "current" | "gone";

@Injectable()
export class DecisionMirrorService
  implements DecisionLifecycleListener, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DecisionMirrorService.name);

  /** The sync in flight per item, so two changes of one item publish one after the other. */
  private readonly inFlight = new Map<string, Promise<MirrorSyncOutcome>>();

  /** Unregisters the listener. */
  private unregister?: () => void;

  /**
   * @param repository - The mirror rows and the reads a comment needs.
   * @param registry - The kinds, pinned, and their Markdown rendering.
   * @param host - The PR plane's only way to the SPI's `commentPR`.
   * @param lifecycle - Where filed, refreshed and resolved are heard.
   * @param config - `OURO_UI_URL`, for the deep links.
   */
  constructor(
    private readonly repository: MirrorRepository,
    private readonly registry: DecisionKindRegistry,
    private readonly host: PrSyncService,
    private readonly lifecycle: DecisionLifecycle,
    private readonly config: AppConfigService,
  ) {}

  /** Start hearing the lifecycle. */
  onModuleInit(): void {
    this.unregister = this.lifecycle.add(this);
  }

  /** Stop hearing it. */
  onModuleDestroy(): void {
    this.unregister?.();
  }

  /**
   * Hear one change: bump the revision and sync, after the caller has moved on.
   *
   * @param event - What happened.
   */
  decisionChanged(event: DecisionLifecycleEvent): void {
    void this.changed(event.organizationId, event.itemId);
  }

  /**
   * Record a change and bring the comment up to date. Never throws.
   *
   * @param organizationId - The item's workspace.
   * @param itemId - The item.
   * @returns What the sync did.
   */
  async changed(organizationId: string, itemId: string): Promise<MirrorSyncOutcome> {
    try {
      await this.repository.bump(organizationId, itemId);
    } catch (error) {
      this.logger.error(`Could not record a change of decision ${itemId}.`, describeForLog(error));

      return "failed";
    }

    return this.sync(itemId);
  }

  /**
   * Retry every item whose comment is behind — the scheduler's pass.
   *
   * @returns What each retry did, by item.
   */
  async sweep(): Promise<Map<string, MirrorSyncOutcome>> {
    const outcomes = new Map<string, MirrorSyncOutcome>();

    for (const itemId of await this.repository.pending(MAX_MIRROR_ATTEMPTS, MIRROR_SWEEP_LIMIT)) {
      outcomes.set(itemId, await this.sync(itemId));
    }

    return outcomes;
  }

  /**
   * Bring one item's comment up to date, after any sync of it already running. Never throws.
   *
   * @param itemId - The item.
   * @returns What it did.
   */
  sync(itemId: string): Promise<MirrorSyncOutcome> {
    const previous = this.inFlight.get(itemId) ?? Promise.resolve<MirrorSyncOutcome>("current");
    const next = previous.then(() => this.publish(itemId));

    this.inFlight.set(itemId, next);

    return next.finally(() => {
      if (this.inFlight.get(itemId) === next) {
        this.inFlight.delete(itemId);
      }
    });
  }

  /**
   * One publish — see the file header.
   *
   * @param itemId - The item.
   * @returns What it did.
   */
  private async publish(itemId: string): Promise<MirrorSyncOutcome> {
    try {
      const row = await this.repository.row(itemId);
      const item = await this.repository.item(itemId);

      if (row === undefined || item === undefined) {
        return "gone";
      }

      if (row.shownRevision === row.revision) {
        return "current";
      }

      const refs = refsOf(item.refs);
      const pr = await this.target(item, refs, row.prId);

      if (pr === undefined) {
        await this.repository.recordSkipped(itemId, "no_pr");

        return "skipped";
      }

      const body = await this.compose(item, refs);

      try {
        const posted = await this.host.comment(item.organizationId, pr.sourceId, pr.number, {
          key: mirrorCommentKey(item.id),
          body,
        });

        await this.repository.recordPosted(itemId, row.revision, {
          prId: pr.id,
          commentId: posted.commentId,
          commentUrl: posted.url,
        });

        return "posted";
      } catch (error) {
        if (error instanceof DomainError && error.code === PR_SYNC_ERRORS.noPullRequests) {
          await this.repository.recordSkipped(itemId, "no_comment_surface");

          return "skipped";
        }

        throw error;
      }
    } catch (error) {
      this.logger.warn(`Mirroring decision ${itemId} failed; it will be retried.`);
      await this.repository
        .recordFailed(itemId, error instanceof Error ? error.message : String(error))
        .catch((recordError: unknown) => {
          this.logger.error(
            `Could not record the mirror failure of decision ${itemId}.`,
            describeForLog(recordError),
          );
        });

      return "failed";
    }
  }

  /**
   * Where an item's comment goes: the PR it already lives on, its pr ref, or its run's PR.
   *
   * @param item - The item.
   * @param refs - Its refs.
   * @param knownPrId - The PR a comment was already posted on, if any.
   * @returns The PR, or undefined when the item names none and its run opened none.
   */
  private async target(
    item: MirrorItem,
    refs: readonly DecisionRef[],
    knownPrId: string | null,
  ): Promise<MirrorPr | undefined> {
    for (const prId of [knownPrId, refs.find((ref) => ref.type === "pr")?.id]) {
      if (prId !== undefined && prId !== null) {
        const pr = await this.repository.pr(item.organizationId, prId);

        if (pr !== undefined) {
          return pr;
        }
      }
    }

    const run = refs.find((ref) => ref.type === "run");

    return run === undefined ? undefined : this.repository.prForRun(item.organizationId, run.id);
  }

  /**
   * The comment as the item stands now.
   *
   * @param item - The item.
   * @param refs - Its refs.
   * @returns The Markdown body.
   */
  private async compose(item: MirrorItem, refs: readonly DecisionRef[]): Promise<string> {
    const kind = await this.registry.pinnedKind(item.kindId, item.kindVersion);
    const resolution =
      item.status === "resolved" ? await this.repository.resolution(item.id) : undefined;

    return composeMirrorComment({
      itemId: item.id,
      severity: item.severity,
      prose: this.registry.render(kind, item.payload, "markdown"),
      refs,
      resolution,
      expired: item.status === "expired",
      uiUrl: this.config.uiUrl,
    });
  }
}
