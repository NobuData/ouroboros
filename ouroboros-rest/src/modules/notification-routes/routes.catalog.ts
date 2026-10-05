/**
 * What an org notification route may be (BR.4, [#488](https://github.com/NobuData/ouroboros/issues/488))
 * — pure, the same vocabulary V094 holds the table to.
 *
 * ```
 * kinds      needs_you_dm · daily_digest · loop_failures · weekly_insights · custom:<slug>
 * channels   email · slack · pagerduty
 * lock       a channel with no connection in this build is locked, with the reason the card prints
 * config     time (HH:MM, UTC) · weekday (monday … sunday) · recipients (email addresses)
 * ```
 *
 * **The lock is the locked-row rule.** `notification_routes_effective` derives it for stored rows;
 * {@link channelLock} states the same rule for a route that is about to be written (so an enable
 * can be refused before it is stored) and for a kind with no stored row yet. The two say the same
 * thing because they are the same three cases: email delivers, Slack waits on mockup 19 (Chat Ops)
 * and PagerDuty on the v2 connector (BT.3). When either lands, its ticket replaces the view's branch
 * and this one together.
 *
 * **The config check mirrors `notification_route_config_valid`** so a malformed body is a `422`
 * naming the field rather than a constraint violation.
 */

import type { NotificationRouteChannel, NotificationRouteConfig } from "../db/schema";

/** The four route kinds mockup 17's notifications card renders, in its order. */
export const CORE_ROUTE_KINDS = [
  "needs_you_dm",
  "daily_digest",
  "loop_failures",
  "weekly_insights",
] as const;

/** One of {@link CORE_ROUTE_KINDS}. */
export type CoreRouteKind = (typeof CORE_ROUTE_KINDS)[number];

/** `custom:<slug>` — V094's grammar for a kind a later plane adds. */
const CUSTOM_KIND = /^custom:[a-z0-9][a-z0-9_-]{0,62}$/;

/** Every channel V094 permits. */
export const ROUTE_CHANNELS = [
  "email",
  "slack",
  "pagerduty",
] as const satisfies readonly NotificationRouteChannel[];

/**
 * The channel a core kind is bound to before anybody saves it — the card's own bindings:
 * *Needs-you decisions → Slack DM*, *Daily digest → email*, *Loop failures → PagerDuty*,
 * *Weekly insights report → email*. A custom kind defaults to email.
 */
export const DEFAULT_CHANNELS: Readonly<Record<CoreRouteKind, NotificationRouteChannel>> = {
  needs_you_dm: "slack",
  daily_digest: "email",
  loop_failures: "pagerduty",
  weekly_insights: "email",
};

/** The route kinds that send mail in this build — what V103's send log admits. */
export const MAILING_KINDS = ["daily_digest", "weekly_insights"] as const;

/** One of {@link MAILING_KINDS}. */
export type MailingKind = (typeof MAILING_KINDS)[number];

/** The weekdays a config may name, Monday first — index + 1 is the ISO day. */
export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

/** `HH:MM`, 00:00–23:59 — V094's pattern. */
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** V094's address pattern: something, an @, something with a dot. */
const ADDRESS = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The most recipients one route may carry — a list, not a mailing system. */
export const MAX_RECIPIENTS = 20;

/**
 * Whether a string names a route kind V094 accepts.
 *
 * @param kind - The kind from the path.
 * @returns True for a core kind or a well-formed `custom:<slug>`.
 */
export function isRouteKind(kind: string): boolean {
  return (CORE_ROUTE_KINDS as readonly string[]).includes(kind) || CUSTOM_KIND.test(kind);
}

/**
 * The channel a kind is bound to when no route is stored for it.
 *
 * @param kind - A valid kind.
 * @returns Its default channel.
 */
export function defaultChannel(kind: string): NotificationRouteChannel {
  return DEFAULT_CHANNELS[kind as CoreRouteKind] ?? "email";
}

/**
 * Why a channel cannot deliver in this build, or `null` when it can — the locked-row rule.
 *
 * @param channel - The channel.
 * @returns The reason the card prints (*connect PagerDuty first*), or null for email.
 */
export function channelLock(channel: NotificationRouteChannel): string | null {
  switch (channel) {
    case "email":
      return null;
    case "slack":
      return "connect Slack first";
    case "pagerduty":
      return "connect PagerDuty first";
  }
}

/**
 * What is wrong with a route config, field by field — empty when it is well formed.
 *
 * @param config - The config from the request, untrusted.
 * @returns `{ "config.time": ["…"] }`-shaped problems, keyed by the field a form highlights.
 */
export function configProblems(config: unknown): Record<string, string[]> {
  const problems: Record<string, string[]> = {};
  const add = (field: string, message: string): void => {
    (problems[field] ??= []).push(message);
  };

  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    add("config", "config must be an object");
    return problems;
  }

  const entries = config as Record<string, unknown>;

  for (const key of Object.keys(entries)) {
    if (key !== "time" && key !== "weekday" && key !== "recipients") {
      add(`config.${key}`, `${key} is not a route setting — use time, weekday or recipients`);
    }
  }

  if ("time" in entries && (typeof entries.time !== "string" || !TIME.test(entries.time))) {
    add("config.time", "time must be HH:MM, 00:00 to 23:59 (UTC)");
  }

  if (
    "weekday" in entries &&
    (typeof entries.weekday !== "string" ||
      !(WEEKDAYS as readonly string[]).includes(entries.weekday))
  ) {
    add("config.weekday", "weekday must be monday … sunday");
  }

  if ("recipients" in entries) {
    const recipients = entries.recipients;

    if (!Array.isArray(recipients) || recipients.length === 0) {
      add("config.recipients", "recipients must be a non-empty list of email addresses");
    } else if (recipients.length > MAX_RECIPIENTS) {
      add("config.recipients", `a route carries at most ${String(MAX_RECIPIENTS)} recipients`);
    } else {
      for (const recipient of recipients) {
        if (typeof recipient !== "string" || !ADDRESS.test(recipient)) {
          add("config.recipients", `${String(recipient)} is not an email address`);
        }
      }
    }
  }

  return problems;
}

/**
 * A validated config, normalised: recipients trimmed of duplicates, keys in a fixed order.
 *
 * @param config - A config {@link configProblems} found nothing wrong with.
 * @returns The config as it is stored and compared.
 */
export function normalisedConfig(config: NotificationRouteConfig): NotificationRouteConfig {
  const normalised: NotificationRouteConfig = {};

  if (config.time !== undefined) normalised.time = config.time;
  if (config.weekday !== undefined) normalised.weekday = config.weekday;
  if (config.recipients !== undefined) {
    normalised.recipients = [...new Set(config.recipients.map((r) => r.toLowerCase()))];
  }

  return normalised;
}

/**
 * The ISO day (Monday 1 … Sunday 7) a weekday names.
 *
 * @param weekday - `monday` … `sunday`.
 * @returns The ISO day; Monday for anything else, the weekly digest's own default.
 */
export function isoDayOf(weekday: string | undefined): number {
  const index = (WEEKDAYS as readonly string[]).indexOf(weekday ?? "monday");

  return index === -1 ? 1 : index + 1;
}
