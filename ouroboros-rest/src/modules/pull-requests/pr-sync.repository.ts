/**
 * Every statement the PR sync issues — reading the source and the mirror's latest head, and the one
 * transaction that writes a snapshot and, when the head moved, the next `pr_revisions` row.
 *
 * AX.1 ([#357](https://github.com/NobuData/ouroboros/issues/357)), over V052's tables
 * ([#352](https://github.com/NobuData/ouroboros/issues/352)).
 *
 * ## Only the sync-owned columns are written
 *
 * V052 splits `pull_requests` in two: the host's content, which only this sync writes, and the
 * verification plane's `run_id` and `ticket_id`, which it never touches. `state` is shared by rule,
 * and `mirroredState` is that rule. `pr_revisions.run_stage_id` is the plane's too.
 *
 * ## One transaction, with the PR row locked
 *
 * The snapshot and the revision land together or not at all, and the row is read `for update` so
 * two syncs of one PR serialise: the second finds the first's revision and adds nothing. A revision
 * whose head is already recorded is a no-op (`on conflict (pr_id, head_sha) do nothing`), which is
 * what makes a re-sync idempotent — a revision is identified by its sha, never by when it was seen.
 *
 * ## An unchanged PR is not updated
 *
 * `pull_requests_touch_updated_at` is unconditional, so — as in `ticket-sources.repository.ts` —
 * the only way to keep `updated_at` meaning *something changed* is to not issue the update.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import type { PullRequestState } from "../db/schema";
import type { PrRevisionSnapshot, PullRequestSnapshot } from "../ticket-sources/ticket-source.pr";
import type { SyncSource } from "../ticket-sources/ticket-sources.repository";
import { mirroredPath, mirroredState } from "./pr-sync.state";

/** The mirror's view of one PR — what a sync needs to know before asking the host. */
export interface MirroredPr {
  /** `pull_requests.id`. */
  readonly id: string;
  /** Where it stands. */
  readonly state: PullRequestState;
  /** The latest revision's head, or null when none is recorded. */
  readonly headSha: string | null;
}

/** What one sync asks to be written. */
export interface PrSyncWrite {
  /** The source it came from. */
  readonly source: SyncSource;
  /** The PR now. */
  readonly snapshot: PullRequestSnapshot;
  /** The push the mirror has not recorded, or null. */
  readonly revision: PrRevisionSnapshot | null;
}

/** What one sync wrote. */
export interface PrSyncOutcome {
  /** `pull_requests.id`. */
  readonly prId: string;
  /** The state now. */
  readonly state: PullRequestState;
  /** The latest revision's ordinal, or null when the PR has none. */
  readonly revisionSeq: number | null;
  /** Whether this sync recorded a revision. */
  readonly newRevision: boolean;
  /** Whether this sync created the mirror row. */
  readonly created: boolean;
}

/** The statements the PR sync needs — what its unit suite stands in for. */
export interface PrMirrorStore {
  /**
   * One source of the workspace, through the view without the credential.
   *
   * @param organizationId - The workspace asking.
   * @param sourceId - The source.
   * @returns It, or undefined when the workspace has no such source.
   */
  source(organizationId: string, sourceId: string): Promise<SyncSource | undefined>;
  /**
   * The mirror of one PR.
   *
   * @param sourceId - The source.
   * @param prNumber - The host's number.
   * @returns It, or undefined when it is not mirrored yet.
   */
  mirrored(sourceId: string, prNumber: number): Promise<MirroredPr | undefined>;
  /**
   * Write one sync — see this file's header.
   *
   * @param write - The snapshot and the revision.
   * @returns What was written.
   */
  applySync(write: PrSyncWrite): Promise<PrSyncOutcome>;
}

/** The PostgreSQL {@link PrMirrorStore}. */
@Injectable()
export class PrMirrorRepository implements PrMirrorStore {
  /**
   * @param database - The pool.
   */
  constructor(private readonly database: DatabaseService) {}

  /** @inheritdoc */
  async source(organizationId: string, sourceId: string): Promise<SyncSource | undefined> {
    const row = await this.database.db
      .selectFrom("ticket_sources_public")
      .select([
        "id",
        "organization_id",
        "kind",
        "display_name",
        "config",
        "sync_cursor",
        "synced_at",
      ])
      .where("organization_id", "=", organizationId)
      .where("id", "=", sourceId)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : {
          sourceId: row.id,
          organizationId: row.organization_id,
          kind: row.kind,
          displayName: row.display_name,
          config: row.config,
          cursor: row.sync_cursor,
          syncedAt: row.synced_at,
        };
  }

