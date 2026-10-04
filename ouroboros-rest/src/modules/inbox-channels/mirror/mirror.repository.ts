/**
 * Every statement the GitHub mirror issues (BN.3, [#463](https://github.com/NobuData/ouroboros/issues/463))
 * — V100's `decision_channel_mirrors`, plus the item, resolution and PR reads a comment is composed
 * from. Raw SQL: the mirror table is not part of REST's schema mirror.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type { DecisionChannel, DecisionItemStatus, DecisionSeverity } from "../../db/schema";

/** Why an item has no comment (V100). */
export type MirrorSkipReason = "no_pr" | "no_comment_surface";

/** An item's mirror row. */
export interface MirrorRow {
  readonly itemId: string;
  readonly organizationId: string;
  readonly revision: number;
  readonly shownRevision: number | null;
  readonly prId: string | null;
  readonly commentId: string | null;
  readonly commentUrl: string | null;
  readonly skipReason: MirrorSkipReason | null;
  readonly lastError: string | null;
  readonly attempts: number;
}

/** The item a comment is composed from. */
export interface MirrorItem {
  readonly id: string;
  readonly organizationId: string;
  readonly kindId: string;
  readonly kindVersion: number;
  readonly severity: DecisionSeverity;
  readonly status: DecisionItemStatus;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly refs: unknown;
}

/** An item's resolution, with the person's name. */
export interface MirrorResolutionRow {
  readonly resolver: "human" | "policy";
  readonly policy: string | null;
  readonly actionId: string;
  readonly actorName: string | null;
  readonly channel: DecisionChannel;
  readonly resolvedAt: Date;
}

/** A mirrored PR — where a comment goes. */
export interface MirrorPr {
  readonly id: string;
  readonly sourceId: string;
  readonly number: number;
}

/** Where a comment landed. */
export interface PostedComment {
  readonly prId: string;
  readonly commentId: string;
  readonly commentUrl: string | null;
}

/** The longest failure reason a mirror row keeps (V100). */
export const MAX_MIRROR_ERROR = 500;

@Injectable()
export class MirrorRepository {
  /** @param database - The service's connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Record that an item changed: create its mirror row at revision 1, or bump the revision.
   *
   * @param organizationId - The item's workspace.
   * @param itemId - The item.
   * @returns The revision the change is.
   */
  async bump(organizationId: string, itemId: string): Promise<number> {
    const { rows } = await sql<{ revision: number }>`
      insert into ouroboros.decision_channel_mirrors (item_id, organization_id)
      values (${itemId}, ${organizationId})
      on conflict (item_id) do update
         set revision = ouroboros.decision_channel_mirrors.revision + 1,
             updated_at = now()
      returning revision`.execute(this.database.db);

    return rows[0]?.revision ?? 1;
  }

  /**
   * An item's mirror row.
   *
   * @param itemId - The item.
   * @returns The row, or undefined when the item never changed since V100.
   */
  async row(itemId: string): Promise<MirrorRow | undefined> {
    const { rows } = await sql<{
      item_id: string;
      organization_id: string;
      revision: number;
      shown_revision: number | null;
      pr_id: string | null;
      comment_id: string | null;
      comment_url: string | null;
      skip_reason: MirrorSkipReason | null;
      last_error: string | null;
      attempts: number;
    }>`
      select item_id, organization_id, revision, shown_revision, pr_id, comment_id, comment_url,
             skip_reason, last_error, attempts
        from ouroboros.decision_channel_mirrors where item_id = ${itemId}`.execute(
      this.database.db,
    );
    const [row] = rows;

    return row === undefined
      ? undefined
      : {
          itemId: row.item_id,
          organizationId: row.organization_id,
          revision: row.revision,
          shownRevision: row.shown_revision,
          prId: row.pr_id,
          commentId: row.comment_id,
          commentUrl: row.comment_url,
          skipReason: row.skip_reason,
          lastError: row.last_error,
          attempts: row.attempts,
        };
  }

  /**
   * The item a comment is composed from.
   *
   * @param itemId - The item.
   * @returns The item, or undefined.
   */
  async item(itemId: string): Promise<MirrorItem | undefined> {
    const { rows } = await sql<{
      id: string;
      organization_id: string;
      kind_id: string;
      kind_version: number;
      severity: DecisionSeverity;
      status: DecisionItemStatus;
      payload: Record<string, unknown>;
      refs: unknown;
    }>`
      select id, organization_id, kind_id, kind_version, severity, status, payload, refs
        from ouroboros.decision_items where id = ${itemId}`.execute(this.database.db);
    const [row] = rows;

    return row === undefined
      ? undefined
      : {
          id: row.id,
          organizationId: row.organization_id,
          kindId: row.kind_id,
          kindVersion: row.kind_version,
          severity: row.severity,
          status: row.status,
          payload: row.payload,
          refs: row.refs,
        };
  }

