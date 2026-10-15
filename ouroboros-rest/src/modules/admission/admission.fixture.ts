/**
 * A stand-in for `AdmissionService` in suites whose subject publishes queue items but is not
 * about admission (DI.4, #1312): no item waits, nobody's enqueue is confirmed, unless a suite
 * says otherwise.
 */

import { queueItemSummary, type QueueItemSummary } from "../dashboard/resources";
import type { QueueItem } from "../db/schema";
import type { QueueWaiting } from "./admission";
import type { AdmissionService } from "./admission.service";

/** What a suite may set on the stand-in. */
export interface AdmissionStubOptions {
  /** Why every item waits; `null` (the default) for none. */
  readonly waiting?: QueueWaiting | null;
  /** Who an enqueue is confirmed by; `null` (the default) for nobody. */
  readonly confirmer?: string | null;
}

/** The read-model half of `AdmissionService`. */
export type AdmissionStub = Pick<AdmissionService, "waiting" | "summaries" | "confirmerFor">;

/**
 * An admission stand-in.
 *
 * @param options - What every answer says.
 * @returns The stub.
 */
export function admissionStub(options: AdmissionStubOptions = {}): AdmissionStub {
  const waiting = options.waiting ?? null;

  return {
    waiting: (_organizationId: string, items: readonly QueueItem[]) =>
      Promise.resolve(new Map(items.map((item) => [item.id, waiting]))),
    summaries: (_organizationId: string, items: readonly QueueItem[], now?: Date) =>
      Promise.resolve(
        items.map((item): QueueItemSummary => queueItemSummary(item, waiting, now ?? new Date())),
      ),
    confirmerFor: () => Promise.resolve(options.confirmer ?? null),
  };
}

/**
 * One queue row, unleased and unconfirmed, for suites that need a whole `queue_items` row.
 *
 * @param overrides - The columns a suite cares about.
 * @returns The row.
 */
export function queueItemRow(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "a1312000-0000-4000-8000-000000000001",
    organization_id: "acme-robotics-id",
    github_repo_id: "a1312000-0000-4000-8000-0000000000aa",
    issue_number: 482,
    issue_title: "Fix flaky CAN-bus telemetry test",
    effort: "m",
    workflow_tag: "standard-fix",
    workflow_version: 3,
    workflow_pin_reason: "explicit",
    playbook_id: null,
    position: 1,
    est_minutes: 90,
    enqueued_at: new Date("2026-10-15T09:00:00.000Z"),
    created_at: new Date("2026-10-15T09:00:00.000Z"),
    updated_at: new Date("2026-10-15T09:00:00.000Z"),
    claimed_at: null,
    claim_expires_at: null,
    claimed_by: null,
    claim_token: null,
    claim_key: null,
    confirmed_at: null,
    confirmed_by: null,
    ...overrides,
  };
}