  /** @inheritdoc */
  async mirrored(sourceId: string, prNumber: number): Promise<MirroredPr | undefined> {
    const pr = await this.database.db
      .selectFrom("pull_requests")
      .select(["id", "state"])
      .where("source_id", "=", sourceId)
      .where("external_number", "=", prNumber)
      .executeTakeFirst();

    if (pr === undefined) {
      return undefined;
    }

    const latest = await this.database.db
      .selectFrom("pr_revisions")
      .select("head_sha")
      .where("pr_id", "=", pr.id)
      .orderBy("revision_seq", "desc")
      .limit(1)
      .executeTakeFirst();

    return { id: pr.id, state: pr.state, headSha: latest?.head_sha ?? null };
  }

  /** @inheritdoc */
  applySync(write: PrSyncWrite): Promise<PrSyncOutcome> {
    const { source, snapshot, revision } = write;
    const content = {
      external_url: snapshot.url,
      title: snapshot.title,
      head_branch: snapshot.headBranch,
      base_branch: snapshot.baseBranch,
      additions: snapshot.additions,
      deletions: snapshot.deletions,
      changed_files: snapshot.changedFiles,
      merged_at: snapshot.mergedAt,
      merged_by: snapshot.mergedBy,
    };

    return this.database.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom("pull_requests")
        .selectAll()
        .where("source_id", "=", source.sourceId)
        .where("external_number", "=", snapshot.number)
        .forUpdate()
        .executeTakeFirst();

      let prId: string;
      let state: PullRequestState;

      if (existing === undefined) {
        state = mirroredState(null, snapshot.state);

        const inserted = await trx
          .insertInto("pull_requests")
          .values({
            organization_id: source.organizationId,
            source_id: source.sourceId,
            external_number: snapshot.number,
            state,
            ...content,
          })
          .returning("id")
          .executeTakeFirstOrThrow();

        prId = inserted.id;
      } else {
        prId = existing.id;
        state = mirroredState(existing.state, snapshot.state);

        const path = mirroredPath(existing.state, snapshot.state);
        const changed =
          path.length > 0 ||
          (Object.keys(content) as (keyof typeof content)[]).some(
            (column) => !sameValue(existing[column], content[column]),
          );

        // A step V052 needs on the way — a reopen the sync missed — is written alone, so the
        // transition trigger sees each edge; the content lands with the last step.
        for (const step of path.slice(0, -1)) {
          await trx
            .updateTable("pull_requests")
            .set({ state: step })
            .where("id", "=", prId)
            .execute();
        }

        if (changed) {
          await trx
            .updateTable("pull_requests")
            .set({ ...content, state })
            .where("id", "=", prId)
            .execute();
        }
      }

      const latest = await trx
        .selectFrom("pr_revisions")
        .select((eb) => eb.fn.max("revision_seq").as("seq"))
        .where("pr_id", "=", prId)
        .executeTakeFirst();
      const latestSeq = latest?.seq ?? null;

      if (revision === null) {
        return {
          prId,
          state,
          revisionSeq: latestSeq,
          newRevision: false,
          created: existing === undefined,
        };
      }

      const recorded = await trx
        .insertInto("pr_revisions")
        .values({
          pr_id: prId,
          revision_seq: (latestSeq ?? 0) + 1,
          head_sha: revision.headSha,
          pushed_at: revision.pushedAt,
          files: JSON.stringify(
            revision.files.map(({ path, additions, deletions }) => ({
              path,
              additions,
              deletions,
            })),
          ),
          diff_excerpt: revision.diffExcerpt,
        })
        .onConflict((conflict) => conflict.columns(["pr_id", "head_sha"]).doNothing())
        .returning("revision_seq")
        .executeTakeFirst();

      return {
        prId,
        state,
        revisionSeq: recorded?.revision_seq ?? latestSeq,
        newRevision: recorded !== undefined,
        created: existing === undefined,
      };
    });
  }
}

/**
 * Whether a stored column and a snapshot's value are the same fact.
 *
 * @param stored - The row's value.
 * @param next - The snapshot's.
 * @returns `true` when equal — dates by instant.
 */
function sameValue(stored: unknown, next: unknown): boolean {
  if (stored instanceof Date && next instanceof Date) {
    return stored.getTime() === next.getTime();
  }

  return stored === next;
}