  /**
   * An item's resolution.
   *
   * @param itemId - The item.
   * @returns Who, how and when, or undefined while it is unanswered.
   */
  async resolution(itemId: string): Promise<MirrorResolutionRow | undefined> {
    const { rows } = await sql<{
      resolver: "human" | "policy";
      resolved_by_policy: string | null;
      action_id: string;
      person_name: string | null;
      channel: DecisionChannel;
      resolved_at: Date;
    }>`
      select r.resolver, r.resolved_by_policy, r.action_id, u."name" as person_name, r.channel,
             r.resolved_at
        from ouroboros.decision_resolutions r
        left join ouroboros."user" u on u."id" = r.resolved_by_user
       where r.item_id = ${itemId}`.execute(this.database.db);
    const [row] = rows;

    return row === undefined
      ? undefined
      : {
          resolver: row.resolver,
          policy: row.resolved_by_policy,
          actionId: row.action_id,
          actorName: row.person_name,
          channel: row.channel,
          resolvedAt: row.resolved_at,
        };
  }

  /**
   * A mirrored PR of the workspace.
   *
   * @param organizationId - The workspace.
   * @param prId - `pull_requests.id`.
   * @returns The PR, or undefined.
   */
  async pr(organizationId: string, prId: string): Promise<MirrorPr | undefined> {
    const { rows } = await sql<{ id: string; source_id: string; external_number: number }>`
      select id, source_id, external_number from ouroboros.pull_requests
       where organization_id = ${organizationId} and id = ${prId}::uuid`.execute(this.database.db);

    return rows[0] === undefined ? undefined : prOf(rows[0]);
  }

  /**
   * The PR a run opened — its latest, when it opened several.
   *
   * @param organizationId - The workspace.
   * @param runId - `runs.id`.
   * @returns The PR, or undefined while the run has opened none.
   */
  async prForRun(organizationId: string, runId: string): Promise<MirrorPr | undefined> {
    const { rows } = await sql<{ id: string; source_id: string; external_number: number }>`
      select id, source_id, external_number from ouroboros.pull_requests
       where organization_id = ${organizationId} and run_id = ${runId}::uuid
       order by created_at desc, id desc
       limit 1`.execute(this.database.db);

    return rows[0] === undefined ? undefined : prOf(rows[0]);
  }

  /**
   * Record a publish the host accepted, as of the revision it composed.
   *
   * @param itemId - The item.
   * @param revision - The revision the body was composed at.
   * @param posted - Where the comment is.
   */
  async recordPosted(itemId: string, revision: number, posted: PostedComment): Promise<void> {
    await sql`
      update ouroboros.decision_channel_mirrors
         set shown_revision = greatest(coalesce(shown_revision, 0), ${revision}::integer),
             pr_id = ${posted.prId}::uuid,
             comment_id = ${posted.commentId},
             comment_url = ${posted.commentUrl},
             skip_reason = null,
             last_error = null,
             attempts = 0,
             updated_at = now()
       where item_id = ${itemId}`.execute(this.database.db);
  }

  /**
   * Record why an item has no comment.
   *
   * @param itemId - The item.
   * @param reason - Why.
   */
  async recordSkipped(itemId: string, reason: MirrorSkipReason): Promise<void> {
    await sql`
      update ouroboros.decision_channel_mirrors
         set skip_reason = ${reason}, last_error = null, attempts = 0, updated_at = now()
       where item_id = ${itemId} and comment_id is null`.execute(this.database.db);
  }

  /**
   * Record a failed publish — never raised, so the item is untouched.
   *
   * @param itemId - The item.
   * @param error - Why, cut to {@link MAX_MIRROR_ERROR}.
   */
  async recordFailed(itemId: string, error: string): Promise<void> {
    const reason = error.trim().slice(0, MAX_MIRROR_ERROR) || "the host refused the comment";

    await sql`
      update ouroboros.decision_channel_mirrors
         set last_error = ${reason}, attempts = attempts + 1, updated_at = now()
       where item_id = ${itemId}`.execute(this.database.db);
  }

  /**
   * Items whose comment is behind and still worth retrying, oldest change first.
   *
   * @param maxAttempts - Failures in a row after which an item is left alone until it changes.
   * @param limit - The most to return.
   * @returns The item ids.
   */
  async pending(maxAttempts: number, limit: number): Promise<string[]> {
    const { rows } = await sql<{ item_id: string }>`
      select item_id from ouroboros.decision_channel_mirrors
       where shown_revision is distinct from revision
         and skip_reason is null
         and attempts < ${maxAttempts}::integer
       order by updated_at, item_id
       limit ${limit}::integer`.execute(this.database.db);

    return rows.map((row) => row.item_id);
  }
}

/**
 * A row as a {@link MirrorPr}.
 *
 * @param row - The selected columns.
 * @returns The PR.
 */
function prOf(row: { id: string; source_id: string; external_number: number }): MirrorPr {
  return { id: row.id, sourceId: row.source_id, number: row.external_number };
}
