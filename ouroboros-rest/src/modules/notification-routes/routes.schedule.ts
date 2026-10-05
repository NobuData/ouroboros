/**
 * When an org route's mail is due (BR.4, [#488](https://github.com/NobuData/ouroboros/issues/488))
 * — pure.
 *
 * ```
 * daily_digest      every day at config.time (UTC; 09:00 when unset) — BN.3's daily rule
 * weekly_insights   config.weekday at config.time (Monday 09:00 when unset) — #440's weekly rule
 * ```
 *
 * A slot is due from its instant until its **grace** runs out, so a sender that was down across
 * it still sends when it returns, but not a day late. A **minimum gap** after the last slot that
 * delivered keeps an administrator who moves the time from 09:00 to 15:00 from sending the day's
 * digest twice. The slot that last delivered stays due through its grace, because a route mails
 * several addresses and one that failed is retried for the same slot.
 */

import { latestWeeklySlot } from "../scheduling/cadence";
import {
  DEFAULT_DIGEST_TIME,
  DIGEST_GRACE_MS,
  DIGEST_MIN_GAP_MS,
  latestDailySlot,
} from "../inbox-channels/notifications/digest.schedule";
import type { NotificationRouteConfig } from "../db/schema";
import { isoDayOf, type MailingKind } from "./routes.catalog";

const HOUR_MS = 60 * 60 * 1000;

/** How late a weekly slot may still be sent — #440's own grace. */
export const WEEKLY_GRACE_MS = 24 * HOUR_MS;

/** The least time between two weekly slots that delivered. */
export const WEEKLY_MIN_GAP_MS = 6 * 24 * HOUR_MS;

/**
 * The latest slot of a route at or before an instant.
 *
 * @param kind - The route.
 * @param config - Its config; an unset time is 09:00 and an unset weekday Monday.
 * @param now - The instant.
 * @returns The slot.
 */
export function latestRouteSlot(
  kind: MailingKind,
  config: NotificationRouteConfig,
  now: Date,
): Date {
  const time = config.time ?? DEFAULT_DIGEST_TIME;

  return kind === "daily_digest"
    ? latestDailySlot(now, time)
    : latestWeeklySlot(now, isoDayOf(config.weekday), time);
}

/**
 * The slot due now, if any.
 *
 * @param kind - The route.
 * @param config - Its config.
 * @param now - The instant.
 * @param lastSent - The latest slot the route delivered to anybody, or undefined.
 * @returns The slot, or undefined when nothing is due.
 */
export function dueRouteSlot(
  kind: MailingKind,
  config: NotificationRouteConfig,
  now: Date,
  lastSent: Date | undefined,
): Date | undefined {
  const slot = latestRouteSlot(kind, config, now);
  const grace = kind === "daily_digest" ? DIGEST_GRACE_MS : WEEKLY_GRACE_MS;
  const gap = kind === "daily_digest" ? DIGEST_MIN_GAP_MS : WEEKLY_MIN_GAP_MS;

  if (now.getTime() - slot.getTime() > grace) {
    return undefined;
  }

  if (lastSent === undefined || slot.getTime() === lastSent.getTime()) {
    return slot;
  }

  return slot.getTime() - lastSent.getTime() >= gap ? slot : undefined;
}
