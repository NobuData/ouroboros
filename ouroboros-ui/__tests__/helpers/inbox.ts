/**
 * The Needs-You inbox as the service sends it (BO.1, #466; cards BO.2, #467) — the dev seed's three
 * cards (#460): a merge approval, a protected-path allow-once and a claim waiver, headed *3
 * decisions. About 90 seconds of your time.* Each carries the facts its prose was composed from,
 * its refs with the destinations the service resolved, and its kind's declared action row as an
 * owner sees it.
 */

import type {
  InboxAction,
  InboxActionResult,
  InboxItem,
  InboxQueue,
  InboxResolved,
  InboxResolvedRow,
  InboxSnoozedItem,
  NotificationPreferences,
} from "@/app/api/inbox";
import type { InboxReadings } from "@/app/inbox/data";

/** When the fixtures were read. */
export const INBOX_READ_AT = Date.parse("2026-10-04T13:20:00.000Z");

/** The seeded runs and PRs the cards point at (#460). */
const RUN_1830 = "5eed0009-0000-4000-8000-000000001830";
const RUN_1844 = "5eed0009-0000-4000-8000-000000001844";
const PR_504 = "5eed003a-0000-4000-8000-000000000504";
const PR_514 = "5eed003a-0000-4000-8000-000000000514";

/** The three seeded cards' ids, newest first. */
export const MERGE_ITEM = "5eed0082-0000-4000-8000-000000000001";
export const ALLOW_ITEM = "5eed0082-0000-4000-8000-000000000002";
export const WAIVE_ITEM = "5eed0082-0000-4000-8000-000000000003";

/** One declared action as BN.4 resolves it for an owner, with overrides. */
export function inboxAction(overrides: Partial<InboxAction> & Pick<InboxAction, "id" | "label">): InboxAction {
  return {
    style: "ghost",
    requiredRole: "member",
    consequenceText: `${overrides.label} — what pressing it does.`,
    takesNote: false,
    navigates: false,
    href: null,
    allowed: true,
    disabledReason: null,
    ...overrides,
  };
}

/** `merge_approval` v1's action row (V093), resolved for an owner against PR #504. */
export function mergeActions(): InboxAction[] {
  return [
    inboxAction({
      id: "approve_merge",
      label: "Approve & merge",
      style: "primary",
      requiredRole: "approver",
      consequenceText: "Records your approval and merges the PR by its merge plan; the loop resumes.",
    }),
    inboxAction({
      id: "open_verification",
      label: "Open PR verification →",
      requiredRole: "viewer",
      consequenceText: "Opens the PR's verification page; nothing is decided.",
      navigates: true,
      href: `/prs/${PR_504}`,
    }),
    inboxAction({
      id: "return_to_loop",
      label: "Return to loop with note",
      consequenceText: "Sends the loop back with your note as steering; the PR stays unmerged.",
      takesNote: true,
    }),
  ];
}

/** `protected_path_allow_once` v1's action row (V093), resolved for an owner against loop #1844. */
export function allowOnceActions(): InboxAction[] {
  return [
    inboxAction({
      id: "allow_once",
      label: "Allow once",
      style: "primary",
      requiredRole: "approver",
      consequenceText: "Grants a single-use exception for this path on this run; the run resumes.",
    }),
    inboxAction({
      id: "view_diff",
      label: "View diff →",
      requiredRole: "viewer",
      consequenceText: "Opens the diff in the run console; nothing is decided.",
      navigates: true,
      href: `/runs/${RUN_1844}#run-changes`,
    }),
    inboxAction({
      id: "deny",
      label: "Deny",
      requiredRole: "approver",
      consequenceText: "Returns the loop with the path still protected.",
    }),
    inboxAction({
      id: "edit_protected_paths",
      label: "Edit protected paths →",
      requiredRole: "admin",
      consequenceText: "Opens the protected-path settings; nothing is decided.",
      navigates: true,
      href: "/knowledge#repo-profile",
    }),
  ];
}

