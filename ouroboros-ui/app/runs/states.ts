/**
 * The run console's states besides *mid-flight*
 * ([#314](https://github.com/NobuData/ouroboros/issues/314)) — decided here, drawn by the screen.
 *
 * Mockup 10 draws one state: a healthy run, mid-flight. A run also **queues** (it is live, but no
 * stage has started), **ends** (merged, failed, canceled — the head then offers the pull request
 * a merged run opened), and **goes quiet** — the page's reads keep answering, but nothing new
 * arrives. The console cannot tell *the run is thinking* from *nothing is arriving*, so it says
 * when it last heard anything rather than implying a freshness it does not have: DASH-I.7's rule
 * ([#86](https://github.com/NobuData/ouroboros/issues/86)), for ingestion rather than for a read.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type { RunConsole } from "@/app/api/runs";

/** What the transcript says for a queued run — honest about why it is empty. */
export const QUEUED_ENTRIES =
  "This run is queued — no stage has started yet, so nothing has been written. Entries appear " +
  "here as soon as the first stage does.";

/**
 * How long a live run may go without any new activity before the console says so, in seconds.
 *
 * Two minutes: comfortably longer than one poll of the transcript (the shared cadence, #87) and
 * one step of a scripted run, and short enough that a stalled ingest is named before a reader
 * has finished wondering about it.
 */
export const INGEST_LAG_AFTER_SECONDS = 120;

/** What the ingest-lag banner's retry says — it asks the service again, now. */
export const INGEST_LAG_RETRY = "Check again";

/** What the ingest-lag banner's retry says while that read is in flight. */
export const INGEST_LAG_RETRYING = "Checking…";

/**
 * Why the console may have gone quiet — the banner's reason. It names every cause it cannot rule
 * out, because it can rule out none of them.
 */
export const INGEST_LAG_REASON =
  "The run may be paused or working on something long — or ingestion may have stalled. What is " +
  "shown here may be out of date.";

/**
 * Whether a run is queued: live, and no stage has started.
 *
 * A run with no stages at all is queued too — nothing has been reported to start.
 *
 * @param snapshot The run console snapshot.
 * @returns `true` for the pre-first-stage view.
 */
export function isQueued(snapshot: RunConsole): boolean {
  if (!snapshot.head.live) return false;

  return snapshot.timeline.stages.every(
    (stage) =>
      stage.status === "pending" && stage.attempts.every((attempt) => attempt.startedAt === null),
  );
}

/**
 * The latest instant anything was reported for a run — a stage attempt starting or finishing, a
 * commit, a transcript entry, or the run's own start.
 *
 * @param snapshot The run console snapshot.
 * @param newestEntryAt The newest transcript entry's `ts`, or `null` when none is held.
 * @returns Epoch milliseconds, or `null` when not one instant could be parsed.
 */
export function lastActivityMs(snapshot: RunConsole, newestEntryAt: string | null): number | null {
  const instants: (string | null)[] = [snapshot.run.startedAt, newestEntryAt];

  for (const stage of snapshot.timeline.stages) {
    for (const attempt of stage.attempts) instants.push(attempt.startedAt, attempt.finishedAt);
  }
  for (const commit of snapshot.changes.commits) instants.push(commit.committedAt);

  let latest: number | null = null;
  for (const instant of instants) {
    const ms = instant === null ? Number.NaN : Date.parse(instant);
    if (!Number.isNaN(ms) && (latest === null || ms > latest)) latest = ms;
  }

  return latest;
}

/**
 * When a live run's events went stale, if they have.
 *
 * Only a live run that has started can lag: a finished run is supposed to be quiet, and a queued
 * one has nothing to report yet.
 *
 * @param snapshot The run console snapshot.
 * @param newestEntryAt The newest transcript entry's `ts`, or `null` when none is held.
 * @param nowMs Now, in epoch milliseconds.
 * @param afterSeconds How long counts as stale. Defaults to {@link INGEST_LAG_AFTER_SECONDS}.
 * @returns The last activity in epoch milliseconds when it is older than `afterSeconds`, else
 *   `null`.
 */
export function ingestLagSince(
  snapshot: RunConsole,
  newestEntryAt: string | null,
  nowMs: number,
  afterSeconds: number = INGEST_LAG_AFTER_SECONDS,
): number | null {
  if (!snapshot.head.live || isQueued(snapshot)) return null;

  const last = lastActivityMs(snapshot, newestEntryAt);
  if (last === null || nowMs - last < afterSeconds * 1000) return null;

  return last;
}

/**
 * The ingest-lag banner's headline — when the page last heard anything.
 *
 * @param sinceMs The last activity, in epoch milliseconds.
 * @param clock How to print an instant — the dashboard's `clockTime`.
 * @returns `No new activity since 14:02 — the run's events have gone quiet.`
 */
export function ingestLagHeadline(sinceMs: number, clock: (atMs: number) => string): string {
  return `No new activity since ${clock(sinceMs)} — the run's events have gone quiet.`;
}
