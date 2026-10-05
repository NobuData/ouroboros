/**
 * The recovery screen's countdown and copy, as values
 * (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)).
 *
 * A deleted workspace is not gone: it is `pending_delete` for a 30-day recovery window, every
 * surface of it frozen, and an owner may restore it. The screen that says so has one moving
 * part — how long is left — and this module is that arithmetic and every sentence around it;
 * `app/lifecycle/recovery-screen.tsx` draws them.
 *
 * Framework-free and pure.
 */

/** The screen's eyebrow. */
export const RECOVERY_EYEBROW = "Pending deletion";

/** What the countdown says once the window has closed and the purge has not begun. */
export const WINDOW_CLOSED =
  "recovery window closed — restore is still possible until the purge begins";

/** What stands where the countdown would, when the service did not say when the window closes. */
export const WINDOW_UNKNOWN = "30-day recovery window";

/** The countdown's last minute. */
export const UNDER_A_MINUTE = "less than a minute to recover";

/** What the countdown's label is, for a reader who cannot see it tick. */
export const COUNTDOWN_LABEL = "Time left to recover";

/** How often the countdown is re-read, in milliseconds — its finest unit is the minute. */
export const COUNTDOWN_TICK_MS = 30_000;

/** The owner's action. */
export const RESTORE_LABEL = "Restore workspace";

/** The same button while the restore is on its way. */
export const RESTORING_LABEL = "Restoring…";

/** What is said when a restore was refused and the service gave no sentence. */
export const RESTORE_FAILED = "The workspace could not be restored. Try again.";

/** What an owner is told the action does. */
export const OWNER_NOTE =
  "You are an owner of this workspace. Restoring returns it to active: loops may start again, " +
  "and everyone who was signed out by the deletion can sign back in.";

/** What anybody else is told: who can act. */
export const NON_OWNER_NOTE =
  "Only an owner of this workspace can restore it. If it should not be deleted, ask an owner " +
  "to restore it before the recovery window closes.";

/** The heading over what is frozen. */
export const FROZEN_TITLE = "While it is pending deletion";

/** What is frozen, as the service enforces it. */
export const FROZEN_FACTS: readonly string[] = [
  "Every page of this workspace is frozen behind this screen.",
  "Nothing is dispatched: no loop starts, no stage advances, no build is offered.",
  "Everyone who is not an owner was signed out of it.",
];

/** The heading over the ways out. */
export const ELSEWHERE_TITLE = "Go elsewhere";

/** The sign-out action. */
export const SIGN_OUT_LABEL = "Sign out";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The screen's title for a workspace.
 *
 * @param workspaceName The workspace's display name.
 * @returns *acme-robotics is scheduled for deletion*.
 */
export function recoveryTitle(workspaceName: string): string {
  return `${workspaceName} is scheduled for deletion`;
}

/**
 * The sentence under the title: when the window closes.
 *
 * @param purgeAfter When the recovery window closes — ISO-8601 — or `null` when not known.
 * @returns The sentence, naming the day (UTC) when there is one.
 */
export function recoveryLead(purgeAfter: string | null): string {
  const closes = purgeAfter === null ? Number.NaN : Date.parse(purgeAfter);

  return Number.isNaN(closes)
    ? "Its data is kept through a 30-day recovery window, then destroyed."
    : `Its data is kept until ${new Date(closes).toISOString().slice(0, 10)} (UTC), then destroyed.`;
}

/**
 * The countdown — `29d 23h to recover`.
 *
 * Whole units, rounded **down**: a countdown that rounds up promises time the reader does not
 * have. Days and hours while a day or more is left; hours and minutes under a day; minutes under
 * an hour; and past the close, that the window is closed and a restore may still land until the
 * purge begins.
 *
 * @param purgeAfter When the recovery window closes — ISO-8601 — or `null` when not known.
 * @param now The current time, in milliseconds since the epoch.
 * @returns The countdown's text.
 */
export function recoveryCountdown(purgeAfter: string | null, now: number): string {
  const closes = purgeAfter === null ? Number.NaN : Date.parse(purgeAfter);
  if (Number.isNaN(closes)) return WINDOW_UNKNOWN;

  const left = closes - now;
  if (left <= 0) return WINDOW_CLOSED;
  if (left < MINUTE) return UNDER_A_MINUTE;

  const days = Math.floor(left / DAY);
  const hours = Math.floor((left % DAY) / HOUR);
  const minutes = Math.floor((left % HOUR) / MINUTE);

  if (days > 0) return `${String(days)}d ${String(hours)}h to recover`;
  if (hours > 0) return `${String(hours)}h ${String(minutes)}m to recover`;

  return `${String(minutes)}m to recover`;
}

/**
 * What a switch to another workspace is called.
 *
 * @param workspaceName The other workspace's display name.
 * @returns The button's label.
 */
export function switchLabel(workspaceName: string): string {
  return `Open ${workspaceName}`;
}