/** `claim_waiver` v1's action row (V093), resolved for an owner against PR #514. */
export function waiverActions(): InboxAction[] {
  return [
    inboxAction({
      id: "waive_annotate",
      label: "Waive & annotate",
      style: "primary",
      requiredRole: "approver",
      consequenceText: "Waives the claim with your reason and annotates the PR publicly.",
      takesNote: true,
    }),
    inboxAction({
      id: "require_bench_upgrade",
      label: "Require bench upgrade",
      requiredRole: "approver",
      consequenceText: "Drafts a bench-gap ticket and leaves the claim unverified.",
    }),
    inboxAction({
      id: "see_evidence",
      label: "See evidence →",
      requiredRole: "viewer",
      consequenceText: "Opens the claim's evidence on the PR; nothing is decided.",
      navigates: true,
      href: `/prs/${PR_514}#criteria`,
    }),
  ];
}

/** One asking item — the seeded merge approval — with overrides. */
export function inboxItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: MERGE_ITEM,
    kindId: "merge_approval",
    kindVersion: 1,
    severity: "err",
    status: "open",
    question: "Approve merge for a refactor PR?",
    why: "Policy: anything labeled refactor needs a human. 13/13 checks green, verification matrix all ✓, +214 −180 across 6 files.",
    tags: ["refactor"],
    facts: {
      pr_kind: "refactor",
      policy_label: "refactor",
      checks_passed: 13,
      checks_total: 13,
      matrix_state: "all ✓",
      added: 214,
      removed: 180,
      files: 6,
    },
    refs: [
      { type: "run", id: RUN_1830, label: "loop #1830", href: `/runs/${RUN_1830}` },
      { type: "pr", id: PR_504, label: "PR #504", href: `/prs/${PR_504}` },
      { type: "ticket", id: "5eed0001-0000-4000-8000-000000000465", label: "issue #465", href: "/issues?q=%23465" },
    ],
    mergeClass: true,
    actions: mergeActions(),
    createdAt: "2026-10-04T13:12:00.000Z",
    ageSeconds: 480,
    snooze: { allowed: true },
    ...overrides,
  };
}

/** The seed's three asking items, newest first — mockup 16's `8m`, `21m` and `34m`. */
export function seededItems(): InboxItem[] {
  return [
    inboxItem(),
    inboxItem({
      id: ALLOW_ITEM,
      kindId: "protected_path_allow_once",
      severity: "warn",
      question: "Allow a one-time edit to a protected path?",
      why: "The OTA rollback fix wants to add one line to boot/rollback_flag.c — a protected path. Diff is 3 lines, shown in the run console.",
      tags: [],
      facts: {
        subject: "The OTA rollback fix",
        edit_summary: "add one line",
        path: "boot/rollback_flag.c",
        diff_lines: 3,
      },
      mergeClass: false,
      refs: [
        { type: "run", id: RUN_1844, label: "loop #1844", href: `/runs/${RUN_1844}` },
        { type: "ticket", id: "5eed0001-0000-4000-8000-000000000479", label: "issue #479", href: "/issues?q=%23479" },
        {
          type: "path",
          id: "boot/rollback_flag.c",
          label: "boot/rollback_flag.c",
          href: `/runs/${RUN_1844}#run-changes`,
        },
      ],
      actions: allowOnceActions(),
      createdAt: "2026-10-04T12:59:00.000Z",
      ageSeconds: 1260,
    }),
    inboxItem({
      id: WAIVE_ITEM,
      kindId: "claim_waiver",
      severity: "warn",
      question: "Waive a claim the bench can't verify?",
      why: "“Flake must not reappear across temperature range” — the rig has no thermal chamber. Waiving annotates the PR publicly.",
      tags: ["verification"],
      facts: {
        claim: "Flake must not reappear across temperature range",
        missing_capability: "thermal chamber",
      },
      mergeClass: false,
      refs: [{ type: "pr", id: PR_514, label: "PR #514", href: `/prs/${PR_514}` }],
      actions: waiverActions(),
      createdAt: "2026-10-04T12:46:00.000Z",
      ageSeconds: 2040,
    }),
  ];
}

