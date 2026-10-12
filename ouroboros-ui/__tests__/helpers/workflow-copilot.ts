import type {
  CopilotConversation,
  CopilotGuard,
  CopilotMessage,
  CopilotPromotion,
  CopilotReadiness,
  CopilotReference,
  CopilotSession,
  CopilotStageDraft,
  CopilotStreamEvent,
  CopilotWarning,
} from "@/app/api/workflow-copilot";
import type { RoutingAlias } from "@/app/api/routing";
import { EMPTY_POLL_SNAPSHOT, type Poll, type PollAnswer } from "@/app/poll";
import type { WorkflowDefinition, WorkflowDetail, WorkflowRailEntry } from "@/app/api/workflows";
import type { CopilotReadings, SelectedCopilot } from "@/app/workflows/copilot/copilot-view";

import { READ_AT, railEntry, seededRail, workflowDetail } from "./workflows";

/**
 * Fixtures for the workflow copilot's frame (CE.1, #565) — mockup 20's `security-patch`: a
 * workflow built in a conversation, never published, whose draft `v0.3` carries the two guards
 * the conversation set.
 *
 * The promotion and discard shapes are the ticket's contract, typed by hand in
 * `app/api/workflow-copilot.ts` until `yarn api:sync` generates them; the conversation's are the
 * generated ones.
 */

/** `security-patch`'s id. */
export const SECURITY_PATCH_ID = "5eed001b-0000-4000-8000-000000000020";

/** Its conversation's id. */
export const SESSION_ID = "5eed0c0b-0000-4000-8000-000000000001";

/**
 * `security-patch` on the rail: only ever a draft, so nothing is in force.
 *
 * @param overrides What this case is about.
 * @returns The entry.
 */
export function securityPatchEntry(overrides: Partial<WorkflowRailEntry> = {}): WorkflowRailEntry {
  return railEntry({
    id: SECURITY_PATCH_ID,
    slug: "security-patch",
    name: "security-patch",
    currentVersion: null,
    stageCount: null,
    terminal: null,
    caption: "not published",
    runs: 0,
    usagePercent: 0,
    usageCaption: "used by 0% of runs",
    ...overrides,
  });
}

/**
 * The seeded rail with `security-patch` at its foot.
 *
 * @returns The rail the copilot's page reads.
 */
export function copilotRail(): WorkflowRailEntry[] {
  return [...seededRail(), securityPatchEntry()];
}

/**
 * The draft the conversation built: three stages, the middle one naming a skill.
 *
 * @returns The document.
 */
export function securityPatchDefinition(): WorkflowDefinition {
  return {
    nodes: [
      { id: "triage", type: "agent", title: "Triage the advisory" },
      { id: "patch", type: "agent", title: "Patch the dependency" },
      { id: "open-pr", type: "open_pr", title: "Open the pull request" },
    ],
    edges: [
      { from: "triage", to: "patch" },
      { from: "patch", to: "open-pr" },
    ],
  } as unknown as WorkflowDefinition;
}

/** The guard the PR plane enforces. */
export const NEVER_AUTO_MERGE: CopilotGuard = {
  id: "never_auto_merge",
  label: "never auto-merge",
  source: "conversation",
  enforcement: "enforced",
  enforcedBy: "The PR plane refuses to arm auto-merge for runs of this workflow.",
};

/** The guard nothing holds a real run to yet. */
export const SPEND_GUARD: CopilotGuard = {
  id: "spend_guard",
  label: "spend cap $5.00/run",
  source: "conversation",
  enforcement: "dry_run_only",
  enforcedBy: "Dry runs stop at the cap; real runs are not stopped by it yet.",
};

/**
 * One unresolved reference, blocking by default.
 *
 * @param overrides What this case is about.
 * @returns The reference.
 */
export function copilotReference(overrides: Partial<CopilotReference> = {}): CopilotReference {
  return {
    code: "reference.unknown_skill",
    node: "patch",
    name: "dependency-bump",
    path: "/nodes/1/config/skill",
    message: "No skill called dependency-bump is registered.",
    blocking: true,
    ...overrides,
  };
}

