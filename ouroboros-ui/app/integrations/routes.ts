/**
 * The Notifications card's rules and copy, as values
 * (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495)).
 *
 * The card draws the workspace's **org-level** notification routes (BR.4, #488): which kind of
 * event goes to which channel, whether the workspace wants it, and — the part that matters —
 * whether it can actually fire. Everything the card decides is here:
 *
 * - **The fields** the card puts into the page's dirty state: one switch per route, the daily
 *   digest's time and the weekly report's recipients ({@link routesBaseline}).
 * - **The locked-row rule**, mirrored from the service: a route whose channel has no connection
 *   in this build cannot be enabled from this card ({@link mayToggle}). The service refuses it
 *   too (`409 notification_route_locked`); this only keeps the card from offering it.
 * - **The patches** a save sends — one per changed route, each carrying the route's *whole*
 *   config, because the service replaces `config` rather than merging it ({@link routePatches}).
 *
 * These routes are the one store of org bindings — the ChatOps routing card (#543) edits the
 * same resource — so nothing here keeps state of its own beyond the page's unsaved edits.
 *
 * Framework-free and pure.
 */

import type {
  NotificationRoute,
  NotificationRouteChannel,
  NotificationRouteConfig,
  NotificationRoutePatch,
  NotificationRoutes,
} from "@/app/api/settings-integrations";

/* ------------------------------------------------------------------ the kinds */

/** The route that mails the workspace's open decisions once a day. */
export const DAILY_DIGEST = "daily_digest";

/** The route that mails the Insights digest once a week. */
export const WEEKLY_INSIGHTS = "weekly_insights";

/** When a mailing route sends if its config names no time — the service's default. */
export const DEFAULT_TIME = "09:00";

/** The day the weekly route sends if its config names none — the service's default. */
export const DEFAULT_WEEKDAY = "monday";

/** What each channel is called on the card. */
export const CHANNEL_NAMES: Readonly<Record<NotificationRouteChannel, string>> = {
  email: "email",
  slack: "Slack",
  pagerduty: "PagerDuty",
};

/** What each core route is called, and where the mockup says it goes. */
const CORE_TITLES: Readonly<Record<string, { readonly what: string; readonly to: string }>> = {
  needs_you_dm: { what: "Needs-you decisions", to: "Slack DM" },
  daily_digest: { what: "Daily digest", to: "email" },
  loop_failures: { what: "Loop failures", to: "PagerDuty" },
  weekly_insights: { what: "Weekly insights report", to: "email" },
};

/** The line under each core route's title — the mockup's, where it promises nothing unbuilt. */
const CORE_WHY: Readonly<Record<string, string>> = {
  needs_you_dm: "approvals, waivers, allow-once requests",
  daily_digest: "merges, spend, interventions since yesterday",
  loop_failures: "a loop that stops and cannot recover on its own",
};

/* ------------------------------------------------------------------ the fields */

/** The card's fields, by name: a boolean per route's switch, a string per editor. */
export type RouteValues = Readonly<Record<string, boolean | string>>;

/** The daily digest's time field. */
export const TIME_FIELD = `time:${DAILY_DIGEST}`;

/** The weekly report's recipients field. */
export const RECIPIENTS_FIELD = `recipients:${WEEKLY_INSIGHTS}`;

/**
 * The name of a route's switch field.
 *
 * @param kind The route's kind.
 * @returns `enabled:<kind>`.
 */
export function enabledField(kind: string): string {
  return `enabled:${kind}`;
}

/**
 * One route, by kind.
 *
 * @param routes The routes as read.
 * @param kind The kind.
 * @returns The route, or `undefined` when the service did not list it.
 */
function routeOf(routes: NotificationRoutes, kind: string): NotificationRoute | undefined {
  return routes.items.find((route) => route.kind === kind);
}

/**
 * The card's saved values — what the page's dirty state is measured against.
 *
 * @param routes The routes as read.
 * @returns A switch per route; the digest's time and the weekly recipients when those routes
 *   are listed. Recipients are one string, addresses separated by a comma and a space.
 */
