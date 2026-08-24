import type { AuditEvent, AuditEventPage } from "@/app/api/audit";

/**
 * The credential trail's fixtures — the seeded workspace's history, as
 * `GET /api/v1/providers/audit` actually serves it.
 *
 * **These are `R__dev_seed_audit.sql`'s rows read through the service's own resource**, not
 * fourteen plausible-looking objects: that migration writes the events, `audit.resources.ts`
 * renders them, and what comes out is what mockup 07's **Audit log** sheet draws. That is
 * what makes *the sheet renders seeded history* a claim a test in this module can make at
 * all — a fixture invented here would prove that the sheet renders *something*, which is not
 * the acceptance criterion.
 *
 * Three of the rows are the ones a fixture exists to carry, and the seed's own header argues
 * for each:
 *
 * | Row | Why it is here |
 * |---|---|
 * | a **refused rotation** | AD.4 records the failure paths, so the marker that renders `refused` must be rendered by a test rather than for the first time in production |
 * | a **lease grant with no actor** | a worker authenticates with a service key and is not somebody; a sheet that assumed an actor would render `undefined` against the one class that never has one |
 * | an event whose **subject is gone** | `provider.deleted` outlives the connection it names, which is why V022 gives `subject_id` no foreign key |
 *
 * The stamps are fixed instants rather than offsets from the clock: these fixtures back
 * assertions about rendered timestamps, and a stamp that moved with the test run would make
 * those assertions unwritable. The seed's own recent rows are relative to `now()`, which is
 * the right choice there — a developer opening the sheet wants a lived-in history — and the
 * wrong one here.
 */

/** The workspace every fixture event belongs to — the dev seed's `acme-robotics`. */
export const FIXTURE_WORKSPACE_CONNECTION = "5eed000c-0000-4000-8000-000000000001";

/** The person most of them are attributed to. */
export const FIXTURE_ACTOR = "5eed0003-0000-4000-8000-000000000001";

/** …and their name, as the sheet prints it. */
export const FIXTURE_ACTOR_NAME = "Ken Suenobu";

/**
 * One event, defaulting to a completed rotation by a named person.
 *
 * @param overrides What this case is about.
 * @returns The event as the contract serves it.
 */
export function auditEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: "5eed0015-0000-4000-8000-000000000009",
    occurredAt: "2026-08-21T16:53:00.000Z",
    actorId: FIXTURE_ACTOR,
    actorName: FIXTURE_ACTOR_NAME,
    action: "provider.rotated",
    subjectType: "provider_connection",
    subjectId: FIXTURE_WORKSPACE_CONNECTION,
    ip: "198.51.100.24",
    detail: { kind: "anthropic", outcome: "success" },
    ...overrides,
  };
}

/**
 * The seeded history, newest first — what the sheet opens on in a development stack.
 *
 * Seven of the seed's fourteen, chosen to cover every renderer branch the sheet has: a
 * completion, a refusal, an event with no actor, an event with no provider named, and the
 * three settings actions that AD.4 singles out from the general edit.
 *
 * @returns The page's items, in the order the service returns them.
 */
export function seededTrail(): readonly AuditEvent[] {
  return [
    auditEvent({
      id: "5eed0015-0000-4000-8000-000000000014",
      occurredAt: "2026-08-24T16:13:00.000Z",
      action: "provider.revealed",
      detail: { kind: "anthropic", step_up: "session", outcome: "success" },
    }),
    auditEvent({
      id: "5eed0015-0000-4000-8000-000000000013",
      occurredAt: "2026-08-24T15:23:00.000Z",
      actorId: null,
      actorName: null,
      action: "credential.lease_granted",
      subjectType: "run",
      subjectId: "5eed0009-0000-4000-8000-000000000482",
      ip: "10.0.4.20",
      detail: { kind: "ollama", ttl_seconds: 900, outcome: "success" },
    }),
    auditEvent({
      id: "5eed0015-0000-4000-8000-000000000012",
      occurredAt: "2026-08-22T11:53:00.000Z",
      actorName: "Maya Chen",
      action: "provider.enabled",
      subjectId: "5eed000c-0000-4000-8000-000000000003",
      detail: { kind: "copilot", outcome: "success" },
    }),
    auditEvent({
      id: "5eed0015-0000-4000-8000-000000000010",
      occurredAt: "2026-08-22T10:53:00.000Z",
      actorName: "Maya Chen",
      action: "provider.rotated",
      subjectId: "5eed000c-0000-4000-8000-000000000003",
      detail: { kind: "copilot", outcome: "failure", reason: "provider_validation_failed" },
    }),
    auditEvent({
      id: "5eed0015-0000-4000-8000-000000000007",
      occurredAt: "2026-08-18T10:53:00.000Z",
      action: "provider.cap_changed",
      detail: { kind: "anthropic", from_cap_cents: 40_000, to_cap_cents: 60_000, outcome: "success" },
    }),
    auditEvent({
      id: "5eed0015-0000-4000-8000-000000000006",
      occurredAt: "2026-08-15T10:53:00.000Z",
      action: "provider.tested",
      detail: { kind: "anthropic", outcome: "success", latency_ms: 38 },
    }),
    auditEvent({
      id: "5eed0015-0000-4000-8000-000000000003",
      occurredAt: "2026-06-12T16:20:00.000Z",
      action: "provider.added",
      detail: { kind: "anthropic", outcome: "success" },
    }),
  ];
}

/**
 * The page body, as the service serves it.
 *
 * @param items The events. Defaults to {@link seededTrail}.
 * @returns The `AuditEventPage` payload.
 */
export function trailPayload(items: readonly AuditEvent[] = seededTrail()): AuditEventPage {
  return { items: [...items], total: items.length, limit: 50, offset: 0 };
}
