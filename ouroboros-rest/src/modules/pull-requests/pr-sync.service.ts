/**
 * `PrSyncService` — one mirrored PR brought up to date with its host, and each new push recorded as
 * a revision with the file snapshot the changed-files card needs.
 *
 * AX.1 ([#357](https://github.com/NobuData/ouroboros/issues/357)), the writer V052's header names
 * for `pull_requests`' and `pr_revisions`' sync-owned columns.
 *
 * ```
 * sync(org, source, #514)
 *   ├─ source, inside the workspace asking                         (isolation)
 *   ├─ registry.find(kind) → supportsPullRequests, or 409           (SPI only — never a provider import)
 *   ├─ mirror's latest head sha ─▶ provider.syncPR(ctx, #514, sha)  revision detection by head-sha change
 *   └─ applySync ── one transaction: snapshot · state by rule · revision N+1 when the head moved
 * ```
 *
 * **Why the host is asked with the mirror's head.** The provider cannot know which pushes the
 * mirror has seen, and the mirror cannot know which the host has had; handing the latest recorded
 * sha across the SPI is the whole of how a revision is detected, and it is by sha rather than by
 * time — a comment moves a PR's stamp and is not a push.
 *
 * **The credential is opened for one call**, by `TicketSourcesService.withCredentials`, exactly as
 * the intake loop and the push service open it.
 *
 * Nothing calls this on a schedule yet: the gate engine (#358) and merge executor (#360) are its
 * callers, and a `prEvents` poll loop joins them there. The service is the contract they build on.
 */

import { Inject, Injectable } from "@nestjs/common";

import type { TicketSourceKind } from "../db/schema";
import {
  supportsPullRequests,
  type PrCapableProvider,
  type TicketSyncContext,
} from "../ticket-sources/ticket-source.provider";
import { TicketSourceRegistry } from "../ticket-sources/ticket-source.registry";
import type { SyncSource } from "../ticket-sources/ticket-sources.repository";
import { TicketSourcesService } from "../ticket-sources/ticket-sources.service";
import { prSourceHasNoPullRequests, prSourceNotFound } from "./pr-sync.errors";
import { PrMirrorRepository, type PrMirrorStore, type PrSyncOutcome } from "./pr-sync.repository";

/** What opens a source's credential for one call — `TicketSourcesService.withCredentials`. */
export interface PrSourceOpener {
  /**
   * @param source - The source.
   * @param run - What to do with the opened context.
   * @returns What `run` returned.
   */
  withCredentials<T>(
    source: SyncSource,
    run: (context: TicketSyncContext) => Promise<T>,
  ): Promise<T>;
}

@Injectable()
export class PrSyncService {
  /**
   * @param store - The mirror's statements.
   * @param registry - The providers, by kind.
   * @param sources - What opens a source's credential for one call.
   */
  constructor(
    @Inject(PrMirrorRepository) private readonly store: PrMirrorStore,
    private readonly registry: TicketSourceRegistry,
    @Inject(TicketSourcesService) private readonly sources: PrSourceOpener,
  ) {}

  /**
   * Bring one PR's mirror up to date, recording a revision when its head moved.
   *
   * @param organizationId - The workspace asking.
   * @param sourceId - The git-host source the PR lives on.
   * @param prNumber - The host's number.
   * @returns What was written.
   * @throws {NotFoundError} `pr_source_not_found` for a source the workspace does not have.
   * @throws {ConflictError} `pr_source_has_no_pull_requests` for a tracker without PRs.
   * @throws {TicketSourceError} The host's refusal, classified by the provider.
   */
  async sync(organizationId: string, sourceId: string, prNumber: number): Promise<PrSyncOutcome> {
    const source = await this.store.source(organizationId, sourceId);

    if (source === undefined) {
      throw prSourceNotFound(sourceId);
    }

    const provider = this.prHost(source.kind, sourceId);
    const mirrored = await this.store.mirrored(sourceId, prNumber);
    const synced = await this.sources.withCredentials(source, (context) =>
      provider.syncPR(context, prNumber, mirrored?.headSha ?? null),
    );

    return this.store.applySync({ source, snapshot: synced.pr, revision: synced.revision });
  }

  /**
   * The provider for a kind, narrowed to one with pull requests.
   *
   * @param kind - The source's kind.
   * @param sourceId - The source, for the refusal.
   * @returns The provider.
   * @throws {ConflictError} When nothing registered for the kind has PRs.
   */
  private prHost(kind: TicketSourceKind, sourceId: string): PrCapableProvider {
    const provider = this.registry.find(kind);

    if (provider === undefined || !supportsPullRequests(provider)) {
      throw prSourceHasNoPullRequests(sourceId);
    }

    return provider;
  }
}