/** A reference the policy only flags. */
export const ADVISORY_REFERENCE = copilotReference({
  code: "reference.unknown_alias",
  node: "triage",
  name: "fast-triage",
  path: "/nodes/0/config/routing/alias",
  message: "No model alias called fast-triage exists yet.",
  blocking: false,
});

/**
 * A promotion summary: a present draft, both guards, nothing unresolved, nothing blocked.
 *
 * @param overrides What this case is about.
 * @returns The summary, as the contract serves it.
 */
export function copilotPromotion(overrides: Partial<CopilotPromotion> = {}): CopilotPromotion {
  return {
    workflow: { id: SECURITY_PATCH_ID, slug: "security-patch", name: "security-patch" },
    publishes: { version: 1, label: "security-patch v1" },
    draft: { present: true, label: "v0.3", etag: "etag-draft-3" },
    session: { id: SESSION_ID, status: "active" },
    guards: [NEVER_AUTO_MERGE, SPEND_GUARD],
    references: [],
    blocked: false,
    blockedReasons: [],
    ...overrides,
  };
}

/**
 * The conversation's session, open by default.
 *
 * @param overrides What this case is about.
 * @returns The session.
 */
export function copilotSession(overrides: Partial<CopilotSession> = {}): CopilotSession {
  return {
    id: SESSION_ID,
    workflowId: SECURITY_PATCH_ID,
    status: "active",
    draftName: "security-patch",
    modelProvenance: [{ seq: 2, alias: "planner", modelId: "claude-fable-5" }],
    createdAt: "2026-09-13T09:00:00.000Z",
    closedAt: null,
    lastSeq: 2,
    ...overrides,
  };
}

/**
 * One message, the person's opening one by default.
 *
 * @param overrides What this case is about.
 * @returns The message.
 */
export function copilotMessage(overrides: Partial<CopilotMessage> = {}): CopilotMessage {
  return {
    id: "5eed0c0c-0000-4000-8000-000000000001",
    seq: 1,
    role: "user",
    body: "Patch security advisories, but never auto-merge and cap spend at $5 a run.",
    choices: null,
    toolTrace: { operations: [], reads: [], dryRunProposals: [] },
    tokensIn: null,
    tokensOut: null,
    costCents: null,
    status: "complete",
    createdAt: "2026-09-13T10:00:00.000Z",
    ...overrides,
  };
}

/** The copilot's reply to {@link copilotMessage}'s default. */
export const COPILOT_REPLY = copilotMessage({
  id: "5eed0c0c-0000-4000-8000-000000000002",
  seq: 2,
  role: "copilot",
  body: "Drafted three stages.\nBoth guards are recorded.",
  createdAt: "2026-09-13T10:01:00.000Z",
});

/**
 * The conversation: one exchange, over the draft it built.
 *
 * @param overrides What this case is about.
 * @returns The conversation.
 */
export function copilotConversation(overrides: Partial<CopilotConversation> = {}): CopilotConversation {
  return {
    session: copilotSession(),
    messages: [copilotMessage(), COPILOT_REPLY],
    draft: {
      etag: "etag-draft-3",
      label: "v0.3",
      definition: securityPatchDefinition(),
      provenanceSummary: { canvas: 0, code: 0, copilot: 2, suggestion: 0 },
      warnings: [],
      nodeProvenance: [],
    },
    ...overrides,
  };
}

/**
 * A conversation closed in one of the two ways.
 *
 * @param status How it was closed.
 * @returns The conversation, read-only.
 */
export function closedConversation(status: "promoted" | "discarded"): CopilotConversation {
  return copilotConversation({
    session: copilotSession({ status, closedAt: "2026-09-13T11:00:00.000Z" }),
  });
}

/**
 * The service's readiness: a gateway, a route, no dry run in the way — a message may be sent.
 *
 * @param overrides What this case is about.
 * @returns The readiness, as the contract serves it.
 */
