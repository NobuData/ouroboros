/**
 * The snoozed section's words and pure rules (BO.5, [#470](https://github.com/NobuData/ouroboros/issues/470),
 * mockup 16's states): **where snooze becomes honest.**
 *
 * A snoozed decision is out of the queue and out of the **Needs You** badge, and that is all a
 * snooze does. It is still drawn — dimmed, so it reads as *not now* rather than as asking — with
 * the age it was asked at still counting through the snooze, and a countdown to when it comes
 * back on its own. The countdown is what keeps *not now* from silently becoming *never*, and
 * **Wake now** brings it back early for anyone who may snooze.
 */

import type { InboxSnoozedItem } from "@/app/api/inbox";
import { ageOfSeconds } from "@/app/format";

import { VIEWER_CANNOT_SNOOZE } from "./view";

/** The control that brings a snoozed decision back before its time. */
export const WAKE_LABEL = "Wake now";

/** What the control says while the wake is in flight. */
export const WAKING = "Waking…";

/** What a woken card says until the next read moves it back into the queue. */
export const WOKEN = "Back in the queue.";

/** What a refused wake says when the service's own words are no use. */
export const WAKE_FAILED = "The decision could not be woken. Try again.";

/**
 * Why *Wake now* is inert for a viewer — the service refuses them, as it refuses their snooze.
 * The same sentence as the snooze's, because it is the same rule.
 */
export const VIEWER_CANNOT_WAKE = VIEWER_CANNOT_SNOOZE;

/** What a snooze whose time has come says until the next read moves it back. */
export const WAKING_NOW = "waking now";

/**
 * The countdown to when a snoozed decision comes back on its own.
 *
 * Counted from the wake time rather than down from a figure, so a poll cannot move it and a tab
 * left in the background catches up. At or past the wake time the item is the service's to move
 * back, which the next read does; until then it says so rather than counting below zero.
 *
 * @param item The item — its `snoozedUntil`.
 * @param nowSeconds The clock, whole seconds since the epoch.
 * @returns `wakes in 42m`, or `waking now`.
 */
export function wakesIn(item: Pick<InboxSnoozedItem, "snoozedUntil">, nowSeconds: number): string {
  const until = Math.floor(Date.parse(item.snoozedUntil) / 1000);

  if (!Number.isFinite(until)) return WAKING_NOW;

  const left = until - nowSeconds;

  return left > 0 ? `wakes in ${ageOfSeconds(left)}` : WAKING_NOW;
}

/**
 * *Wake now*'s accessible name — which decision it wakes, since a list of them all say the same.
 *
 * @param item The item.
 * @returns `Wake now: Should the loops trust this fact?`
 */
export function wakeLabel(item: Pick<InboxSnoozedItem, "question">): string {
  return `${WAKE_LABEL}: ${item.question}`;
}

/**
 * Why *Wake now* cannot be pressed, or `undefined` when it can.
 *
 * @param item The item — whether this reader may wake it, as the service resolved it.
 * @param inFlight Whether a wake is already on its way.
 * @returns The reason, or `undefined`.
 */
export function wakeReason(item: Pick<InboxSnoozedItem, "snooze">, inFlight: boolean): string | undefined {
  if (!item.snooze.allowed) return VIEWER_CANNOT_WAKE;

  return inFlight ? WAKING : undefined;
}
