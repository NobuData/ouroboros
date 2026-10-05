/**
 * The `/inbox` frame's words and pure rules (BO.1, [#466](https://github.com/NobuData/ouroboros/issues/466),
 * mockup 16).
 *
 * **The headline is never composed here.** BN.4 (#464) sends `head.sentence` — the count, the
 * pluralization, the per-kind estimate, the cold-org omission and the zero state's whole-sentence
 * swap (`No decisions waiting.`) — and the page prints it verbatim, so the reader's next ninety
 * seconds are the service's arithmetic and never a friendlier rounding.
 *
 * Everything else the frame says, and the few rules about when it may act, live here so the
 * components stay layout.
 */

import type { InboxItem, InboxSnoozedItem } from "@/app/api/inbox";
import { ageOfSeconds } from "@/app/format";
import type { ChipTone } from "@/app/ui";

/** The eyebrow. */
export const INBOX_EYEBROW = "Needs You";

/** The subline, verbatim from the mockup. */
export const INBOX_SUBLINE =
  "Everything the loops are blocked on, newest first. Answer here, from Slack, or from your phone — the loop resumes instantly.";

/** What the headline says while nothing has been read yet. */
export const HEAD_UNREAD = "Needs You";

/** The snooze-all action's label, and how long it snoozes. */
export const SNOOZE_ALL_LABEL = "Snooze all 1h";
export const SNOOZE_ALL_MINUTES = 60;

/** The notification-settings action's label. */
export const NOTIFICATIONS_LABEL = "Notification settings";

/** What a pending write's button says. */
export const WORKING = "Working…";

/** The confirm dialog's cancel. */
export const CANCEL = "Cancel";

/** Why Snooze all is inert with nothing to snooze. */
export const NOTHING_TO_SNOOZE = "Nothing is waiting on you.";

/** Why Snooze all is inert for a viewer — the service refuses them (BN.4's snoozing roles). */
export const VIEWER_CANNOT_SNOOZE = "Viewers can read the inbox but not snooze it.";

/** What a refused snooze says. */
export const SNOOZE_FAILED = "The decisions could not be snoozed. Try again.";

/** The queue list's name, and the snoozed group's. */
export const QUEUE_LABEL = "Decisions waiting";
export const SNOOZED_LABEL = "Snoozed";

/** The words for each severity, and the chip hue each draws in. */
export const SEVERITY: Readonly<Record<InboxItem["severity"], { label: string; tone: ChipTone }>> = {
  err: { label: "Blocking", tone: "err" },
  warn: { label: "Waiting", tone: "warn" },
  info: { label: "FYI", tone: "neutral" },
};

/** A confirmation: title, the sentence that says what happens, and the confirming label. */
export interface SnoozeConfirmation {
  readonly title: string;
  readonly warning: string;
  readonly confirm: string;
}

/**
 * *decision* or *decisions*.
 *
 * @param count How many.
 * @returns The noun.
 */
export function decisions(count: number): string {
  return count === 1 ? "1 decision" : `${String(count)} decisions`;
}

/**
 * Why *Snooze all* cannot be pressed, or `undefined` when it can.
 *
 * @param count Asking items.
 * @param maySnooze Whether this reader may snooze (every item carries the same answer).
 * @returns The reason, or `undefined`.
 */
export function snoozeAllReason(count: number, maySnooze: boolean): string | undefined {
  if (count === 0) return NOTHING_TO_SNOOZE;
  if (!maySnooze) return VIEWER_CANNOT_SNOOZE;

  return undefined;
}

/**
 * The confirmation *Snooze all 1h* asks for — it names how many and until when, because one of
 * them may be blocking a deployment.
 *
 * @param count Asking items.
 * @param nowMs The instant it is asked, epoch milliseconds.
 * @param clock How an instant is printed — `14:20`.
 * @returns The dialog's words.
 */
export function snoozeConfirmation(
  count: number,
  nowMs: number,
  clock: (atMs: number) => string,
): SnoozeConfirmation {
  const until = clock(nowMs + SNOOZE_ALL_MINUTES * 60_000);

  return {
    title: `Snooze ${decisions(count)} until ${until}?`,
    warning: `${count === 1 ? "It leaves" : "They leave"} the queue and the Needs You badge until ${until}, then come back on their own. How long the loops have waited keeps counting.`,
    confirm: `Snooze until ${until}`,
  };
}

/**
 * Whether this reader may snooze — the service resolves it per item, the same for every item.
 *
 * @param items The asking items.
 * @returns `true` when the first says so; `false` for an empty queue.
 */
export function maySnoozeAll(items: readonly InboxItem[]): boolean {
  return items[0]?.snooze.allowed ?? false;
}

/**
 * A card's age, as a screen reader hears it — the card itself draws the bare `6m`.
 *
 * @param seconds Seconds since it was asked, through any snooze.
 * @returns `asked 6m ago`.
 */
export function askedAgo(seconds: number): string {
  return `asked ${ageOfSeconds(seconds)} ago`;
}

/**
 * A snoozed row's wake time.
 *
 * @param item The item.
 * @param clock How an instant is printed.
 * @returns `until 14:20`.
 */
export function snoozedUntil(item: InboxSnoozedItem, clock: (atMs: number) => string): string {
  return `until ${clock(Date.parse(item.snoozedUntil))}`;
}