export function copilotReadiness(overrides: Partial<CopilotReadiness> = {}): CopilotReadiness {
  return {
    gateway: { available: true },
    route: {
      taskKind: "copilot-workflow",
      resolved: true,
      alias: "coder-max",
      modelId: "claude-fable-5",
      reason: null,
    },
    dryRun: null,
    ...overrides,
  };
}

/** The service's reason for a workspace with no copilot route, as the contract spells it. */
export const UNROUTED_REASON_TEXT =
  "this workspace has no route for the `copilot-workflow` task kind. Add one under Model routing and try again.";

/** Readiness on a deployment with no invocation gateway. */
export const NO_GATEWAY = copilotReadiness({
  gateway: { available: false },
  route: { taskKind: "copilot-workflow", resolved: false, alias: null, modelId: null, reason: UNROUTED_REASON_TEXT },
});

/** Readiness in a workspace whose copilot has no route. */
export const UNROUTED = copilotReadiness({
  route: { taskKind: "copilot-workflow", resolved: false, alias: null, modelId: null, reason: UNROUTED_REASON_TEXT },
});

/** The sentence a reply ends on when its conversation is closed under it — the service's. */
export const CLOSED_MID_REPLY_SENTENCE =
  "This conversation was closed while I was replying, so I stopped — nothing further was applied.";

/** Readiness while a dry run of the draft is running. */
export const DRY_RUNNING = copilotReadiness({
  dryRun: { id: "5eed0d00-0000-4000-8000-000000000001", status: "running" },
});

/** The seeded conversation's message ids, in order (`R__dev_seed_workspace_copilot.sql`). */
export const SEEDED_IDS = [1, 2, 3, 4, 5, 6].map((n) => `5eed008a-0000-4000-8000-00000000010${n}`);

/** The validator's message on the seeded exchange's one bounced operation. */
export const SEEDED_BOUNCE = 'edge.to "exploit_verify" names no stage — did you mean "exploit-verify"?';

/**
 * Mockup 20's six-message exchange, as the dev seed stores it: two answered chip rows on the
 * first reply, a trace with one bounced `add_edge`, a proposed spend guard, costs 12 / 4 / 2
 * cents.
 *
 * @returns The messages, in order.
 */
