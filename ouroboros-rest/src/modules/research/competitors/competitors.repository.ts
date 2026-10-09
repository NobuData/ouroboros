/**
 * The competitor registry's tables — rivals, watches, the snapshot chain and its archive (V112,
 * V117; CL.3, [#616](https://github.com/NobuData/ouroboros/issues/616)).
 *
 * Every read and write a registry route, the scheduler or the tracker's query operations makes
 * goes through here. Workspace scoping is by join: a watch or snapshot has no organisation column
 * of its own, so every lookup joins its rival and filters on the rival's workspace — a caller can
 * never reach another workspace's row by guessing an id.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type {
  CompetitorCadence,
  CompetitorCheckOutcome,
  CompetitorSourceKind,
} from "../../db/schema";

/** A rival. */
export interface CompetitorRow {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

/** A watch, with its schedule. */
export interface WatchRow {
  readonly id: string;
  readonly competitorId: string;
  readonly sourceKind: CompetitorSourceKind;
  readonly url: string;
  readonly selector: string | null;
  readonly cadence: CompetitorCadence;
  readonly enabled: boolean;
  readonly renderRequired: boolean;
  readonly lastSnapshotAt: Date | null;
  readonly nextCheckAt: Date | null;
  readonly lastCheckedAt: Date | null;
  readonly lastSuccessAt: Date | null;
  readonly lastOutcome: CompetitorCheckOutcome | null;
  readonly lastNote: string | null;
  readonly createdAt: Date;
}

/** A watch the scheduler claimed, with what it needs to know about its rival. */
export interface ClaimedWatch extends WatchRow {
  readonly organizationId: string;
  readonly competitorName: string;
}

/** A watch's latest snapshot, with its archived text when there is one. */
export interface LatestSnapshot {
  readonly id: string;
  readonly contentHash: string;
  readonly takenAt: Date;
  /** The archived scoped text; null for a snapshot archived before V117 (a seed's). */
  readonly content: string | null;
}

/** A snapshot to write. */
export interface NewSnapshot {
  readonly id: string;
  readonly watchId: string;
  readonly previousId: string | null;
  readonly contentHash: string;
  readonly contentRef: string;
  readonly diff: string | null;
  readonly takenAt: Date;
  /** The scoped text the hash describes. */
  readonly content: string;
}

/** What one check found, as the watch records it. */
export interface CheckRecord {
  readonly checkedAt: Date;
  readonly outcome: CompetitorCheckOutcome;
  readonly note: string | null;
  /** Whether the check read the source — moves `last_success_at`. */
  readonly succeeded: boolean;
  readonly nextCheckAt: Date;
  /** Set when the page needs the render tier. */
  readonly renderRequired: boolean;
}

/** One recorded change: a snapshot with a diff, and where it came from. */
export interface ChangeRow {
  readonly snapshotId: string;
  readonly previousSnapshotId: string | null;
  readonly watchId: string;
  readonly competitorId: string;
  readonly competitorName: string;
  readonly sourceKind: CompetitorSourceKind;
  readonly url: string;
  readonly selector: string | null;
  readonly contentHash: string;
  readonly diff: string;
  readonly takenAt: Date;
}

/** How changes are narrowed. */
export interface ChangeQuery {
  readonly competitorId?: string;
  readonly sourceKind?: CompetitorSourceKind;
  /** Only changes taken at or after this instant. */
  readonly since?: Date;
  /** Only changes taken before this instant — the feed's cursor. */
  readonly before?: Date;
  readonly limit: number;
}

/** The tracker's sub-line, from V112's `competitor_tracker_summary`. */
export interface TrackerSummary {
  readonly rivalsWatched: number;
  readonly watchesEnabled: number;
  readonly sourceKinds: readonly CompetitorSourceKind[];
  /** `4 rivals watched · release notes, changelogs, filings`. */
  readonly subLine: string;
}

/** A rival's fields as written. */
export interface CompetitorFields {
  readonly name: string;
  readonly meta: Readonly<Record<string, unknown>>;
}

/** A watch's fields as created. */
export interface WatchFields {
  readonly sourceKind: CompetitorSourceKind;
  readonly url: string;
  readonly selector: string | null;
  readonly cadence: CompetitorCadence;
  readonly enabled: boolean;
}

/** What a watch edit may change. */
export interface WatchPatch {
  readonly cadence?: CompetitorCadence;
  readonly enabled?: boolean;
  /** Only ever `false`: an administrator asking for a JS-rendered page to be tried again. */
  readonly renderRequired?: false;
}

/** The columns a watch is read with. */
const WATCH_COLUMNS = [
  "w.id",
  "w.competitor_id",
  "w.source_kind",
  "w.url",
  "w.selector",
  "w.cadence",
  "w.enabled",
  "w.render_required",
  "w.last_snapshot_at",
  "w.next_check_at",
  "w.last_checked_at",
  "w.last_success_at",
  "w.last_outcome",
  "w.last_note",
  "w.created_at",
] as const;

/** The same columns, unqualified — what an insert or update returns. */
const WATCH_RETURNING = [
  "id",
  "competitor_id",
  "source_kind",
  "url",
  "selector",
  "cadence",
  "enabled",
  "render_required",
  "last_snapshot_at",
  "next_check_at",
  "last_checked_at",
  "last_success_at",
  "last_outcome",
  "last_note",
  "created_at",
] as const;

interface RawWatch {
  id: string;
  competitor_id: string;
  source_kind: CompetitorSourceKind;
  url: string;
  selector: string | null;
  cadence: CompetitorCadence;
  enabled: boolean;
  render_required: boolean;
  last_snapshot_at: Date | null;
  next_check_at: Date | null;
  last_checked_at: Date | null;
  last_success_at: Date | null;
  last_outcome: CompetitorCheckOutcome | null;
  last_note: string | null;
  created_at: Date;
}

/**
 * A watch row, in the shape the service speaks.
 *
 * @param row - The row.
 * @returns The watch.
 */
export function watchOf(row: RawWatch): WatchRow {
  return {
    id: row.id,
    competitorId: row.competitor_id,
    sourceKind: row.source_kind,
    url: row.url,
    selector: row.selector,
    cadence: row.cadence,
    enabled: row.enabled,
    renderRequired: row.render_required,
    lastSnapshotAt: row.last_snapshot_at,
    nextCheckAt: row.next_check_at,
    lastCheckedAt: row.last_checked_at,
    lastSuccessAt: row.last_success_at,
    lastOutcome: row.last_outcome,
    lastNote: row.last_note,
    createdAt: row.created_at,
  };
}

function competitorOf(row: {
  id: string;
  organization_id: string;
  name: string;
  meta: Record<string, unknown>;
  created_at: Date;
}): CompetitorRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    meta: row.meta,
    createdAt: row.created_at,
  };
}

