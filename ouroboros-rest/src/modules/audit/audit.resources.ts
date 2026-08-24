/**
 * What `GET /api/v1/providers/audit` answers with — one event, as a client reads it.
 *
 * AD.4 ([#225](https://github.com/NobuData/ouroboros/issues/225)).
 *
 * **The row and the resource are separated here for the reason they are everywhere else in
 * this service**: a column added to `audit_events` later must not become a response field
 * because nobody looked. That rule carries more weight on this table than on most, because
 * this is the one surface that publishes what a workspace's administrators have done with
 * its credentials — so what leaves the process is enumerated by hand, once, here.
 *
 * `organization_id` is deliberately absent. The caller's workspace is the caller's session,
 * so echoing it into every row of every page would be telling a client something it supplied.
 */

import type { AuditEventRow } from "./audit.repository";

/** One event of a workspace's trail. */
export interface AuditEventResource {
  /** The event's own id — what a support conversation names. */
  id: string;
  /** When it happened, ISO-8601 in UTC. */
  occurredAt: string;
  /**
   * Who did it — `"user".id`, or `null`.
   *
   * Two different `null`s, and the resource does not distinguish them because the reader
   * cannot act on the difference: a lease grant never had an actor, and a deleted person left
   * one behind. {@link AuditEventResource.actorName} is `null` in both cases too.
   */
  actorId: string | null;
  /**
   * Their name, or `null`.
   *
   * A name and never an address. `"user".email` is deliberately not selected — a trail that
   * is a list of email addresses is a trail that is worth exfiltrating, and the sheet renders
   * a person, not a mailbox.
   */
  actorName: string | null;
  /** What happened — one of `audit.events.ts`'s {@link AUDIT_ACTIONS}. */
  action: string;
  /** What kind of thing it was about — `provider_connection`, `run`. */
  subjectType: string;
  /** Which one, or `null` when the event named a kind rather than an instance. */
  subjectId: string | null;
  /**
   * Where from, or `null` when no address was knowable.
   *
   * See `audit.context.ts` on what this honestly means behind a proxy — it is the address the
   * API saw, which is the only one it can state without being told which proxies to believe.
   */
  ip: string | null;
  /**
   * The rest of what happened — the step-up method, the caps that moved, the outcome.
   *
   * Flat and scalar by construction, and carrying no secret material: see
   * `audit.events.ts`, and `audit.secrecy.spec.ts` for the grep that holds it to that over
   * the rows a full credential lifecycle actually writes.
   */
  detail: Record<string, string | number | boolean | null>;
}

/**
 * Render one row of the trail.
 *
 * @param row - What the repository selected, actor name included.
 * @returns The resource, with the instant as ISO-8601 — the same convention every other
 *   timestamp in this API uses, because a client that has to know which endpoints send epoch
 *   milliseconds is a client with a date bug waiting in it.
 */
export function auditEventResource(row: AuditEventRow): AuditEventResource {
  return {
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    actorId: row.actor_id,
    actorName: row.actor_name,
    action: row.action,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    ip: row.ip,
    detail: row.detail,
  };
}