export function seededMessages(): CopilotMessage[] {
  const answeredAt = "2026-09-13T15:04:00.000Z";
  const edge = (from: string, to: string) => ({ kind: "add_edge", params: { from, to } });

  return [
    copilotMessage({
      id: SEEDED_IDS[0],
      seq: 1,
      body: "Create a workflow for security patches: always get a second model's review, never auto-merge, and prove the CVE is actually fixed.",
      createdAt: "2026-09-13T15:02:00.000Z",
    }),
    copilotMessage({
      id: SEEDED_IDS[1],
      seq: 2,
      role: "copilot",
      body: 'Drafted security-patch — 8 stages, shown on the right. For "prove it\'s actually fixed" I added an exploit-verify stage: it re-runs the CVE\'s proof-of-concept against the patched build and attaches the result to PR verification. Two questions:',
      choices: [
        {
          prompt: "What triggers it?",
          options: ["label:security", "CVE pattern in title"],
          selected: "label:security",
          answeredAt,
        },
        { prompt: "May it read the GitHub Advisory DB?", options: ["Yes", "No"], selected: "Yes", answeredAt },
      ],
      toolTrace: {
        operations: [
          { op: { kind: "add_stage", params: { id: "exploit-verify" } }, outcome: "applied", validatorMessage: null },
          { op: { kind: "remove_edge", params: { from: "test", to: "review-primary" } }, outcome: "applied", validatorMessage: null },
          { op: { kind: "remove_edge", params: { from: "test", to: "review-second" } }, outcome: "applied", validatorMessage: null },
          { op: edge("test", "exploit_verify"), outcome: "bounced", validatorMessage: SEEDED_BOUNCE },
          { op: edge("test", "exploit-verify"), outcome: "applied", validatorMessage: null },
          { op: edge("exploit-verify", "review-primary"), outcome: "applied", validatorMessage: null },
          { op: edge("exploit-verify", "review-second"), outcome: "applied", validatorMessage: null },
        ],
        reads: [{ tool: "catalog" }, { tool: "skills" }, { tool: "draft" }],
        dryRunProposals: [],
      } as unknown as CopilotMessage["toolTrace"],
      tokensIn: 18400,
      tokensOut: 2100,
      costCents: 12,
      createdAt: "2026-09-13T15:02:00.000Z",
    }),
    copilotMessage({
      id: SEEDED_IDS[2],
      seq: 3,
      body: "label security. yes. also cap spend at $5 a run.",
      createdAt: "2026-09-13T15:04:00.000Z",
    }),
    copilotMessage({
      id: SEEDED_IDS[3],
      seq: 4,
      role: "copilot",
      body: "Added a $5/run spend guard. The draft is ready — want a dry run? #489 is the closest open issue (CAN arbitration storm, no CVE — a useful edge case).",
      toolTrace: {
        operations: [
          { op: { kind: "set_trigger", params: { conditions: { labels: ["security"] } } }, outcome: "applied", validatorMessage: null },
          { op: { kind: "set_guard", params: { spend_cap_cents: 500, per: "run" } }, outcome: "proposed", validatorMessage: null },
        ],
        reads: [{ tool: "tickets", query: "open, closest to security-patch" }],
        dryRunProposals: [{ ticket: "#489", reason: "security workflow × no-CVE issue — exercises the skip path" }],
      } as unknown as CopilotMessage["toolTrace"],
      tokensIn: 9800,
      tokensOut: 600,
      costCents: 4,
      createdAt: "2026-09-13T15:04:00.000Z",
    }),
    copilotMessage({ id: SEEDED_IDS[4], seq: 5, body: "dry run #489", createdAt: "2026-09-13T15:05:00.000Z" }),
    copilotMessage({
      id: SEEDED_IDS[5],
      seq: 6,
      role: "copilot",
      body: "Dry run finished — 2m 41s, $0.31, zero side effects. Two improvement suggestions below the results →",
      toolTrace: {
        operations: [],
        reads: [{ tool: "dry_run_results" }],
        dryRunProposals: [],
      } as unknown as CopilotMessage["toolTrace"],
      tokensIn: 5200,
      tokensOut: 300,
      costCents: 2,
      createdAt: "2026-09-13T15:08:00.000Z",
    }),
  ];
}

/**
 * The seeded conversation: the six messages, in an active session whose three replies were each
 * routed through `coder-max` to `claude-fable-5`.
 *
 * @param overrides What this case is about.
 * @returns The conversation.
 */
export function seededConversation(overrides: Partial<CopilotConversation> = {}): CopilotConversation {
  return copilotConversation({
    session: copilotSession({
      modelProvenance: [2, 4, 6].map((seq) => ({ seq, alias: "coder-max", modelId: "claude-fable-5" })),
      lastSeq: 6,
    }),
    messages: seededMessages(),
    ...overrides,
  });
}

/** The ids a scripted exchange uses for the person's message and the reply. */
export const LIVE_USER_ID = "5eed0c0c-0000-4000-8000-0000000000a1";
export const LIVE_REPLY_ID = "5eed0c0c-0000-4000-8000-0000000000a2";

/**
 * A scripted exchange, as the service streams one: `accepted`, the events given, `usage`, `done`.
 *
 * @param text What the person said.
 * @param middle The reply's events, in the order the model produced them.
 * @param options The reply as recorded — its seq, cost, status, and any error before `done`.
 * @returns The events.
 */