@Injectable()
export class CompetitorsRepository {
  /** @param database - The connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The workspace's rivals, by name.
   *
   * @param organizationId - The workspace.
   * @returns Its rivals.
   */
  async listCompetitors(organizationId: string): Promise<CompetitorRow[]> {
    const rows = await this.database.db
      .selectFrom("competitors")
      .select(["id", "organization_id", "name", "meta", "created_at"])
      .where("organization_id", "=", organizationId)
      .orderBy(sql`lower(name)`)
      .execute();

    return rows.map(competitorOf);
  }

  /**
   * One rival of the workspace.
   *
   * @param organizationId - The workspace.
   * @param competitorId - The rival.
   * @returns It, or undefined when the workspace has no such rival.
   */
  async findCompetitor(
    organizationId: string,
    competitorId: string,
  ): Promise<CompetitorRow | undefined> {
    const row = await this.database.db
      .selectFrom("competitors")
      .select(["id", "organization_id", "name", "meta", "created_at"])
      .where("organization_id", "=", organizationId)
      .where("id", "=", competitorId)
      .executeTakeFirst();

    return row === undefined ? undefined : competitorOf(row);
  }

  /**
   * Add a rival.
   *
   * @param organizationId - The workspace.
   * @param fields - Name and meta.
   * @returns The rival.
   * @throws The unique index's violation for a name the workspace already has.
   */
  async createCompetitor(organizationId: string, fields: CompetitorFields): Promise<CompetitorRow> {
    const row = await this.database.db
      .insertInto("competitors")
      .values({
        organization_id: organizationId,
        name: fields.name,
        meta: JSON.stringify(fields.meta),
      })
      .returning(["id", "organization_id", "name", "meta", "created_at"])
      .executeTakeFirstOrThrow();

    return competitorOf(row);
  }