export function routesBaseline(routes: NotificationRoutes): RouteValues {
  const values: Record<string, boolean | string> = {};

  for (const route of routes.items) values[enabledField(route.kind)] = route.enabled;

  const digest = routeOf(routes, DAILY_DIGEST);
  if (digest !== undefined) values[TIME_FIELD] = digest.config.time ?? DEFAULT_TIME;

  const weekly = routeOf(routes, WEEKLY_INSIGHTS);
  if (weekly !== undefined) values[RECIPIENTS_FIELD] = (weekly.config.recipients ?? []).join(", ");

  return values;
}

/* ------------------------------------------------------------------ the copy */

/**
 * A route's name without its settings — what its switch and its errors are called.
 *
 * @param route The route's kind and channel.
 * @returns `Daily digest → email`; for a custom kind, the kind and its channel.
 */
export function routeName(route: Pick<NotificationRoute, "kind" | "channel">): string {
  const core = CORE_TITLES[route.kind];

  return core === undefined
    ? `${route.kind} → ${CHANNEL_NAMES[route.channel]}`
    : `${core.what} → ${core.to}`;
}

/**
 * A route's title as the row prints it.
 *
 * @param route The route.
 * @param time The digest's time as it stands on the card — the unsaved value while there is one.
 * @returns The name; the daily digest's carries its time, in UTC and saying so.
 */
export function routeTitle(
  route: Pick<NotificationRoute, "kind" | "channel">,
  time: string = DEFAULT_TIME,
): string {
  if (route.kind !== DAILY_DIGEST) return routeName(route);

  const core = CORE_TITLES[DAILY_DIGEST];

  return `${core.what} ${time} UTC → ${core.to}`;
}

/**
 * Who a mailing route reaches.
 *
 * @param recipients The addresses as they stand on the card.
 * @returns `to a@b.dev, c@d.dev`, or the service's fallback said plainly.
 */
export function recipientsLine(recipients: readonly string[]): string {
  return recipients.length === 0
    ? "to the workspace's owners and admins"
    : `to ${recipients.join(", ")}`;
}

/**
 * The line under a route's title.
 *
 * The weekly report's is its day and who it mails — an **email list**, never a Slack channel:
 * the mockup's `#eng-leads` is not something this build can deliver to.
 *
 * @param route The route.
 * @param recipients The weekly recipients as they stand on the card.
 * @returns The line, or `null` for a custom kind, which has none.
 */