export function exchangeScript(
  text: string,
  middle: readonly CopilotStreamEvent[],
  options: {
    readonly seq?: number;
    readonly costCents?: number | null;
    readonly error?: { readonly code: string; readonly message: string };
    readonly choices?: CopilotMessage["choices"];
  } = {},
): CopilotStreamEvent[] {
  const seq = options.seq ?? 7;
  const user = copilotMessage({ id: LIVE_USER_ID, seq, body: text, createdAt: "2026-09-13T15:10:00.000Z" });
  const body = middle.map((event) => (event.kind === "delta" ? event.text : "")).join("");
  const reply = copilotMessage({
    id: LIVE_REPLY_ID,
    seq: seq + 1,
    role: "copilot",
    body,
    choices: options.choices ?? null,
    costCents: options.costCents === undefined ? 3 : options.costCents,
    status: options.error === undefined ? "complete" : "interrupted",
    createdAt: "2026-09-13T15:10:02.000Z",
  });

  return [
    { kind: "accepted", message: user, replyId: reply.id, replySeq: reply.seq },
    ...middle,
    { kind: "usage", tokensIn: 900, tokensOut: 120, costCents: reply.costCents },
    ...(options.error === undefined ? [] : [{ kind: "error" as const, ...options.error }]),
    { kind: "done", message: reply, draft: copilotConversation().draft },
  ];
}

/**
 * An operation event.
 *
 * @param kind The operation's kind.
 * @param params Its params.
 * @param outcome What became of it.
 * @param extra The validator's message, or warnings.
 * @returns The event.
 */
export function operationEvent(
  kind: string,
  params: Record<string, unknown>,
  outcome: "applied" | "bounced" | "proposed" = "applied",
  extra: { readonly validatorMessage?: string; readonly warnings?: readonly Record<string, unknown>[] } = {},
): CopilotStreamEvent {
  return {
    kind: "operation",
    op: { kind, params },
    outcome,
    validatorMessage: extra.validatorMessage ?? null,
    draftRev: outcome === "applied" ? 4 : null,
    etag: outcome === "applied" ? "etag-draft-4" : null,
    warnings: extra.warnings ?? [],
  } as unknown as CopilotStreamEvent;
}

/**
 * `security-patch` as the visual editor reads it: a draft, nothing in force.
 *
 * @returns The workflow.
 */
export function securityPatchDetail(): WorkflowDetail {
  return workflowDetail({
    id: SECURITY_PATCH_ID,
    slug: "security-patch",
    name: "security-patch",
    currentVersion: null,
    version: null,
    draft: {
      etag: "etag-draft-3",
      definition: securityPatchDefinition(),
      updatedAt: "2026-09-13T10:01:00.000Z",
      changeNote: null,
    },
  });
}

/**
 * The open workflow's six reads, all answered.
 *
 * @param overrides What this case is about.
 * @returns The reads.
 */
export function selectedCopilot(overrides: Partial<SelectedCopilot> = {}): SelectedCopilot {
  return {
    entry: securityPatchEntry(),
    detail: { ok: true, value: securityPatchDetail() },
    promotion: { ok: true, value: copilotPromotion() },
    conversation: { ok: true, value: copilotConversation() },
    readiness: { ok: true, value: copilotReadiness() },
    draft: { ok: true, value: copilotStageDraft() },
    aliases: { ok: true, value: seededAliases() },
    ...overrides,
  };
}

/**
 * Everything the copilot route reads for `/workflows/security-patch/copilot`, all answered.
 *
 * @param overrides What this case is about.
 * @returns The readings.
 */
export function copilotReadings(overrides: Partial<CopilotReadings> = {}): CopilotReadings {
  return {
    rail: { ok: true, value: copilotRail() },
    requested: "security-patch",
    selected: selectedCopilot(),
    now: READ_AT,
    ...overrides,
  };
}

/**
 * The readings with one part of the open workflow's reads replaced.
 *
 * @param overrides The reads this case is about.
 * @returns The readings.
 */
export function copilotReadingsWith(overrides: Partial<SelectedCopilot>): CopilotReadings {
  return copilotReadings({ selected: selectedCopilot(overrides) });
}

/* ------------------------------------------------------------------ the stage list (CE.3, #567) */

/**
 * The draft as `GET …/copilot/draft` answers it for the frame's small fixture: the conversation's
 * draft, with no provenance to report. Its three nodes are of no canvas kind, so the stage list
 * draws its empty state over it — the frame's suites are about the frame.
 *
 * @param overrides What this case is about.
 * @returns The draft.
 */
