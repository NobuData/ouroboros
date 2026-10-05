import type { AuditLogEvent, AuditLogPage, AuditToday, AuditTodayRow } from "@/app/api/settings-audit";

/**
 * The Audit Log card's fixtures (BS.5, #495) — mockup 17's five rows as
 * `GET /api/v1/settings/audit/today` answers them for the seeded workspace, and builders for the
 * filtered log's pages.
 */

/** The day the fixture rows happened on, UTC. */
export const AUDIT_DAY = "2026-10-05";

/** Mockup 17's five rows: time, actor kind, actor, event. */
const MOCKUP_ROWS: readonly (readonly [string, AuditTodayRow["actorKind"], string, string])[] = [
  ["14:31", "bot", "ouroboros-app[bot]", "pushed PR #514 rev 2"],
  ["14:12", "human", "Ken", "rotated Anthropic API key"],
  ["13:48", "human", "Ken", "enabled auto-merge (policy v7)"],
  ["13:22", "human", "Maya", "approved waiver on PR #509"],
  ["12:04", "system", "system", "runner forge-03 marked offline"],
];

/**
 * The today view as an owner reads it: the mockup's five rows, retained 400 days.
 *
 * @param overrides Fields to replace.
 * @returns The payload.
 */
export function auditToday(overrides: Partial<AuditToday> = {}): AuditToday {
  return {
    timeZone: "UTC",
    since: `${AUDIT_DAY}T00:00:00.000Z`,
    rows: MOCKUP_ROWS.map(([time, actorKind, actor, event], index) => ({
      id: `a0d17000-0000-4000-8000-00000000000${String(index + 1)}`,
      occurredAt: `${AUDIT_DAY}T${time}:00.000Z`,
      time,
      actorKind,
      actor,
      event,
    })),
    more: false,
    retainedDays: 400,
    ...overrides,
  };
}

/**
 * One event of the filtered log.
 *
 * @param overrides Fields to replace — at least an `id` when a page holds several.
 * @returns The event: Ken rotating the Anthropic key, unless told otherwise.
 */
export function auditLogEvent(overrides: Partial<AuditLogEvent> = {}): AuditLogEvent {
  return {
    id: "a0d17000-0000-4000-8000-000000000002",
    occurredAt: `${AUDIT_DAY}T14:12:00.000Z`,
    actorId: "user-ken",
    actorName: "Ken Suenobu",
    actorKind: "human",
    actorService: null,
    action: "provider.rotated",
    plane: "provider",
    subjectType: "provider_connection",
    subjectId: "conn-anthropic",
    ip: null,
    detail: {},
    actor: "Ken",
    event: "rotated Anthropic API key",
    ...overrides,
  };
}

/**
 * One keyset page of the filtered log.
 *
 * @param items The page's events. Defaults to the one fixture event.
 * @param nextCursor Where the next page starts, or `null` on the last page.
 * @returns The page.
 */
export function auditLogPage(
  items: readonly AuditLogEvent[] = [auditLogEvent()],
  nextCursor: string | null = null,
): AuditLogPage {
  return { items: [...items], nextCursor, limit: 50 };
}

/**
 * Several distinct events, newest first, a minute apart.
 *
 * @param count How many.
 * @param prefix What their ids start with, so two pages do not collide.
 * @returns The events.
 */
export function auditLogEvents(count: number, prefix = "page"): AuditLogEvent[] {
  return Array.from({ length: count }, (_, index) =>
    auditLogEvent({
      id: `${prefix}-${String(index)}`,
      occurredAt: new Date(Date.parse(`${AUDIT_DAY}T14:00:00.000Z`) - index * 60_000).toISOString(),
      event: `event ${prefix} ${String(index)}`,
    }),
  );
}