/** An answered press's result — *Allow once* on the seeded card — with overrides. */
export function actionResult(overrides: Partial<InboxActionResult> = {}): InboxActionResult {
  return {
    itemId: ALLOW_ITEM,
    kindId: "protected_path_allow_once",
    status: "resolved",
    replayed: false,
    attempt: { id: "0c8e5f2a-7b14-4d39-a6e0-1f2b3c4d5e6f", idempotencyKey: "key-1" },
    resolution: {
      actionId: "allow_once",
      resolver: "human",
      policy: null,
      actor: { id: "5eed0003-0000-4000-8000-000000000001", name: "Ken Suenobu" },
      channel: "web",
      note: null,
      outcome: { run_id: RUN_1844, exception_id: "ex-1", control_id: "c-1", control_state: "pending" },
      resolvedAt: "2026-10-04T13:20:05.000Z",
    },
    receipt: {
      effects: ["exception granted", "resume sent to loop #1844"],
      links: [{ label: "Run console", href: `/runs/${RUN_1844}` }],
    },
    ...overrides,
  };
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

/** One resolved decision — the mockup's *Split #490 into 6 tickets — approved · 09:12* — with overrides. */
export function resolvedRow(overrides: Partial<InboxResolvedRow> = {}): InboxResolvedRow {
  const subject = overrides.subject ?? "Split #490 into 6 tickets";
  const verdict = overrides.verdict ?? "approved";

  return {
    itemId: "5eed0082-0000-4000-8000-000000000102",
    kindId: "split_approval",
    summary: `${subject} — ${verdict}`,
    subject,
    verdict,
    actionId: "approve_split",
    resolver: "human",
    policy: null,
    policyHref: null,
    actor: { id: "5eed0003-0000-4000-8000-000000000001", name: "Ken Suenobu" },
    channel: "web",
    note: null,
    outcome: {},
    resolvedAt: "2026-10-04T09:12:00.000Z",
    answerLatencySeconds: 41,
    loopWaitSeconds: null,
    ...overrides,
  };
}

/** The seed's five answers of today (#460), newest first — one of them a policy's. */
export function seededResolvedRows(): InboxResolvedRow[] {
  return [
    resolvedRow({
      itemId: "5eed0082-0000-4000-8000-000000000105",
      kindId: "run_needs_human",
      subject: "Add watchdog reset on I²C lockup needed a human",
      verdict: "retried with a note",
      actionId: "retry_with_note",
      channel: "push",
      note: "Retry with the bus recovery sequence.",
      resolvedAt: "2026-10-04T09:41:00.000Z",
    }),
    resolvedRow(),
    resolvedRow({
      itemId: "5eed0082-0000-4000-8000-000000000104",
      kindId: "resize_review",
      subject: "Estimator re-size #479 M→L",
      verdict: "kept the old size",
      actionId: "keep_size",
      actor: { id: "5eed0003-0000-4000-8000-000000000002", name: "Maya Chen" },
      channel: "slack",
      resolvedAt: "2026-10-04T08:58:00.000Z",
    }),
    resolvedRow({
      itemId: "5eed0082-0000-4000-8000-000000000101",
      kindId: "resize_review",
      subject: "Estimator re-size #486 L→M",
      verdict: "auto-accepted by policy",
      actionId: "accept_resize",
      resolver: "policy",
      policy: "auto_accept_resize",
      policyHref: "/settings#policies",
      actor: null,
      channel: "api",
      outcome: { org_policy_version: 7 },
      resolvedAt: "2026-10-04T08:47:00.000Z",
    }),
    resolvedRow({
      itemId: "5eed0082-0000-4000-8000-000000000103",
      kindId: "plan_sign_off",
      subject: "Plan sign-off for Rework the OTA bootloader handoff",
      verdict: "signed off",
      actionId: "sign_off",
      actor: { id: "5eed0003-0000-4000-8000-000000000002", name: "Maya Chen" },
      channel: "github",
      resolvedAt: "2026-10-04T08:31:00.000Z",
    }),
  ];
}

/** One resolved day, with overrides — today's seeded five by default, the day before behind it. */
export function resolvedDay(overrides: Partial<InboxResolved> = {}): InboxResolved {
  const rows = overrides.rows ?? seededResolvedRows();

  return {
    day: "2026-10-04",
    count: rows.length,
    rows,
    previousDay: "2026-10-02",
    nextDay: null,
    ...overrides,
  };
}

/** What the route reads for the first paint. */
export function inboxReadings(
  queue: InboxQueue | null = inboxQueue(),
  resolved: InboxResolved | null = resolvedDay(),
): InboxReadings {
  return {
    queue: queue === null ? { ok: false, reason: "The inbox could not be read." } : { ok: true, value: queue },
    resolved:
      resolved === null
        ? { ok: false, reason: "The resolved list could not be read." }
        : { ok: true, value: resolved },
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