export function copilotStageDraft(overrides: Partial<CopilotStageDraft> = {}): CopilotStageDraft {
  return { ...copilotConversation().draft, nodeProvenance: [], ...overrides } as CopilotStageDraft;
}

/** A model stage's limits and permissions, as the seed writes them. */
const llm = (
  id: string,
  title: string,
  y: number,
  config: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({ id, type: "llm", title, ...extra, position: { x: 0, y }, config });

/**
 * The seeded `security-patch` draft at `v0.3`, copied from
 * `ouroboros-db/migrations/R__dev_seed_workspace_copilot.sql`'s three `apply_draft_batch()`
 * batches: ten DSL nodes in the order the operations added them (`exploit-verify` last), the
 * edges as the second batch left them, and the third batch's `label:security` trigger.
 *
 * @returns The document.
 */
export function seededDraftDefinition(): WorkflowDefinition {
  const edge = (from: string, to: string) => ({ from, to, kind: "default" });

  return {
    trigger: { event: "ticket_queued", conditions: { labels: ["security"] } },
    nodes: [
      { id: "trigger", type: "trigger", title: "trigger", position: { x: 0, y: 0 }, config: {} },
      llm("analyze", "analyze", 120, {
        mode: "skill",
        skill: "advisory-db",
        prompt_template: "Map the code paths {{issue.title}} touches, and read the advisory for its CVE when it has one.",
        routing: { pinned_model: { alias: "coder-std" } },
        limits: { max_retries: 1, token_budget: 200000 },
        permissions: { push_fixup: false, touch_ci: false },
      }),
      llm("plan", "plan", 240, {
        mode: "prompt",
        prompt_template: "Plan the patch for {{issue.title}} in small, reviewable steps.",
        routing: { pinned_model: { alias: "coder-max" } },
        limits: { max_retries: 1, token_budget: 200000 },
        permissions: { push_fixup: false, touch_ci: false },
      }),
      llm("implement", "implement", 360, {
        mode: "prompt",
        prompt_template: "Implement the plan; keep the diff to what the plan names.",
        routing: { inherit_task: "implement" },
        limits: { max_retries: 2, token_budget: 400000 },
        permissions: { push_fixup: true, touch_ci: false },
      }),
      { id: "build", type: "infra", title: "build", position: { x: 0, y: 480 }, config: { runner_pool: "pool-a" } },
      {
        id: "test",
        type: "infra",
        title: "test",
        description: "twister full",
        position: { x: 0, y: 600 },
        config: { runner_pool: "pool-a", command: "west twister --all" },
      },
      {
        ...llm("review-primary", "review", 840, {
          mode: "prompt",
          prompt_template: "Review the patch against the advisory and the acceptance criteria.",
          routing: { pinned_model: { alias: "coder-max" } },
          limits: { max_retries: 0, token_budget: 150000 },
          permissions: { push_fixup: false, touch_ci: false },
        }),
        position: { x: -160, y: 840 },
      },
      {
        ...llm("review-second", "review", 840, {
          mode: "prompt",
          prompt_template: "Give an independent second review of the patch.",
          routing: { pinned_model: { alias: "second-opinion" } },
          limits: { max_retries: 0, token_budget: 150000 },
          permissions: { push_fixup: false, touch_ci: false },
        }),
        position: { x: 160, y: 840 },
      },
      {
        id: "open-pr",
        type: "term",
        title: "open PR",
        description: "never auto-merge",
        position: { x: 0, y: 960 },
        config: { action: "needs_review", options: {} },
      },
      llm(
        "exploit-verify",
        "exploit-verify",
        720,
        {
          mode: "prompt",
          prompt_template:
            "Re-run the CVE proof-of-concept against the patched build in the sandbox and attach the result to PR verification.",
          routing: { inherit_task: "exploit-verify" },
          limits: { max_retries: 0, token_budget: 100000 },
          permissions: { push_fixup: false, touch_ci: false },
        },
        { description: "reruns CVE PoC · sandboxed" },
      ),
    ],
    edges: [
      edge("trigger", "analyze"),
      edge("analyze", "plan"),
      edge("plan", "implement"),
      edge("implement", "build"),
      edge("build", "test"),
      edge("review-primary", "open-pr"),
      edge("review-second", "open-pr"),
      edge("test", "exploit-verify"),
      edge("exploit-verify", "review-primary"),
      edge("exploit-verify", "review-second"),
    ],
  } as unknown as WorkflowDefinition;
}

/** The ten node ids of the seeded draft, in the document's order. */
export const SEEDED_NODE_IDS = [
  "trigger",
  "analyze",
  "plan",
  "implement",
  "build",
  "test",
  "review-primary",
  "review-second",
  "open-pr",
  "exploit-verify",
] as const;

/** W7's first unresolved reference in the seed: `analyze` loads a skill nobody has created. */
export const ADVISORY_DB_WARNING: CopilotWarning = {
  code: "reference.unknown_skill",
  node: "analyze",
  name: "advisory-db",
  path: "/nodes/1/config/skill",
  message: "No skill named `advisory-db` is defined in this workspace yet.",
};

/** W7's second: `exploit-verify` routes by a task kind the catalog does not have. */
export const EXPLOIT_VERIFY_WARNING: CopilotWarning = {
  code: "reference.unknown_task",
  node: "exploit-verify",
  name: "exploit-verify",
  path: "/nodes/9/config/routing/inherit_task",
  message: "No task route named `exploit-verify` exists in this workspace yet.",
};

/**
 * Who each seeded stage is by: Ken's nine from the canvas at rev 1, and the copilot's
 * `exploit-verify` at rev 2 — the only row with `added by copilot`.
 *
 * @returns One entry per node, in the document's order.
 */
export function seededProvenance(): CopilotStageDraft["nodeProvenance"] {
  return SEEDED_NODE_IDS.map((nodeId) =>
    nodeId === "exploit-verify"
      ? { nodeId, provenance: "copilot" as const, addedRev: 2 }
      : { nodeId, provenance: "human" as const, addedRev: 1 },
  );
}

/**
 * The seeded draft as `GET …/copilot/draft` answers it: `v0.3`, ten nodes, both W7 warnings,
 * one canvas batch and two of the copilot's.
 *
 * @param overrides What this case is about.
 * @returns The draft.
 */
export function seededStageDraft(overrides: Partial<CopilotStageDraft> = {}): CopilotStageDraft {
  return {
    etag: "etag-draft-3",
    label: "v0.3",
    definition: seededDraftDefinition(),
    provenanceSummary: { canvas: 1, code: 0, copilot: 2, suggestion: 0 },
    warnings: [ADVISORY_DB_WARNING, EXPLOIT_VERIFY_WARNING],
    nodeProvenance: seededProvenance(),
    ...overrides,
  } as CopilotStageDraft;
}

/**
 * The three registry aliases the seeded draft pins, as `R__dev_seed_routing.sql` binds them —
 * `second-opinion` to Cursor's `composer-2`, which the mockup prints as `cursor/composer-2`.
 *
 * @returns The aliases.
 */
export function seededAliases(): RoutingAlias[] {
  const alias = (name: string, modelId: string): RoutingAlias => ({ alias: name, modelId, params: {}, provider: null });

  return [alias("coder-max", "claude-fable-5"), alias("coder-std", "claude-sonnet-5"), alias("second-opinion", "composer-2")];
}

/**
 * A poll that never asks — for a suite that renders the stage list and is not about its poll.
 *
 * @returns The poll.
 */
export function inertStagesPoll(): Poll<CopilotStageDraft> {
  return { snapshot: () => EMPTY_POLL_SNAPSHOT, subscribe: () => () => {}, refresh: () => {}, start: () => () => {} };
}

/**
 * A poll answer carrying a draft.
 *
 * @param payload The draft.
 * @returns The answer, as `requestPayload` shapes a `200`.
 */
export function freshDraft(payload: CopilotStageDraft): PollAnswer<CopilotStageDraft> {
  return { state: "fresh", payload, etag: null, pollAfterSeconds: null };
}
