/**
 * What the audit plane answers with (BR.2, [#486](https://github.com/NobuData/ouroboros/issues/486)).
 *
 * One event resource serves the list and the CSV, so *an exported CSV and a screenshot never
 * disagree* is a property of sharing a function rather than of two renderers being kept in step.
 * It is the trail's resource (`audit/audit.resources.ts`, enumerated by hand so a new column never
 * leaks by accident) plus three fields: the plane, and the composed `actor` and `event`.
 */

import { auditEventResource, type AuditEventResource } from "../audit/audit.resources";
import type { AuditActorKind } from "../db/schema";
import type { AuditPlaneRow } from "./audit-plane.repository";
import { actorLabel, eventSentence } from "./audit-plane.sentences";

/** One event of the plane. */
export interface AuditPlaneEventResource extends AuditEventResource {
  /** The action's family — `policy`. */
  plane: string;
  /** Who, as the card prints it — `Ken`, `ouroboros-app[bot]`, `service:devops-bot`, `system`. */
  actor: string;
  /** What happened, composed from the row's facts — `rotated Anthropic API key`. */
  event: string;
}

/** One keyset page. */
export interface AuditPlanePage {
  /** The events, newest first. */
  items: AuditPlaneEventResource[];
  /** The token for the next page, or `null` on the last page. */
  nextCursor: string | null;
  /** The page size this answer was cut to. */
  limit: number;
}

/** One line of the card's today view — `14:31 · ouroboros-app[bot] · pushed PR #514 rev 2`. */
export interface AuditTodayRow {
  /** The event's id. */
  id: string;
  /** When, ISO-8601 UTC. */
  occurredAt: string;
  /** When, as the card prints it — `HH:MM`, 24-hour, in the requested zone. */
  time: string;
  /** What kind of actor — the card styles bots and the system differently. */
  actorKind: AuditActorKind;
  /** Who, as the card prints it. */
  actor: string;
  /** What happened. */
  event: string;
}

/** The card's today view, and its footer's retention promise. */
export interface AuditTodayResource {
  /** The IANA zone *today* and each `time` were taken in. */
  timeZone: string;
  /** Local midnight in that zone, ISO-8601 UTC — where *today* starts. */
  since: string;
  /** Today's events, newest first, at most the requested limit. */
  rows: AuditTodayRow[];
  /** Whether more of today's events exist than `rows` holds. */
  more: boolean;
  /** The workspace's `audit` tier — the footer's `retained 400d`. */
  retainedDays: number;
}

/**
 * Render one row of the plane.
 *
 * @param row - What the repository selected.
 * @returns The resource.
 */
export function auditPlaneEventResource(row: AuditPlaneRow): AuditPlaneEventResource {
  return {
    ...auditEventResource(row),
    plane: row.plane,
    actor: actorLabel(row),
    event: eventSentence(row),
  };
}

/**
 * Render one row as a line of the today view.
 *
 * @param row - What the repository selected.
 * @param clock - Formats an instant as `HH:MM` in the view's zone.
 * @returns The line.
 */
export function auditTodayRow(row: AuditPlaneRow, clock: (at: Date) => string): AuditTodayRow {
  return {
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    time: clock(row.occurred_at),
    actorKind: row.actor_kind,
    actor: actorLabel(row),
    event: eventSentence(row),
  };
}

/**
 * A clock for one zone — `HH:MM`, 24-hour.
 *
 * @param timeZone - An IANA zone, already validated.
 * @returns The formatter.
 */
export function clockIn(timeZone: string): (at: Date) => string {
  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  return (at) => format.format(at);
}
