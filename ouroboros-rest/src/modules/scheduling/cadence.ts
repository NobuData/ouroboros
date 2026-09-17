/**
 * The two primitives every periodic job in this service is built from — when to fire, and
 * how many things to do at once.
 *
 * They were written for the provider-health sweep (Z.3,
 * [#196](https://github.com/NobuData/ouroboros/issues/196)), which was the first periodic
 * work here, and they moved to this directory when K.4
 * ([#102](https://github.com/NobuData/ouroboros/issues/102)) became the second. The move is
 * the point: a second copy of a jitter formula is a second place a fleet's schedules can be
 * made to converge, and the only way to be sure two loops spread the same way is for there to
 * be one rule.
 *
 * **This is not a Nest module.** There is nothing to inject — two pure functions over numbers
 * and arrays — and `errors/` sets the precedent for a directory of shared helpers that the
 * injector never sees.
 */

/**
 * How far either side of the base interval a delay may land — ±25%.
 *
 * Wide enough that a fleet spreads across a meaningful window within a few cycles, narrow
 * enough that "checks run about every minute" stays a true sentence an operator can plan
 * against. A spread approaching 1 would make the cadence unpredictable rather than merely
 * unsynchronised, and the acceptance criteria that ask for jitter ask for the second thing.
 */
export const JITTER_SPREAD = 0.25;

/**
 * A delay, moved off the boundary.
 *
 * Ouroboros is self-hosted. A hundred installations that all schedule an hourly poll on a
 * whole-hour boundary are a hundred requests arriving at somebody else's API in the same
 * second, every hour, from a hundred addresses that look unrelated to each other and
 * coordinated to the far end. That is a thundering herd whose members cannot see one another,
 * and the only fix available from inside one member is to stop being on the boundary.
 *
 * **Every delay is jittered, including the first.** Waiting a jittered interval before the
 * *first* cycle is what stops a fleet restarted together — a rolled deployment, a host reboot,
 * a compose stack coming up — from converging on the same schedule for the rest of its life.
 *
 * @param baseMs - The nominal interval.
 * @param random - A source of `[0, 1)`. Injected so a test can assert the endpoints of the
 *   window rather than sample it and hope; nothing in the application passes it.
 * @returns A delay uniformly distributed across `baseMs` ± {@link JITTER_SPREAD}, rounded to
 *   whole milliseconds and never below 1 — `setTimeout(0)` is a delay that fires on the next
 *   tick, which for a background loop is a spin rather than a schedule.
 */
export function jittered(baseMs: number, random: () => number = Math.random): number {
  const offset = (random() * 2 - 1) * JITTER_SPREAD * baseMs;

  return Math.max(1, Math.round(baseMs + offset));
}

/**
 * Split a list into runs of at most `size`, preserving order.
 *
 * The whole of this service's concurrency control for background work: a loop awaits one
 * chunk before starting the next, so at most `size` operations are ever in flight. A
 * semaphore would keep the pipe fuller, and would be a scheduler of its own inside code whose
 * subject is already scheduling — for background work with a full cycle to finish in, the
 * simpler thing is the right thing.
 *
 * @param items - The list.
 * @param size - The maximum run length. At least 1; a smaller value would produce empty runs
 *   forever and is a caller's bug rather than an input, so it is clamped rather than obeyed.
 * @returns The runs. Empty for an empty list, which is the common answer: most cycles find
 *   nothing due.
 */
export function chunked<T>(items: readonly T[], size: number): T[][] {
  const runs: T[][] = [];

  for (let index = 0; index < items.length; index += Math.max(1, size)) {
    runs.push(items.slice(index, index + Math.max(1, size)));
  }

  return runs;
}

/** One day, in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One scheduled night of a once-a-day job — AL.5's nightly re-estimation
 * ([#281](https://github.com/NobuData/ouroboros/issues/281)).
 */
export interface NightlySlot {
  /**
   * The UTC date the slot belongs to, `YYYY-MM-DD` — what a run records, and what stops two
   * replicas both running the same night.
   */
  readonly night: string;
  /** The slot's nominal instant: that date at the scheduled hour, UTC, before any jitter. */
  readonly at: Date;
}

/**
 * The next slot of a job that runs once a day at a fixed UTC hour.
 *
 * *Next* is strictly after `now`: a process that starts, or finishes a run, at 02:14 with a 02:00
 * schedule books tomorrow rather than a slot already past. A process that was not running across a
 * slot does not run it late — the next night picks up what that one would have, which for a job
 * whose whole purpose is a bounded nightly batch is the same work a day later rather than a lost one.
 *
 * @param now - The current instant.
 * @param hourUtc - The scheduled hour, 0–23.
 * @returns The slot.
 */
export function nextNightlySlot(now: Date, hourUtc: number): NightlySlot {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc);
  const at = new Date(today > now.getTime() ? today : today + DAY_MS);

  return { night: at.toISOString().slice(0, 10), at };
}

/**
 * How long to wait for a nightly slot, jittered across a window after it.
 *
 * The daily counterpart to {@link jittered}, and a *window after* rather than ±25% for the reason
 * `OURO_REESTIMATION_JITTER_MINUTES` gives: a quarter of a day either side would move an off-peak
 * job into the working day. Every delay lands off the hour, so a fleet of installations does not
 * reach for its engines in the same second.
 *
 * @param now - The current instant.
 * @param slot - The slot to wait for.
 * @param jitterMinutes - The window's width.
 * @param random - A source of `[0, 1)`; injected so a test can assert the window's endpoints.
 * @returns Milliseconds, never below 1 — see {@link jittered}.
 */
export function nightlyDelay(
  now: Date,
  slot: NightlySlot,
  jitterMinutes: number,
  random: () => number = Math.random,
): number {
  const offset = Math.floor(random() * jitterMinutes * 60 * 1000);

  return Math.max(1, slot.at.getTime() + offset - now.getTime());
}
