/**
 * The resolved list's and the zero card's words and pure rules (BO.3,
 * [#468](https://github.com/NobuData/ouroboros/issues/468), mockup 16).
 *
 * **The rows are composed, not stored — and not composed here.** BN.4 (#464) renders each line
 * from the item's kind, refs and action (`subject`, then `verdict`), exactly as it renders the
 * open cards, so the history cannot drift from the cards it is a history of. This module only
 * decides how a served row is *drawn*: which words are set in mono, when a channel is worth
 * saying, and what the policy note names.
 *
 * **The list exists so the owner can see what the system did without them.** That is why a
 * `policy` resolution is drawn apart from a person's answer, and why its note names the rule that
 * fired and links to where it is configured: *why did nobody ask me about this?* has an answer
 * one hover away.
 */

import type { InboxResolved, InboxResolvedRow } from "@/app/api/inbox";

import { type WhySegment, sitePath } from "./card-view";

/** The query parameter the page's own resolved route reads the day from. */
export const RESOLVED_DAY_PARAM = "day";

/** What is said when nothing answered at all — a dropped connection, a timeout. */
export const UNREACHABLE_RESOLVED = "The resolved list could not be reached.";

/** What is said when something answered and this client could not read it as a day. */
export const UNREADABLE_RESOLVED = "The resolved list could not be read.";

/** The section's accessible name. */
export const RESOLVED_LABEL = "Resolved decisions";

/** The row's mark, and how a screen reader hears it. */
export const RESOLVED_MARK = "✓";
export const RESOLVED_MARK_LABEL = "Resolved";

/** The pager's three controls, and why *Earlier* can be inert. */
export const EARLIER_LABEL = "Earlier";
export const LATER_LABEL = "Later";
export const TODAY_LABEL = "Today";
export const PAGER_LABEL = "Resolved history";
export const NO_EARLIER_DAY = "No earlier day has resolved decisions.";
export const DAY_NOT_READ = "This day has not been read yet.";

/** What a day's list says while it is being read. */
export const READING_DAY = "Reading…";

/** The policy note: its control's name, its lead-in, and its link. */
export const POLICY_NOTE_LABEL = "Why nobody was asked";
export const POLICY_RULE_LEAD = "Rule";
export const POLICY_CONFIGURE = "Configure";

/** The zero card's two lines, verbatim from the mockup — the second is a claim the policy card keeps. */
export const ZERO_LABEL = "Inbox zero";
export const ZERO_LINE = "Inbox zero. The loop is turning on its own.";
export const ZERO_NOTE = "You'll be pinged only when policy says so.";

/** How each channel is named beside a row. The web is where this page is: it goes unsaid. */
const CHANNEL_LABELS: Readonly<Record<InboxResolvedRow["channel"], string | null>> = {
  web: null,
  email: "email",
  github: "GitHub",
  slack: "Slack",
  push: "push",
  api: "API",
};

/** The months, as a day's label names them. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** A UTC day as the service takes it. */
const DAY_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * What the row sets in mono: a key (`#490`) or a path (`boot/rollback_flag.c`) — values read
 * character by character, as the mockup sets `#490` and `#486`.
 */
const CODE_LIKE = /#\d+|[\w.-]+(?:\/[\w.-]+)+/g;

/** A row's channel, as it is drawn. */
export interface ChannelNote {
  /** The tag's text — `email`. */
  readonly label: string;
  /** What the tag means, for a tooltip and a screen reader — `Answered from email by Maya Chen`. */
  readonly title: string;
}

/** What a policy row's note names. */
export interface PolicyNote {
  /** The rule that fired — `auto_accept_resize`. */
  readonly rule: string;
  /** The org policy version it fired under, when the resolution recorded one. */
  readonly version: number | null;
  /** Where the rule is configured — a path on this site. */
  readonly href: string;
}

/**
 * Read a day out of something untrusted — a query parameter, a stored value.
 *
 * @param value The candidate.
 * @returns The day when it is a real `YYYY-MM-DD` date, otherwise `null` (which means *today*).
 */
