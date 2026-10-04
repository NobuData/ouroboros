/**
 * When a person's daily decision digest is due (BN.3, [#463](https://github.com/NobuData/ouroboros/issues/463))
 * — pure.
 *
 * A digest has one slot a day, at the person's `digest_time` in UTC (the #440 digest's convention).
 *
 * ```
 * due      the latest slot at or before now, if it is at most DIGEST_GRACE_MS old (a process down
 *          across the slot still sends on return; a slot from yesterday morning is stale), and
 *          at least DIGEST_MIN_GAP_MS after the last slot sent — so moving 09:00 to 10:00 after
 *          the 09:00 digest left does not send a second one today
 * next     the due slot, else the first later slot the gap allows — what the preferences answer
 *          as `nextSendAt`, so changing the time visibly changes the next send
 * ```
 */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** How late after its slot a digest may still leave: six hours. */
export const DIGEST_GRACE_MS = 6 * HOUR_MS;

/** The least time between two digests of one person in one workspace: twenty hours. */
export const DIGEST_MIN_GAP_MS = 20 * HOUR_MS;

/** The default send time, UTC. */
export const DEFAULT_DIGEST_TIME = "09:00";

/** `HH:MM`, 00:00–23:59. */
export const DIGEST_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * The latest daily slot at or before an instant.
 *
 * @param now - The instant.
 * @param time - `HH:MM`, UTC.
 * @returns The slot.
 * @throws {RangeError} For a time that is not `HH:MM`.
 */
export function latestDailySlot(now: Date, time: string): Date {
  const match = DIGEST_TIME_PATTERN.exec(time);

  if (match === null) {
    throw new RangeError(`not a time of day: ${time}`);
  }

  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    Number(match[1]),
    Number(match[2]),
  );

  return new Date(today > now.getTime() ? today - DAY_MS : today);
}

/**
 * Whether a slot is far enough after the last one sent.
 *
 * @param slot - The candidate.
 * @param lastSlot - The last slot a digest was sent for, or undefined.
 * @returns True when the gap allows it.
 */
function gapAllows(slot: Date, lastSlot: Date | undefined): boolean {
  return lastSlot === undefined || slot.getTime() - lastSlot.getTime() >= DIGEST_MIN_GAP_MS;
}

/**
 * The slot due now, if any.
 *
 * @param now - The instant.
 * @param time - `HH:MM`, UTC.
 * @param lastSlot - The last slot a digest was sent for, or undefined.
 * @returns The slot, or undefined when nothing is due.
 */
export function dueDigestSlot(
  now: Date,
  time: string,
  lastSlot: Date | undefined,
): Date | undefined {
  const slot = latestDailySlot(now, time);

  return now.getTime() - slot.getTime() <= DIGEST_GRACE_MS && gapAllows(slot, lastSlot)
    ? slot
    : undefined;
}

/**
 * The next send: the due slot, else the first later slot the gap allows.
 *
 * @param now - The instant.
 * @param time - `HH:MM`, UTC.
 * @param lastSlot - The last slot a digest was sent for, or undefined.
 * @returns The slot.
 */
export function nextDigestSlot(now: Date, time: string, lastSlot: Date | undefined): Date {
  const due = dueDigestSlot(now, time, lastSlot);

  if (due !== undefined) {
    return due;
  }

  let slot = new Date(latestDailySlot(now, time).getTime() + DAY_MS);

  while (!gapAllows(slot, lastSlot)) {
    slot = new Date(slot.getTime() + DAY_MS);
  }

  return slot;
}
