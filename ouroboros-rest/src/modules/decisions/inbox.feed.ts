/**
 * The pill feed — what the shell's sidebar **Needs You** badge shows.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)), delivering the DASH-J.2
 * contract ([#90](https://github.com/NobuData/ouroboros/issues/90)) and feeding the sidebar badge
 * ([#78](https://github.com/NobuData/ouroboros/issues/78)). Real counts from `decision_items`, by
 * severity, **snooze-aware**:
 *
 * ```
 * open     status open, or snoozed until a moment already past   ← the badge
 * snoozed  status snoozed, still hidden                           ← "3 snoozed" beside it
 * ```
 *
 * An elapsed snooze counts as open before the wake sweep has run, so the badge never hides a
 * question longer than its snooze asked. The queue (BN.4) lists exactly the items `open` counts.
 *
 * Pure but for the clock and the repository.
 */

import { Injectable } from "@nestjs/common";

import type { DecisionSeverity } from "../db/schema";
import { DecisionRepository, type DecisionFeedRow } from "./decision.repository";

/** Counts by severity. */
export interface InboxSeverityCounts {
  readonly err: number;
  readonly warn: number;
  readonly info: number;
}

/** `GET /api/v1/inbox/feed`. */
export interface InboxFeedResource {
  /** Items asking now — the badge's number. Zero hides it. */
  readonly open: number;
  /** {@link open}, by severity — the badge lights red when any `err` is open. */
  readonly bySeverity: InboxSeverityCounts;
  /** Items snoozed and still hidden. Not in {@link open}. */
  readonly snoozed: number;
  /** When the soonest hidden item wakes, ISO-8601, or null when none is snoozed. */
  readonly nextWakeAt: string | null;
  /** The instant the counts are as of, ISO-8601. */
  readonly asOf: string;
}

/** The severities, most urgent first. */
const SEVERITIES: readonly DecisionSeverity[] = ["err", "warn", "info"];

/**
 * Fold the repository's per-severity rows into the feed.
 *
 * @param rows - One row per severity present.
 * @param now - The instant the counts are as of.
 * @returns The feed; a severity with no row counts zero.
 */
export function inboxFeedOf(rows: readonly DecisionFeedRow[], now: Date): InboxFeedResource {
  const bySeverity = Object.fromEntries(
    SEVERITIES.map((severity) => [
      severity,
      rows.find((row) => row.severity === severity)?.open ?? 0,
    ]),
  ) as unknown as InboxSeverityCounts;
  const wakes = rows
    .map((row) => row.nextWakeAt)
    .filter((at): at is Date => at !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  return {
    open: bySeverity.err + bySeverity.warn + bySeverity.info,
    bySeverity,
    snoozed: rows.reduce((sum, row) => sum + row.snoozed, 0),
    nextWakeAt: wakes.length === 0 ? null : wakes[0].toISOString(),
    asOf: now.toISOString(),
  };
}

@Injectable()
export class InboxFeedService {
  /**
   * @param repository - The counts.
   */
  constructor(private readonly repository: DecisionRepository) {}

  /**
   * The current instant — a method so a spec can pin it.
   *
   * @returns Now.
   */
  now(): Date {
    return new Date();
  }

  /**
   * One workspace's feed.
   *
   * @param organizationId - The workspace, from the session.
   * @returns The counts.
   */
  async feed(organizationId: string): Promise<InboxFeedResource> {
    const now = this.now();

    return inboxFeedOf(await this.repository.feed(organizationId, now), now);
  }
}