export function parseDay(value: string | null | undefined): string | null {
  const match = typeof value === "string" ? DAY_SHAPE.exec(value) : null;

  if (match === null) return null;

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));

  // `2026-02-31` parses to March: a date that does not survive the round trip is not one.
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? match[0]
    : null;
}

/**
 * A day, as the heading names it.
 *
 * @param day A UTC day, `YYYY-MM-DD`.
 * @returns `Oct 3, 2026`; the day as given when it is not a date.
 */
export function dayLabel(day: string): string {
  const match = parseDay(day) === null ? null : DAY_SHAPE.exec(day);

  return match === null ? day : `${MONTHS[Number(match[2]) - 1]!} ${String(Number(match[3]))}, ${match[1]!}`;
}

/**
 * Whether a served day is the service's today — the one day with no day after it.
 *
 * @param resolved The day, as served.
 * @returns `true` for today.
 */
export function isToday(resolved: Pick<InboxResolved, "nextDay">): boolean {
  return resolved.nextDay === null;
}

/**
 * The section's heading — *Resolved today · 5*.
 *
 * @param resolved The day on screen, or `null` while it has not been read.
 * @param asked The day asked for, or `null` for today — what the heading names until it is read.
 * @returns `Resolved today · 5`, `Resolved Oct 3, 2026 · 4`, or the day alone while unread.
 */
export function resolvedHeading(resolved: InboxResolved | null, asked: string | null): string {
  if (resolved === null) return asked === null ? "Resolved today" : `Resolved ${dayLabel(asked)}`;

  const when = isToday(resolved) ? "today" : dayLabel(resolved.day);

  return `Resolved ${when} · ${String(resolved.count)}`;
}

/**
 * What a day with no resolutions says — a quiet line, never an empty box.
 *
 * @param resolved The day, as served.
 * @returns The line.
 */
export function emptyDayLine(resolved: InboxResolved): string {
  return isToday(resolved)
    ? "Nothing has been resolved today."
    : `Nothing was resolved on ${dayLabel(resolved.day)}.`;
}

/**
 * A row's subject, cut into prose and mono spans.
 *
 * @param subject What the decision was about, as the service composed it.
 * @returns The subject in order; concatenating every `text` gives it back.
 */
export function summarySegments(subject: string): WhySegment[] {
  const segments: WhySegment[] = [];
  let at = 0;

  for (const match of subject.matchAll(CODE_LIKE)) {
    if (match.index > at) segments.push({ text: subject.slice(at, match.index), mono: false });

    segments.push({ text: match[0], mono: true });
    at = match.index + match[0].length;
  }

  if (at < subject.length) segments.push({ text: subject.slice(at), mono: false });

  return segments;
}

/**
 * The channel a row was answered from, when that is worth saying.
 *
 * An answer from email or GitHub is the evidence that answer-from-anywhere works, so it is shown;
 * an answer from this page is the unremarkable case and a policy's "channel" is not a place a
 * person answered from, so neither is.
 *
 * @param row The row.
 * @returns The tag and what it means, or `null` when there is nothing to say.
 */
export function channelNote(row: Pick<InboxResolvedRow, "resolver" | "channel" | "actor">): ChannelNote | null {
  const label = row.resolver === "human" ? CHANNEL_LABELS[row.channel] : null;

  if (label === null) return null;

  return {
    label,
    title: row.actor === null ? `Answered from ${label}` : `Answered from ${label} by ${row.actor.name}`,
  };
}

/**
 * What a policy row's note names: the rule that fired and where it is configured.
 *
 * Only a rule somebody can configure gets a note — `source_resolved` (the item's source settled
 * the question) arrives with no destination, and a note that named it would point at nothing.
 *
 * @param row The row.
 * @returns The note, or `null` for a person's answer and for a policy with nowhere to lead.
 */
export function policyNote(
  row: Pick<InboxResolvedRow, "resolver" | "policy" | "policyHref" | "outcome">,
): PolicyNote | null {
  const href = sitePath(row.policyHref);

  if (row.resolver !== "policy" || row.policy === null || href === null) return null;

  const recorded = row.outcome.org_policy_version;
  const version = typeof recorded === "number" && Number.isInteger(recorded) ? recorded : null;

  return { rule: row.policy, version, href };
}
