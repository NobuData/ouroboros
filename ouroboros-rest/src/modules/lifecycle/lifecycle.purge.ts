/**
 * The day-30 purge — the one operation with no undo (BR.5,
 * [#489](https://github.com/NobuData/ouroboros/issues/489)).
 *
 * ```
 * 0. begin the tombstone      `workspace_tombstones`, purged_at null, DEK versions counted
 * 1. destroy the DEK          every version, first — the crypto-shred
 * 2. delete artifact objects  the object store, the plane a row delete cannot reach
 * 3. drop queued outbox rows  their subscribers are about to be deleted
 * 4. remove the organization  through BetterAuth; every tenant table cascades
 * 5. count what is left       every table naming the workspace — asserted zero
 * 6. complete + event         stamp purged_at and queue `audit.workspace.purged`, actor system
 * ```
 *
 * **The DEK goes first** so a purge interrupted at any later step has already made the live
 * ciphertext unreadable. **The tombstone goes before it** (V104,
 * [#490](https://github.com/NobuData/ouroboros/issues/490)): an unfinished tombstone is how the
 * next sweep finds a purge to resume — even after step 4 has cascaded the workspace's lifecycle
 * row away — and it is what makes a restore refuse a workspace whose keys may already be gone, so
 * no failure leaves a half-shredded tenant. The workspace's own `audit_events` rows cascade with
 * it (V022), so the purge's lasting record is the tombstone and the outbox event, which outlive it
 * on purpose.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";

import { WORKSPACE_PURGED_EVENT } from "../audit/audit.events";
import { describeForLog } from "../errors/failure";
import { ARTIFACT_STORE } from "../farm/artifacts/artifact.store.factory";
import type { ArtifactStore } from "../farm/artifacts/artifact.store";
import { storedKey } from "../test-results-read/results.service";
import { VaultService } from "../vault/vault.service";
import { auditEventTypes } from "../webhooks/webhook.registry";
import { WORKSPACE_AUTH_STORE, type WorkspaceAuthStore } from "./lifecycle.auth";
import { LifecycleRepository, type DuePurge } from "./lifecycle.repository";

/** What one purge did — what the tombstone records. */
export interface PurgeReport {
  readonly organizationId: string;
  readonly dekVersionsDestroyed: number;
  readonly artifactsDeleted: number;
  /** Artifacts whose bytes could not be removed — another driver's, or a store failure. */
  readonly artifactsFailed: number;
  /** Rows still naming the workspace afterwards. Zero, or the purge is reported as incomplete. */
  readonly rowsRemaining: number;
}

@Injectable()
export class LifecyclePurge {
  /** Where a purge is reported. */
  private readonly logger = new Logger(LifecyclePurge.name);

  /**
   * @param lifecycle - The statements.
   * @param vault - Whose `destroy` is the shred.
   * @param store - The artifact object store.
   * @param auth - The library's rows: the organization itself.
   */
  constructor(
    private readonly lifecycle: LifecycleRepository,
    private readonly vault: VaultService,
    @Inject(ARTIFACT_STORE) private readonly store: ArtifactStore,
    @Inject(WORKSPACE_AUTH_STORE) private readonly auth: WorkspaceAuthStore,
  ) {}

  /**
   * Purge every workspace whose recovery window has closed.
   *
   * @param now - The instant to judge against; a test advances it past the window.
   * @returns One report per workspace purged. A workspace whose purge threw is logged and
   *   resumed on the next sweep — its unfinished tombstone (or, before that was written, its
   *   `pending_delete` row) keeps it due.
   */
  async sweep(now: Date): Promise<PurgeReport[]> {
    const reports: PurgeReport[] = [];

    for (const due of await this.lifecycle.due(now)) {
      try {
        const report = await this.purge(due, now);

        if (report !== undefined) reports.push(report);
      } catch (error) {
        this.logger.error(
          `Workspace purge of ${due.organizationId} failed; retrying next sweep.`,
          describeForLog(error),
        );
      }
    }

    return reports;
  }

  /**
   * Purge one workspace — or resume a purge of it that began and did not finish.
   *
   * The tombstone is written first ({@link LifecycleRepository.beginPurge}), so every step after
   * it is found again by the next sweep however the attempt ends. Each step is safe to repeat:
   * destroying keys that are gone removes nothing, deleting an object that is gone succeeds,
   * and the organization is removed only while it exists. Completion stamps the tombstone and
   * queues `audit.workspace.purged` in one transaction, so the event is queued once.
   *
   * @param due - The workspace, and who asked for its deletion when.
   * @param now - When the purge runs.
   * @returns The report, or `undefined` when there is nothing to do — the workspace was restored,
   *   is gone with its purge complete, or another attempt completed it first.
   */
  async purge(due: DuePurge, now: Date): Promise<PurgeReport | undefined> {
    const { organizationId } = due;
    const found = await this.lifecycle.purgeRecord(organizationId);

    if (found?.purgedAt != null) {
      return undefined;
    }

    const record = found ?? (await this.lifecycle.beginPurge(due, now));

    if (record === undefined) {
      return undefined;
    }

    this.logger.warn(
      `${found === undefined ? "Purging" : "Resuming the purge of"} workspace ${organizationId} ` +
        `(${record.identity.name}); the DEK goes first.`,
    );

    await this.vault.destroy(organizationId);

    const { deleted, failed } = await this.deleteArtifacts(organizationId);

    await this.lifecycle.recordArtifacts(organizationId, deleted);
    await this.lifecycle.clearOutbox(organizationId);

    if ((await this.lifecycle.identity(organizationId)) !== undefined) {
      await this.auth.removeOrganization(organizationId);
    }

    const rowsRemaining = await this.lifecycle.residualRows(organizationId);

    if (rowsRemaining > 0) {
      this.logger.error(
        `Workspace purge of ${organizationId} left ${String(rowsRemaining)} row(s) naming it.`,
      );
    }

    const completed = await this.lifecycle.completePurge(organizationId, {
      now,
      rowsRemaining,
      event: (done) => ({
        types: auditEventTypes(WORKSPACE_PURGED_EVENT),
        payload: {
          action: WORKSPACE_PURGED_EVENT,
          organizationId,
          actorId: null,
          actor: "system",
          at: now.toISOString(),
          dek_versions_destroyed: done.dekVersionsDestroyed,
          artifacts_deleted: done.artifactsDeleted,
          rows_remaining: done.rowsRemaining,
        },
      }),
    });

    if (completed === undefined) {
      return undefined;
    }

    return {
      organizationId,
      dekVersionsDestroyed: completed.dekVersionsDestroyed,
      artifactsDeleted: completed.artifactsDeleted,
      artifactsFailed: failed,
      rowsRemaining,
    };
  }

  /**
   * Delete every stored artifact object of a workspace.
   *
   * @param organizationId - The workspace.
   * @returns How many objects were removed, and how many could not be.
   */
  private async deleteArtifacts(
    organizationId: string,
  ): Promise<{ deleted: number; failed: number }> {
    let deleted = 0;
    let failed = 0;

    for (const ref of await this.lifecycle.artifactRefs(organizationId)) {
      const key = storedKey(ref, this.store.driver);

      if (key === null) {
        // Another driver's object: this process cannot reach it. Counted, not hidden.
        failed += 1;
        continue;
      }

      try {
        await this.store.delete(key);
        deleted += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Workspace purge: an artifact of ${organizationId} could not be removed.`,
          describeForLog(error),
        );
      }
    }

    return { deleted, failed };
  }
}
