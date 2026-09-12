/**
 * What a cycle did, source by source — and, when a source was not polled, the word for why.
 *
 * Q.2 ([#139](https://github.com/NobuData/ouroboros/issues/139)). A background loop has nobody
 * waiting on it, so the only thing that separates *not polled* from *broken* is that each state
 * has a name. `backlog-sync/sync.report.ts` made the same argument for the GitHub loop; what
 * differs here is where the names come from, and the difference is the SPI.
 *
 * ---------------------------------------------------------------------------
 * **A failure's vocabulary is the taxonomy's. A skip's is this file's, and there is one.**
 *
 * The backlog sync has six pause reasons because it *is* the GitHub client: it knows what a
 * missing token means, what an unenabled repository means, and what a spent rate budget means.
 * This loop knows none of that, on purpose — every question of that shape is behind
 * `TicketSourceProvider`, and a provider answers it by throwing
 * {@link import("./ticket-source.errors").TicketSourceError}, whose four classes become a
 * status and a sentence in `ticket-source.errors.ts`.
 *
 * What is left is the one state no provider can report, because it is a state in which no
 * provider was reached: **there is no provider for this kind in this build**. That is
 * {@link SOURCE_SKIPPED_UNSUPPORTED}, and it is the only word this file adds.
 *
 * ---------------------------------------------------------------------------
 * **A skip and a failure are different things, and the difference is who has to act.**
 *
 * | | what it means | `ticket_sources.status` |
 * |---|---|---|
 * | **skipped** | this build carries no provider for the kind | *untouched* |
 * | **failed** | a provider was called and reported one of four classes | `error` + a reason |
 *
 * The untouched column is the load-bearing half. A build that has shipped Q.2 and not Q.3 has
 * no provider for anything, and `R__dev_seed_sources.sql` seeds a `github` source and a `jira`
 * one — so a loop that marked a skip as an error would paint every development workspace red
 * on first boot, for a release schedule rather than for anything a person configured. The skip
 * is reported in the cycle and logged once per kind, which is where a release schedule belongs.
 *
 * ---------------------------------------------------------------------------
 * **Nothing here is a status column.** These values live in the report a cycle returns and in
 * the loop's memory. The durable half is what the loop *writes*: `ticket_sources.synced_at`,
 * `sync_cursor`, `status` and V031's `status_reason`, which are facts about what a poll did
 * rather than about the shape of a cycle. Q.4's ([#141](https://github.com/NobuData/ouroboros/issues/141))
 * `GET /:id/status` is the surface that will read both halves.
 */

import type { TicketSourceKind } from "../db/schema";
import type { TicketSourceErrorClass } from "./ticket-source.errors";

/**
 * The kind has no provider in this build.
 *
 * Not a failure and not a configuration mistake — a release that has not happened. See this
 * file's header for why it leaves `ticket_sources.status` alone.
 */
export const SOURCE_SKIPPED_UNSUPPORTED = "unsupported_kind";

/** Why a source was not polled at all. One value today; see this file's header. */
export type SourceSkip = typeof SOURCE_SKIPPED_UNSUPPORTED;

/** Every value {@link SourceSkip} can hold, for a test that wants to iterate them. */
export const SOURCE_SKIPS = [SOURCE_SKIPPED_UNSUPPORTED] as const satisfies readonly SourceSkip[];

/**
 * What a person reads for each skip.
 *
 * A constant rather than a string built at a call site, so the sentence a log carries and the
 * sentence Q.4's status endpoint renders are the same words.
 */
export const SOURCE_SKIP_MESSAGES: Readonly<Record<SourceSkip, string>> = Object.freeze({
  [SOURCE_SKIPPED_UNSUPPORTED]:
    "This build has no provider for that tracker yet, so the source is configured and not polled.",
});

/** What a provider reported when a sync failed. */
export interface SourceSyncFailure {
  /** Which of the four — see `ticket-source.errors.ts`. */
  readonly errorClass: TicketSourceErrorClass;
  /**
   * The sentence written to `ticket_sources.status_reason`, exactly as stored.
   *
   * Carried in the report as well as written to the column so that a cycle is self-describing:
   * a test and a log line can both see what a person will read, without a second query.
   */
  readonly reason: string;
}