  /**
   * Edit a rival.
   *
   * @param organizationId - The workspace.
   * @param competitorId - The rival.
   * @param fields - What to change.
   * @returns The rival after the change, or undefined when there is no such rival.
   */
  async updateCompetitor(
    organizationId: string,
    competitorId: string,
    fields: Partial<CompetitorFields>,
  ): Promise<CompetitorRow | undefined> {
    const row = await this.database.db
      .updateTable("competitors")
      .set({
        ...(fields.name === undefined ? {} : { name: fields.name }),
        ...(fields.meta === undefined ? {} : { meta: JSON.stringify(fields.meta) }),
      })
      .where("organization_id", "=", organizationId)
      .where("id", "=", competitorId)
      .returning(["id", "organization_id", "name", "meta", "created_at"])
      .executeTakeFirst();

    return row === undefined ? undefined : competitorOf(row);
  }

  /**
   * Remove a rival and its watches.
   *
   * @param organizationId - The workspace.
   * @param competitorId - The rival.
   * @returns Whether there was such a rival.
   * @throws The deferred `source_records_snapshot_fk` violation, at commit, when an investigation
   *   cites one of its snapshots.
   */
  async deleteCompetitor(organizationId: string, competitorId: string): Promise<boolean> {
    const rows = await this.database.db
      .deleteFrom("competitors")
      .where("organization_id", "=", organizationId)
      .where("id", "=", competitorId)
      .returning("id")
      .execute();

    return rows.length > 0;
  }

  /**
   * The watches of the workspace's rivals — all of them, or one rival's.
   *
   * @param organizationId - The workspace.
   * @param competitorId - One rival, or undefined for every rival.
   * @returns The watches, oldest first.
   */
  async listWatches(organizationId: string, competitorId?: string): Promise<WatchRow[]> {
    let query = this.database.db
      .selectFrom("competitor_watches as w")
      .innerJoin("competitors as c", "c.id", "w.competitor_id")
      .select(WATCH_COLUMNS)
      .where("c.organization_id", "=", organizationId);

    if (competitorId !== undefined) query = query.where("w.competitor_id", "=", competitorId);

    const rows = await query.orderBy("w.created_at").orderBy("w.id").execute();
    return rows.map(watchOf);
  }

  /**
   * One watch of one of the workspace's rivals.
   *
   * @param organizationId - The workspace.
   * @param competitorId - The rival.
   * @param watchId - The watch.
   * @returns It, or undefined.
   */
  async findWatch(
    organizationId: string,
    competitorId: string,
    watchId: string,
  ): Promise<WatchRow | undefined> {
    const row = await this.database.db
      .selectFrom("competitor_watches as w")
      .innerJoin("competitors as c", "c.id", "w.competitor_id")
      .select(WATCH_COLUMNS)
      .where("c.organization_id", "=", organizationId)
      .where("w.competitor_id", "=", competitorId)
      .where("w.id", "=", watchId)
      .executeTakeFirst();

    return row === undefined ? undefined : watchOf(row);
  }

  /**
   * How many watches a rival has.
   *
   * @param competitorId - The rival.
   * @returns The count.
   */
  async countWatches(competitorId: string): Promise<number> {
    const row = await this.database.db
      .selectFrom("competitor_watches")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("competitor_id", "=", competitorId)
      .executeTakeFirstOrThrow();

    return Number(row.count);
  }

  /**
   * Add a watch to a rival the caller has already found in the workspace.
   *
   * @param competitorId - The rival.
   * @param fields - What to watch.
   * @returns The watch, due as soon as the scheduler can.
   * @throws `competitor_watches_target_key`'s violation for a watch the rival already has.
   */
  async createWatch(competitorId: string, fields: WatchFields): Promise<WatchRow> {
    const row = await this.database.db
      .insertInto("competitor_watches")
      .values({
        competitor_id: competitorId,
        source_kind: fields.sourceKind,
        url: fields.url,
        selector: fields.selector,
        cadence: fields.cadence,
        enabled: fields.enabled,
      })
      .returning(WATCH_RETURNING)
      .executeTakeFirstOrThrow();

    return watchOf(row);
  }