export function routeWhy(
  route: Pick<NotificationRoute, "kind" | "config">,
  recipients: readonly string[] = route.config.recipients ?? [],
): string | null {
  if (route.kind === WEEKLY_INSIGHTS) {
    const weekday = route.config.weekday ?? DEFAULT_WEEKDAY;
    const day = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}s`;

    return `${day}, from the Insights screen · ${recipientsLine(recipients)}`;
  }

  return CORE_WHY[route.kind] ?? null;
}

/** What a field is called in the sentence that reports a refusal. */
export const TIME_LABEL = "Daily digest time (UTC)";

/** The time editor's hint. */
export const TIME_HINT = "24-hour, UTC.";

/** What the recipients editor is called. */
export const RECIPIENTS_LABEL = "Weekly insights recipients";

/** The recipients editor's hint — including what an empty list means. */
export const RECIPIENTS_HINT =
  "Email addresses, separated by commas or new lines. Left empty, the workspace's owners and admins receive it.";

/** The word beside the lock. */
export const LOCKED_WORD = "locked";

/** What a locked route that is nevertheless saved *on* is told. */
export const SAVED_ON_CANNOT_FIRE = "Saved on, but it cannot fire. It can only be switched off.";

/** A route's position, in words, for a reader with nothing to operate. */
export const ON_WORD = "on";

/** The other position. */
export const OFF_WORD = "off";

/**
 * A field label for every field of the card.
 *
 * @param routes The routes as read.
 * @returns Labels by field name.
 */
export function routeLabels(routes: NotificationRoutes): Readonly<Record<string, string>> {
  const labels: Record<string, string> = {};

  for (const route of routes.items) labels[enabledField(route.kind)] = routeName(route);
  if (routeOf(routes, DAILY_DIGEST) !== undefined) labels[TIME_FIELD] = TIME_LABEL;
  if (routeOf(routes, WEEKLY_INSIGHTS) !== undefined) labels[RECIPIENTS_FIELD] = RECIPIENTS_LABEL;

  return labels;
}

/* ------------------------------------------------------------------ the lock */

/**
 * Whether a route's switch may be offered.
 *
 * The locked-row rule: a route on a channel that cannot deliver **cannot be switched on here**.
 * A locked route that is saved *on* (the data permits it) keeps its switch so it can be switched
 * off — and back to its saved position before saving, which writes nothing.
 *
 * @param route The route's lock and its saved position.
 * @param draftEnabled Its position as it stands on the card.
 * @returns `true` for an unlocked route; for a locked one, only while it is on somewhere — saved
 *   or on the card — so the only move the switch can make is toward *off* or back to what is saved.
 */
export function mayToggle(
  route: Pick<NotificationRoute, "locked" | "enabled">,
  draftEnabled: boolean,
): boolean {
  return !route.locked || route.enabled || draftEnabled;
}

/** Where a locked row's link leads. */
export interface UnlockLink {
  /** The Integrations section of the page the card is on. */
  readonly href: string;
  /** *See PagerDuty in Integrations*. */
  readonly text: string;
}

/** The Integrations section, as a fragment of the settings page. */
export const INTEGRATIONS_HASH = "#integrations";

/**
 * The link from a locked row to the integration that would unlock it.
 *
 * @param channel The route's channel.
 * @returns The link.
 */
export function unlockLink(channel: NotificationRouteChannel): UnlockLink {
  return { href: INTEGRATIONS_HASH, text: `See ${CHANNEL_NAMES[channel]} in Integrations` };
}

/* ------------------------------------------------------------------ validation */

/** `HH:MM`, 00:00–23:59 — the service's pattern. */
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** The service's address pattern: something, an @, something with a dot. */
const ADDRESS = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** What a time that is not `HH:MM` is told. */
export const TIME_INVALID = "Enter a time as HH:MM, 00:00 to 23:59.";

/**
 * The addresses in the recipients field.
 *
 * @param text The field as typed.
 * @returns The addresses, trimmed, in order, without blanks or repeats.
 */
export function parseRecipients(text: string): readonly string[] {
  const seen = new Set<string>();

  for (const part of text.split(/[\s,;]+/)) {
    if (part !== "") seen.add(part);
  }

  return [...seen];
}

/**
 * Check the card before anything is sent.
 *
 * @param draft Every field as it stands.
 * @returns An error per field that is wrong; empty when the card may be sent.
 */
export function validateRoutes(draft: RouteValues): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};

  const time = draft[TIME_FIELD];
  if (typeof time === "string" && !TIME.test(time)) errors[TIME_FIELD] = TIME_INVALID;

  const recipients = draft[RECIPIENTS_FIELD];
  if (typeof recipients === "string") {
    const wrong = parseRecipients(recipients).filter((address) => !ADDRESS.test(address));

    if (wrong.length > 0) {
      errors[RECIPIENTS_FIELD] =
        `${wrong.join(", ")} ${wrong.length === 1 ? "is not an email address" : "are not email addresses"}.`;
    }
  }

  return errors;
}

/* ------------------------------------------------------------------ the patches */

/** One route's write. */
export interface RoutePatch {
  /** The route. */
  readonly kind: string;
  /** What it is called, for the sentence that reports what landed and what did not. */
  readonly name: string;
  /** The body. */
  readonly patch: NotificationRoutePatch;
}

/**
 * A route's config with the card's edits applied — whole, because the service replaces it.
 *
 * @param route The route as read.
 * @param draft Every field as it stands.
 * @param baseline The saved values.
 * @returns The config to send, or `undefined` when no editor of this route changed.
 */
function configEdit(
  route: NotificationRoute,
  draft: RouteValues,
  baseline: RouteValues,
): NotificationRouteConfig | undefined {
  if (route.kind === DAILY_DIGEST && draft[TIME_FIELD] !== baseline[TIME_FIELD]) {
    return { ...route.config, time: String(draft[TIME_FIELD]) };
  }

  if (route.kind === WEEKLY_INSIGHTS && draft[RECIPIENTS_FIELD] !== baseline[RECIPIENTS_FIELD]) {
    const recipients = parseRecipients(String(draft[RECIPIENTS_FIELD]));
    const rest: NotificationRouteConfig = { ...route.config };
    delete rest.recipients;

    // No addresses means the key is absent: the owners and admins receive it.
    return recipients.length === 0 ? rest : { ...rest, recipients: [...recipients] };
  }

  return undefined;
}

/**
 * What a save sends: one patch per route that changed, in the card's order.
 *
 * @param draft Every field as it stands.
 * @param baseline The saved values ({@link routesBaseline}).
 * @param routes The routes as read — the order, and each route's config to build on.
 * @returns The patches. Empty when nothing changed.
 */
export function routePatches(
  draft: RouteValues,
  baseline: RouteValues,
  routes: NotificationRoutes,
): readonly RoutePatch[] {
  return routes.items.flatMap((route) => {
    const field = enabledField(route.kind);
    const config = configEdit(route, draft, baseline);
    const moved = draft[field] !== baseline[field];

    if (!moved && config === undefined) return [];

    return [
      {
        kind: route.kind,
        name: routeName(route),
        patch: {
          ...(moved ? { enabled: draft[field] === true } : {}),
          ...(config === undefined ? {} : { config }),
        },
      },
    ];
  });
}

/* ------------------------------------------------------------------ refusals */

/** The sentence for a refusal the service gave no words for. */
export const ROUTE_SAVE_FAILED = "The route could not be saved. Try again.";

/** What a refusal of the first route means for the card. */
export const ROUTES_NOT_SAVED = "No notification route was saved.";

/**
 * What a refused route is told, from the service's answer.
 *
 * @param code The refusal's code.
 * @param message The service's sentence.
 * @param details The refusal's details — a locked route's carry the reason the card prints.
 * @returns One sentence.
 */
export function routeRefusal(code: string, message: string, details: unknown): string {
  const reason =
    typeof details === "object" && details !== null
      ? (details as { reason?: unknown }).reason
      : undefined;

  if (code === "notification_route_locked" && typeof reason === "string" && reason !== "") {
    return `This route is locked and cannot be switched on: ${reason}.`;
  }

  return message || ROUTE_SAVE_FAILED;
}

/**
 * The card's sentence when a save stopped part-way.
 *
 * @param landed The names of the routes that were saved before the refusal, in order.
 * @param refused The name of the route that was refused.
 * @param message Why.
 * @returns What was saved and what was not.
 */
export function routesNotSaved(
  landed: readonly string[],
  refused: string,
  message: string,
): string {
  return landed.length === 0
    ? `${ROUTES_NOT_SAVED} ${refused}: ${message}`
    : `Saved: ${landed.join("; ")}. Not saved — ${refused}: ${message}`;
}

/**
 * Route a refusal's fields to the card's controls.
 *
 * @param kind The route that was refused.
 * @param details The `ApiError`'s details.
 * @returns Errors for the route's editor — `config.time` on the digest's time, `config.recipients`
 *   (or one of its entries) on the weekly recipients. A field the card has no control for is left
 *   to the refusal's sentence.
 */
export function routeFieldErrors(kind: string, details: unknown): Readonly<Record<string, string>> {
  if (typeof details !== "object" || details === null) return {};
  const fields = (details as { fields?: unknown }).fields;
  if (typeof fields !== "object" || fields === null) return {};

  const errors: Record<string, string> = {};

  for (const [path, messages] of Object.entries(fields as Record<string, unknown>)) {
    const first: unknown = Array.isArray(messages) ? messages[0] : messages;
    if (typeof first !== "string" || first === "") continue;

    if (kind === DAILY_DIGEST && path === "config.time") errors[TIME_FIELD] ??= first;
    if (kind === WEEKLY_INSIGHTS && path.startsWith("config.recipients")) {
      errors[RECIPIENTS_FIELD] ??= first;
    }
  }

  return errors;
}

/**
 * What the seat says when the routes could not be read.
 *
 * @param reason The service's sentence.
 * @returns The note.
 */
export function routesUnread(reason: string): string {
  return `The notification routes could not be read. ${reason}`.trim();
}