/** What one sync of one source did. */
export interface SourceSyncOutcome {
  /** The workspace the source belongs to. */
  readonly organizationId: string;
  /** `ticket_sources.id` — what Q.4's per-source status is keyed by. */
  readonly sourceId: string;
  /** The source's kind, for a log line that says which tracker was involved. */
  readonly kind: TicketSourceKind;
  /** The workspace's own name for it — *"GitHub · acme-robotics"*. What a log line prints. */
  readonly displayName: string;
  /**
   * Why this source was not polled, or `undefined` when it was.
   *
   * Per-source rather than per-workspace: one unsupported kind says nothing about the other
   * sources in the same workspace, which may well be a kind this build does carry.
   */
  readonly skipped?: SourceSkip;
  /** What the provider reported, or `undefined` when the sync succeeded or never ran. */
  readonly failure?: SourceSyncFailure;
  /** Rows inserted — tickets this mirror had never seen. */
  readonly imported: number;
  /** Rows rewritten because something the tracker owns had changed. */
  readonly updated: number;
  /**
   * Rows the provider returned that were identical to what was stored, and were therefore
   * **not written**.
   *
   * Counted because it is the one number that proves a re-sync is idempotent. Most trackers'
   * cursors are inclusive, so every incremental sync re-reads the ticket sitting exactly on the
   * watermark; writing it would move `updated_at` on a row nothing had changed and make that
   * column stop meaning what V030 says it means.
   */
  readonly unchanged: number;
  /**
   * Tickets the provider returned that were **closed and unknown to this mirror**, and were
   * therefore not stored.
   *
   * The one policy the loop applies to a provider's page, and it is provider-neutral: a backlog
   * holds what was open at least once. See `ticket-sources.repository.ts` for the argument.
   */
  readonly skippedClosed: number;
  /** Tickets handed to the estimation pipeline — new ones, and ones that reopened. */
  readonly enqueued: number;
  /**
   * Whether the provider said there is more waiting.
   *
   * {@link import("./ticket-source.provider").TicketPage.hasMore}, carried through. What makes
   * a cycle `pending`.
   */
  readonly hasMore: boolean;
  /** The freshness stamp this sync wrote, or `undefined` when it wrote none. */
  readonly syncedAt?: Date;
  /** The watermark stored for next time, or `undefined` when the provider returned none. */
  readonly cursor?: string;
}

/** What one cycle of the whole loop did. */
export interface SyncCycleReport {
  /** The cycle's clock — one instant, shared by every freshness stamp it writes. */
  readonly startedAt: Date;
  /** Every active source, whether or not it was polled. */
  readonly sources: readonly SourceSyncOutcome[];
  /**
   * Whether any provider left known work behind.
   *
   * The scheduler reads it and books the next cycle in
   * {@link import("./cadence").CONTINUATION_DELAY_MS} rather than a full interval, which is
   * what makes a cold import of a large backlog several quick cycles instead of an afternoon.
   */
  readonly pending: boolean;
}

/** The totals a log line quotes, over a whole cycle. */
export interface SyncCycleTotals {
  /** Sources actually polled — neither skipped nor failed. */
  readonly polled: number;
  /** Sources not polled because this build has no provider for their kind. */
  readonly skipped: number;
  /** Sources whose provider reported a failure. */
  readonly failed: number;
  /** Rows inserted across the cycle. */
  readonly imported: number;
  /** Rows rewritten across the cycle. */
  readonly updated: number;
  /** Rows left alone across the cycle. */
  readonly unchanged: number;
  /** Tickets handed to the estimation pipeline across the cycle. */
  readonly enqueued: number;
}

/**
 * The totals a log line quotes, over a whole cycle.
 *
 * @param report - The cycle.
 * @returns Enough for one sentence an operator can act on, and nothing that names a credential
 *   or a person. A source that was skipped or failed contributes to its own count and to none
 *   of the row counts, so `imported + updated + unchanged` is always over sources that were
 *   really polled.
 */
export function cycleTotals(report: SyncCycleReport): SyncCycleTotals {
  const polled = report.sources.filter(
    (source) => source.skipped === undefined && source.failure === undefined,
  );

  return {
    polled: polled.length,
    skipped: report.sources.filter((source) => source.skipped !== undefined).length,
    failed: report.sources.filter((source) => source.failure !== undefined).length,
    imported: sum(polled, (source) => source.imported),
    updated: sum(polled, (source) => source.updated),
    unchanged: sum(polled, (source) => source.unchanged),
    enqueued: sum(polled, (source) => source.enqueued),
  };
}

/**
 * Add up one field across a list.
 *
 * @param items - The list.
 * @param of - Which number to take from each.
 * @returns The total; `0` for an empty list, which is the common cycle.
 */
function sum<T>(items: readonly T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0);
}