  /**
   * Edit a watch's schedule. Clearing `render_required` makes it due again.
   *
   * @param watchId - A watch the caller has already found in the workspace.
   * @param patch - What to change.
   * @returns The watch after the change, or undefined when it is gone.
   */
  async updateWatch(watchId: string, patch: WatchPatch): Promise<WatchRow | undefined> {
    const row = await this.database.db
      .updateTable("competitor_watches")
      .set({
        ...(patch.cadence === undefined ? {} : { cadence: patch.cadence }),
        ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
        ...(patch.renderRequired === false ? { render_required: false, next_check_at: null } : {}),
      })
      .where("id", "=", watchId)
      .returning(WATCH_RETURNING)
      .executeTakeFirst();

    return row === undefined ? undefined : watchOf(row);
  }

  /**
   * Remove a watch and its snapshots.
   *
   * @param watchId - A watch the caller has already found in the workspace.
   * @returns Whether it was there.
   * @throws The deferred `source_records_snapshot_fk` violation when a snapshot of it is cited.
   */
  async deleteWatch(watchId: string): Promise<boolean> {
    const rows = await this.database.db
      .deleteFrom("competitor_watches")
      .where("id", "=", watchId)
      .returning("id")
      .execute();

    return rows.length > 0;
  }

  /**
   * The tracker's sub-line for a workspace, from `competitor_tracker_summary`.
   *
   * @param organizationId - The workspace.
   * @returns The summary; zeros and no kinds when nothing is watched (the view has no row).
   */
  async summary(organizationId: string): Promise<TrackerSummary> {
    const { rows } = await sql<{
      rivals_watched: number;
      watches_enabled: number;
      source_kinds: CompetitorSourceKind[];
      sub_line: string;
    }>`
      select rivals_watched, watches_enabled, source_kinds, sub_line
        from ouroboros.competitor_tracker_summary
       where organization_id = ${organizationId}
    `.execute(this.database.db);
    const row = rows[0];

    if (row === undefined) {
      return { rivalsWatched: 0, watchesEnabled: 0, sourceKinds: [], subLine: "0 rivals watched" };
    }
    return {
      rivalsWatched: row.rivals_watched,
      watchesEnabled: row.watches_enabled,
      sourceKinds: row.source_kinds,
      subLine: row.sub_line,
    };
  }

  /**
   * Claim the watches that are due, so no other replica checks them meanwhile.
   *
   * One statement: the due rows are locked with `skip locked` (a replica claiming at the same
   * moment takes different rows) and their `next_check_at` moved to the lease's end, so a replica
   * that dies mid-check leaves its watches due again when the lease runs out rather than never.
   * Never-scheduled watches go first, then the longest overdue; `limit` bounds a tick, which is
   * what stops a restart — or a hundred new watches — from checking everything at once.
   *
   * @param now - The tick's instant.
   * @param limit - The most watches to claim.
   * @param leaseUntil - When an unfinished claim lapses.
   * @returns The claimed watches, with their workspace and rival name.
   */
  async claimDue(now: Date, limit: number, leaseUntil: Date): Promise<ClaimedWatch[]> {
    const { rows } = await sql<RawWatch & { organization_id: string; competitor_name: string }>`
      with due as (
        select w.id
          from ouroboros.competitor_watches w
         where w.enabled and not w.render_required
           and (w.next_check_at is null or w.next_check_at <= ${now})
         order by w.next_check_at nulls first, w.created_at, w.id
         limit ${limit}
           for update skip locked
      )
      update ouroboros.competitor_watches w
         set next_check_at = ${leaseUntil}
        from due, ouroboros.competitors c
       where w.id = due.id and c.id = w.competitor_id
      returning w.id, w.competitor_id, w.source_kind, w.url, w.selector, w.cadence, w.enabled,
                w.render_required, w.last_snapshot_at, w.next_check_at, w.last_checked_at,
                w.last_success_at, w.last_outcome, w.last_note, w.created_at,
                c.organization_id, c.name as competitor_name
    `.execute(this.database.db);

    return rows.map((row) => ({
      ...watchOf(row),
      organizationId: row.organization_id,
      competitorName: row.competitor_name,
    }));
  }

  /**
   * A watch's latest snapshot and its archived text.
   *
   * @param watchId - The watch.
   * @returns The snapshot, or undefined before the first.
   */
  async latestSnapshot(watchId: string): Promise<LatestSnapshot | undefined> {
    const row = await this.database.db
      .selectFrom("competitor_snapshots as s")
      .leftJoin("competitor_snapshot_contents as a", "a.snapshot_id", "s.id")
      .select(["s.id", "s.content_hash", "s.taken_at", "a.content"])
      .where("s.watch_id", "=", watchId)
      .orderBy("s.taken_at", "desc")
      .limit(1)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : { id: row.id, contentHash: row.content_hash, takenAt: row.taken_at, content: row.content };
  }

