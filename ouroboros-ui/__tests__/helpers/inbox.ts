/**
 * The Needs-You inbox as the service sends it (BO.1, #466) — the dev seed's three cards (#460):
 * a merge approval, a protected-path allow-once and a claim waiver, headed *3 decisions. About 90
 * seconds of your time.*
 */

import type {
  InboxItem,
  InboxQueue,
  InboxSnoozedItem,
  NotificationPreferences,
} from "@/app/api/inbox";
import type { InboxReadings } from "@/app/inbox/data";

/** When the fixtures were read. */
export const INBOX_READ_AT = Date.parse("2026-10-04T13:20:00.000Z");

/** One asking item, with overrides. */
export function inboxItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "5eed0082-0000-4000-8000-000000000001",
    kindId: "merge_approval",
    kindVersion: 1,
    severity: "err",
    status: "open",
    question: "Approve merge for a refactor PR?",
    why: "Policy: anything labeled refactor needs a human. 13/13 checks green, verification matrix all ✓, +214 −180 across 6 files.",
    tags: ["refactor"],
    facts: {},
    refs: [
      { type: "run", id: "5eed0009-0000-4000-8000-000000001830", label: "loop #1830" },
      { type: "pr", id: "5eed003a-0000-4000-8000-000000000504", label: "PR #504" },
      { type: "ticket", id: "5eed0001-0000-4000-8000-000000000465", label: "issue #465" },
    ],
    mergeClass: true,
    actions: [],
    createdAt: "2026-10-04T13:14:00.000Z",
    ageSeconds: 360,
    snooze: { allowed: true },
    ...overrides,
  };
}

/** The seed's three asking items, newest first. */
export function seededItems(): InboxItem[] {
  return [
    inboxItem(),
    inboxItem({
      id: "5eed0082-0000-4000-8000-000000000002",
      kindId: "protected_path_allow_once",
      severity: "warn",
      question: "Allow a one-time edit to a protected path?",
      why: "The OTA rollback fix wants to change 3 lines to boot/rollback_flag.c — a protected path.",
      mergeClass: false,
      refs: [
        { type: "run", id: "5eed0009-0000-4000-8000-000000001844", label: "loop #1844" },
        { type: "path", id: "boot/rollback_flag.c", label: "boot/rollback_flag.c" },
      ],
      ageSeconds: 1260,
    }),
    inboxItem({
      id: "5eed0082-0000-4000-8000-000000000003",
      kindId: "claim_waiver",
      severity: "warn",
      question: "Waive a claim the bench can't verify?",
      why: "“Flake must not reappear across temperature range” — the rig has no thermal chamber.",
      mergeClass: false,
      refs: [{ type: "pr", id: "5eed003a-0000-4000-8000-000000000514", label: "PR #514" }],
      ageSeconds: 2040,
    }),
  ];
}

/** One snoozed item, with overrides. */
export function snoozedItem(overrides: Partial<InboxSnoozedItem> = {}): InboxSnoozedItem {
  return {
    id: "5eed0082-0000-4000-8000-000000000009",
    kindId: "fact_review",
    severity: "info",
    question: "Should the loops trust this fact?",
    refs: [],
    createdAt: "2026-10-04T12:00:00.000Z",
    ageSeconds: 4800,
    snoozedUntil: "2026-10-04T14:20:00.000Z",
    snoozedBy: "5eed0003-0000-4000-8000-000000000001",
    reason: null,
    ...overrides,
  };
}

/** The queue, with overrides — the seed's by default. */
export function inboxQueue(overrides: Partial<InboxQueue> = {}): InboxQueue {
  return {
    head: {
      count: 3,
      noun: "decisions",
      estimateSeconds: 90,
      estimate: "About 90 seconds of your time.",
      sentence: "3 decisions. About 90 seconds of your time.",
    },
    items: seededItems(),
    snoozed: [],
    asOf: "2026-10-04T13:20:00.000Z",
    ...overrides,
  };
}

/** The empty queue, as the service heads it. */
export function emptyQueue(): InboxQueue {
  return inboxQueue({
    head: { count: 0, noun: "decisions", estimateSeconds: 0, estimate: null, sentence: "No decisions waiting." },
    items: [],
  });
}

/** What the route reads for the first paint. */
export function inboxReadings(queue: InboxQueue | null = inboxQueue()): InboxReadings {
  return {
    queue: queue === null ? { ok: false, reason: "The inbox could not be read." } : { ok: true, value: queue },
    readAt: INBOX_READ_AT,
  };
}

/** A person's notification preferences — the defaults, with overrides. */
export function preferences(overrides: Partial<NotificationPreferences> = {}): NotificationPreferences {
  return {
    digest: { enabled: false, time: "09:00", timeZone: "UTC", nextSendAt: null },
    instant: { severity: "err" },
    mutedKinds: [],
    isExplicit: false,
    updatedAt: null,
    ...overrides,
  };
}

/** A fixed clock: 13:20 → `13:20`, so a wake time an hour later reads `14:20`. */
export function utcClock(atMs: number): string {
  return new Date(atMs).toISOString().slice(11, 16);
}
