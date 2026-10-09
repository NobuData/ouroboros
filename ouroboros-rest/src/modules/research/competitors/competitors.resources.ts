/**
 * The competitor registry's response shapes (CL.3, [#616](https://github.com/NobuData/ouroboros/issues/616)) —
 * `openapi.yaml`'s `Competitor`, `CompetitorWatch`, `CompetitorList`, `CompetitorChange` and
 * `CompetitorChangeFeed`.
 */

import type {
  CompetitorCadence,
  CompetitorCheckOutcome,
  CompetitorSourceKind,
} from "../../db/schema";
import type { ChangeRow, CompetitorRow, TrackerSummary, WatchRow } from "./competitors.repository";

/** A watch, as the registry shows it. */
export interface CompetitorWatchResource {
  readonly id: string;
  readonly competitorId: string;
  readonly sourceKind: CompetitorSourceKind;
  readonly url: string;
  readonly selector: string | null;
  readonly cadence: CompetitorCadence;
  readonly enabled: boolean;
  /** The page needs the render tier (v2); the scheduler skips it until cleared. */
  readonly renderRequired: boolean;
  readonly lastSnapshotAt: string | null;
  readonly lastCheckedAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly lastOutcome: CompetitorCheckOutcome | null;
  /** Why the latest check failed, or why the source cannot be read yet. */
  readonly lastNote: string | null;
  readonly nextCheckAt: string | null;
  readonly createdAt: string;
}

/** A rival and its watches. */
export interface CompetitorResource {
  readonly id: string;
  readonly name: string;
  readonly site: string | null;
  readonly aliases: readonly string[];
  readonly notes: string | null;
  readonly createdAt: string;
  readonly watches: readonly CompetitorWatchResource[];
}

/** The tracker's summary — the tools-card sub-line, from the registry. */
export interface CompetitorSummaryResource {
  readonly rivalsWatched: number;
  readonly watchesEnabled: number;
  readonly sourceKinds: readonly CompetitorSourceKind[];
  readonly subLine: string;
}

/** `GET /research/competitors`. */
export interface CompetitorListResource {
  readonly items: readonly CompetitorResource[];
  readonly summary: CompetitorSummaryResource;
}

/** One archived change. */
export interface CompetitorChangeResource {
  /** The snapshot that carries the diff — what a `competitor_diff` source cites. */
  readonly snapshotId: string;
  readonly previousSnapshotId: string | null;
  readonly watchId: string;
  readonly competitorId: string;
  readonly competitorName: string;
  readonly sourceKind: CompetitorSourceKind;
  readonly url: string;
  readonly selector: string | null;
  readonly contentHash: string;
  /** `+ ` added and `- ` removed lines. */
  readonly diff: string;
  readonly takenAt: string;
}

/** `GET /research/competitor-changes`. */
export interface CompetitorChangeFeedResource {
  readonly items: readonly CompetitorChangeResource[];
  /** Pass as `before` for the next page; null on the last. */
  readonly nextBefore: string | null;
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/**
 * A watch row, as the API shows it.
 *
 * @param row - The row.
 * @returns The resource.
 */
export function watchResource(row: WatchRow): CompetitorWatchResource {
  return {
    id: row.id,
    competitorId: row.competitorId,
    sourceKind: row.sourceKind,
    url: row.url,
    selector: row.selector,
    cadence: row.cadence,
    enabled: row.enabled,
    renderRequired: row.renderRequired,
    lastSnapshotAt: iso(row.lastSnapshotAt),
    lastCheckedAt: iso(row.lastCheckedAt),
    lastSuccessAt: iso(row.lastSuccessAt),
    lastOutcome: row.lastOutcome,
    lastNote: row.lastNote,
    nextCheckAt: iso(row.nextCheckAt),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * A rival row and its watches, as the API shows them.
 *
 * @param row - The rival.
 * @param watches - Its watches.
 * @returns The resource.
 */
export function competitorResource(
  row: CompetitorRow,
  watches: readonly WatchRow[],
): CompetitorResource {
  const { site, aliases, notes } = row.meta;

  return {
    id: row.id,
    name: row.name,
    site: typeof site === "string" ? site : null,
    aliases: Array.isArray(aliases)
      ? aliases.filter((alias): alias is string => typeof alias === "string")
      : [],
    notes: typeof notes === "string" ? notes : null,
    createdAt: row.createdAt.toISOString(),
    watches: watches.map(watchResource),
  };
}

/**
 * The summary, as the API shows it.
 *
 * @param summary - The view's row.
 * @returns The resource.
 */
export function summaryResource(summary: TrackerSummary): CompetitorSummaryResource {
  return {
    rivalsWatched: summary.rivalsWatched,
    watchesEnabled: summary.watchesEnabled,
    sourceKinds: [...summary.sourceKinds],
    subLine: summary.subLine,
  };
}

/**
 * A change row, as the API shows it.
 *
 * @param row - The row.
 * @returns The resource.
 */
export function changeResource(row: ChangeRow): CompetitorChangeResource {
  return {
    snapshotId: row.snapshotId,
    previousSnapshotId: row.previousSnapshotId,
    watchId: row.watchId,
    competitorId: row.competitorId,
    competitorName: row.competitorName,
    sourceKind: row.sourceKind,
    url: row.url,
    selector: row.selector,
    contentHash: row.contentHash,
    diff: row.diff,
    takenAt: row.takenAt.toISOString(),
  };
}