  /**
   * Write a snapshot and its archive, together.
   *
   * @param snapshot - The snapshot and the scoped text its hash describes.
   * @returns When both are committed.
   * @throws The chain trigger's violation when it is not the previous snapshot's successor.
   */
  async insertSnapshot(snapshot: NewSnapshot): Promise<void> {
    await this.database.transaction(async (trx) => {
      await trx
        .insertInto("competitor_snapshots")
        .values({
          id: snapshot.id,
          watch_id: snapshot.watchId,
          previous_id: snapshot.previousId,
          content_hash: snapshot.contentHash,
          content_ref: snapshot.contentRef,
          diff: snapshot.diff,
          taken_at: snapshot.takenAt,
        })
        .execute();
      await trx
        .insertInto("competitor_snapshot_contents")
        .values({ snapshot_id: snapshot.id, content: snapshot.content })
        .execute();
    });
  }

  /**
   * Record what a check found, and when the next one is due.
   *
   * @param watchId - The watch.
   * @param check - The check.
   * @returns When it is written.
   */
  async recordCheck(watchId: string, check: CheckRecord): Promise<void> {
    await this.database.db
      .updateTable("competitor_watches")
      .set({
        last_checked_at: check.checkedAt,
        last_outcome: check.outcome,
        last_note: check.note,
        next_check_at: check.nextCheckAt,
        ...(check.succeeded ? { last_success_at: check.checkedAt } : {}),
        ...(check.renderRequired ? { render_required: true } : {}),
      })
      .where("id", "=", watchId)
      .execute();
  }

  /**
   * The workspace's recorded changes, newest first.
   *
   * @param organizationId - The workspace.
   * @param query - Which rival, kind and window, and how many.
   * @returns The changes.
   */
  async changes(organizationId: string, query: ChangeQuery): Promise<ChangeRow[]> {
    let select = this.database.db
      .selectFrom("competitor_snapshots as s")
      .innerJoin("competitor_watches as w", "w.id", "s.watch_id")
      .innerJoin("competitors as c", "c.id", "w.competitor_id")
      .select([
        "s.id as snapshot_id",
        "s.previous_id",
        "s.watch_id",
        "c.id as competitor_id",
        "c.name as competitor_name",
        "w.source_kind",
        "w.url",
        "w.selector",
        "s.content_hash",
        "s.diff",
        "s.taken_at",
      ])
      .where("c.organization_id", "=", organizationId)
      .where("s.diff", "is not", null);

    if (query.competitorId !== undefined) select = select.where("c.id", "=", query.competitorId);
    if (query.sourceKind !== undefined)
      select = select.where("w.source_kind", "=", query.sourceKind);
    if (query.since !== undefined) select = select.where("s.taken_at", ">=", query.since);
    if (query.before !== undefined) select = select.where("s.taken_at", "<", query.before);

    const rows = await select
      .orderBy("s.taken_at", "desc")
      .orderBy("s.id", "desc")
      .limit(query.limit)
      .execute();

    return rows.map((row) => ({
      snapshotId: row.snapshot_id,
      previousSnapshotId: row.previous_id,
      watchId: row.watch_id,
      competitorId: row.competitor_id,
      competitorName: row.competitor_name,
      sourceKind: row.source_kind,
      url: row.url,
      selector: row.selector,
      contentHash: row.content_hash,
      diff: row.diff ?? "",
      takenAt: row.taken_at,
    }));
  }

  /**
   * A rival of the workspace found by id or by name (case-insensitively, or by an alias) — how
   * the research loop names one.
   *
   * @param organizationId - The workspace.
   * @param rival - An id, a name or an alias.
   * @returns The rival, or undefined.
   */
  async resolveCompetitor(
    organizationId: string,
    rival: string,
  ): Promise<CompetitorRow | undefined> {
    const wanted = rival.trim().toLowerCase();
    const rivals = await this.listCompetitors(organizationId);

    return rivals.find(
      (candidate) =>
        candidate.id === rival.trim() ||
        candidate.name.toLowerCase() === wanted ||
        (Array.isArray(candidate.meta.aliases) &&
          candidate.meta.aliases.some(
            (alias) => typeof alias === "string" && alias.toLowerCase() === wanted,
          )),
    );
  }
}
