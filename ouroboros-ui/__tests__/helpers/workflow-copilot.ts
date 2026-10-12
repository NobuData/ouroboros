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
import type { DryRunSafety, DryRunSafetyColumn } from "@/app/api/workflow-dry-runs";
import { EMPTY_POLL_SNAPSHOT, type Poll, type PollAnswer } from "@/app/poll";
import type { WorkflowDefinition, WorkflowDetail, WorkflowRailEntry } from "@/app/api/workflows";
import type { CopilotReadings, SelectedCopilot } from "@/app/workflows/copilot/copilot-view";
import type {
  DryRun,
  DryRunArtifact,
  DryRunBoard,
  DryRunCandidate,
  DryRunExplanation,
  DryRunHistory,
  DryRunStage,
  DryRunSuggestion,
  StageEstimate,
} from "@/app/workflows/copilot/dry-run";
import type { DryRunTransport } from "@/app/workflows/copilot/dry-run-transport";

import { seededConnections } from "./providers";
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
 * One column of the safety strip, as the service composes it from the harness (CE.5, #569).
 *
 * @param id Which claim.
 * @param overrides What this case is about — `holds: false` for a mechanism that is gone.
 * @returns The column.
 */
export function safetyColumn(
  id: DryRunSafetyColumn["id"],
  overrides: Partial<DryRunSafetyColumn> = {},
): DryRunSafetyColumn {
  const columns: Record<DryRunSafetyColumn["id"], DryRunSafetyColumn> = {
    simulated_writes: {
      id: "simulated_writes",
      holds: true,
      mechanism: {
        kind: "overlay",
        tools: ["write_file", "apply_patch"],
        path: null,
        detail:
          "A stage's edits are held in an in-memory overlay that later stages read through; the overlay becomes the simulated diff and is never written to the repository.",
      },
      facts: { writes: "memory_overlay", reads: "pinned_commit" },
    },
    replayed_infra: {
      id: "replayed_infra",
      holds: true,
      mechanism: {
        kind: "estimator_service",
        tools: ["run_build", "run_tests"],
        path: "/internal/dry-runs/{id}/replay-estimates",
        detail:
          "Build and test stages are answered by the replay estimator from farm and test history — a median with its sample count and spread, or insufficient history; nothing is built or run.",
      },
      facts: {
        formulas: [
          { id: "build_duration_replay", version: 1, dispersion: "mad" },
          { id: "test_duration_replay", version: 1, dispersion: "mad" },
        ],
      },
    },
    real_models: {
      id: "real_models",
      holds: true,
      mechanism: {
        kind: "gateway_routing",
        tools: [],
        path: "/internal/llm/invoke",
        detail:
          "Model stages run their own prompts through the invocation gateway with the alias routing resolved for each, attributed to the dry run and stopped at its budget; the harness holds no provider credential.",
      },
      facts: {},
    },
  };

  return { ...columns[id], ...overrides };
}

/**
 * The safety strip with all three claims backed.
 *
 * @param overrides What this case is about — `columns` with one removed, above all.
 * @returns The strip.
 */
export function drySafety(overrides: Partial<DryRunSafety> = {}): DryRunSafety {
  return {
    harness: "deep_simulated",
    columns: [safetyColumn("simulated_writes"), safetyColumn("replayed_infra"), safetyColumn("real_models")],
    absent: [
      { claim: "no writes", capability: "repository_write" },
      { claim: "no PRs", capability: "pull_request" },
      { claim: "no merges", capability: "pull_request" },
    ],
    guards: [{ name: "allow_list", refuses: "a tool the harness does not provide" }],
    blockedCallFailsRun: true,
    ...overrides,
  };
}

/**
 * The open workflow's reads, all answered — with no dry run yet, so the frame's suites draw the
 * dry-run card's empty state.
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
    dryRun: { ok: true, value: emptyBoard() },
    safety: { ok: true, value: drySafety() },
    providers: { ok: true, value: seededConnections() },
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

/* ------------------------------------------------------------------ the dry-run card (CE.4, #568) */

/** The seeded dry run's id (`R__dev_seed_workspace_copilot.sql`). */
export const DRY_RUN_ID = "5eed008b-0000-4000-8000-000000000001";

/** `#489`'s canonical ticket id. */
export const TICKET_489_ID = "5eed0088-0000-4000-8000-000000000489";

/** The two seeded suggestions' ids (`R__dev_seed_workspace_replay.sql`). */
export const SUGGESTION_SKIP_ID = "5eed008c-0000-4000-8000-000000000001";
export const SUGGESTION_REVIEW_ID = "5eed008c-0000-4000-8000-000000000002";

/** The build formula's one-sentence summary, as the registry writes it. */
export const BUILD_FORMULA_SUMMARY =
  "The median wall time of the succeeded builds in the window that share this stage's similarity class; the ± is their median absolute deviation.";

/** The seeded build row's note, as the database composes it from farm history at one moment. */
export const BUILD_NOTE = "est. 3m 42s (217 similar builds, ±22s)";

/**
 * The seeded build row's provenance: 217 similar builds in a 30-day window.
 *
 * @param overrides What this case is about.
 * @returns The estimate.
 */
export function buildEstimate(overrides: Partial<StageEstimate> = {}): StageEstimate {
  return {
    status: "estimated",
    estimateMs: 222_000,
    spreadMs: 22_000,
    sampleCount: 217,
    sampleFloor: 20,
    windowDays: 30,
    formula: { id: "build_duration_replay", version: 1, summary: BUILD_FORMULA_SUMMARY },
    ...overrides,
  };
}

/** A replayed row below the floor: twelve samples where twenty are needed, and no number anywhere. */
export const INSUFFICIENT_ESTIMATE: StageEstimate = buildEstimate({
  status: "insufficient_history",
  estimateMs: null,
  spreadMs: null,
  sampleCount: 12,
});

/**
 * One result row.
 *
 * @param overrides What this case is about.
 * @returns The row.
 */
export function dryRunStage(overrides: Partial<DryRunStage> = {}): DryRunStage {
  return {
    seq: 1,
    stageKey: "analyze",
    displayName: "analyze",
    verdict: "ok",
    how: "llm",
    howLabel: null,
    note: "",
    metrics: {},
    estimate: null,
    skipReason: null,
    skipKind: null,
    skipInput: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

/**
 * The seeded run's seven rows, with their exact notes and `how` labels — the two seed files'
 * rows as the service maps them (`simulated` for the stage whose writes were virtualized).
 *
 * @returns The rows, in card order.
 */
export function seededStages(): DryRunStage[] {
  return [
    dryRunStage({
      seq: 1,
      note: "mapped 4 files · advisory DB skipped (no CVE on this issue)",
      metrics: { tokens: 18200, cost_cents: 6, files_touched: 4 },
    }),
    dryRunStage({
      seq: 2,
      stageKey: "plan",
      displayName: "plan",
      note: "3 steps · would touch drivers/can/arbitration.c",
      metrics: { tokens: 12400, cost_cents: 5 },
    }),
    dryRunStage({
      seq: 3,
      stageKey: "implement",
      displayName: "implement",
      howLabel: "simulated",
      note: "diff drafted +41 −9 (below) · 84k tokens",
      metrics: { tokens: 84000, cost_cents: 14, files_touched: 1, simulated_writes: 1, lines_added: 41, lines_removed: 9 },
    }),
    dryRunStage({
      seq: 4,
      stageKey: "build",
      displayName: "build",
      how: "replayed",
      howLabel: "replayed from history",
      note: BUILD_NOTE,
      metrics: { sample_count: 217, window_days: 30, estimate_ms: 222_000, spread_ms: 22_000 },
      estimate: buildEstimate(),
    }),
    dryRunStage({
      seq: 5,
      stageKey: "exploit-verify",
      displayName: "exploit-verify",
      verdict: "skipped",
      how: "skipped",
      howLabel: "skipped",
      note: "no PoC exists: stage had nothing to do",
      skipReason: "no PoC exists: stage had nothing to do",
      skipKind: "nothing_to_do",
      skipInput: "cve",
    }),
    dryRunStage({
      seq: 6,
      stageKey: "review",
      displayName: "review ×2",
      note: "both approve · 1 style nit",
      metrics: { tokens: 16600, cost_cents: 6 },
    }),
    dryRunStage({
      seq: 7,
      stageKey: "open-pr",
      displayName: "open PR",
      verdict: "not_reached",
      how: "deterministic",
      note: "would open DRAFT PR · not merged (policy)",
    }),
  ];
}

/** The seeded overlay diff's content. */
export const SEEDED_DIFF = [
  "--- a/drivers/can/arbitration.c",
  "+++ b/drivers/can/arbitration.c",
  "@@ -212,8 +212,11 @@ static void can_handle_tx_error(const struct device *dev, struct can_frame *frame, uint32_t err)",
  "-\tif (err & CAN_ERR_LOSTARB) {",
  "-\t\tcan_retry_tx(dev, frame); /* immediate retry floods the bus */",
  "+\tif (err & CAN_ERR_LOSTARB) {",
  "+\t\tk_sleep(K_USEC(backoff_us)); /* exponential backoff, 50–800 µs */",
  "+\t\tbackoff_us = MIN(backoff_us << 1, CAN_ARB_BACKOFF_MAX_US);",
  "+\t\tcan_retry_tx(dev, frame);",
  "",
].join("\n");

/**
 * The seeded simulated diff: `drivers/can/arbitration.c +41 −9`, whole.
 *
 * @param overrides What this case is about.
 * @returns The artifact.
 */
export function seededDiff(overrides: Partial<DryRunArtifact> = {}): DryRunArtifact {
  return {
    kind: "overlay_diff",
    content: SEEDED_DIFF,
    truncated: false,
    originalBytes: new TextEncoder().encode(SEEDED_DIFF).length,
    pathSummary: [{ path: "drivers/can/arbitration.c", added: 41, removed: 9 }],
    ...overrides,
  };
}

/**
 * The seeded dry run on `#489`: complete in 2m 41s for $0.31, guards clean, seven rows and the
 * diff.
 *
 * @param overrides What this case is about.
 * @returns The run.
 */
export function seededDryRun(overrides: Partial<DryRun> = {}): DryRun {
  return {
    id: DRY_RUN_ID,
    workflowId: SECURITY_PATCH_ID,
    draft: { baseVersion: null, rev: 3, label: "v0.3" },
    ticket: {
      id: TICKET_489_ID,
      key: "#489",
      title: "CAN arbitration-lost storm under full telemetry load",
      url: "https://github.com/acme-robotics/helios-firmware/issues/489",
    },
    sessionId: SESSION_ID,
    pinnedSha: "8c1b2e40d6a5f3c19b7e2a4d8f0c6b13e5a7d9f2",
    mode: "deep",
    status: "complete",
    failureReason: null,
    totals: { durationMs: 161_000, costCents: 31, tokens: 131_200 },
    guardAudit: [],
    guardsClean: true,
    precheckFindings: [],
    startedAt: "2026-09-13T15:05:00.000Z",
    finishedAt: "2026-09-13T15:07:41.000Z",
    stages: seededStages(),
    artifacts: [seededDiff()],
    budget: { capCents: 500, source: "draft_guard", workspaceCapCents: 1000, draftGuardCents: 500 },
    ...overrides,
  };
}

/**
 * The seeded run while it was still going: `running`, with its first three rows and no totals.
 *
 * @param overrides What this case is about.
 * @returns The run.
 */
export function runningDryRun(overrides: Partial<DryRun> = {}): DryRun {
  return seededDryRun({
    status: "running",
    totals: { durationMs: null, costCents: null, tokens: null },
    finishedAt: null,
    stages: seededStages().slice(0, 3),
    artifacts: [],
    ...overrides,
  });
}

/**
 * One suggestion — a rule's, open and applicable.
 *
 * @param overrides What this case is about.
 * @returns The suggestion.
 */
export function dryRunSuggestion(overrides: Partial<DryRunSuggestion> = {}): DryRunSuggestion {
  return {
    id: SUGGESTION_SKIP_ID,
    dryRunId: DRY_RUN_ID,
    source: "rule",
    ruleId: "skipped-nothing-to-do",
    ruleVersion: 1,
    title: "Make exploit-verify conditional",
    body: "Make exploit-verify conditional — it had nothing to do because #489 carries no `cve` label. Route issues without `cve` around it, so it skips cleanly instead of running with nothing to check.",
    confidence: 93,
    confidenceBasis: {
      method: "rule_strength_x_sample_adequacy",
      inputs: {
        rule: "skipped-nothing-to-do",
        rule_version: 1,
        rule_strength: 0.95,
        sample_adequacy: 0.98,
        outcome: "skipped_nothing_to_do",
        deterministic: true,
        observations: 1,
      },
    },
    applicable: true,
    proposedOps: [
      {
        kind: "add_stage",
        params: {
          node: {
            id: "has-cve",
            type: "flow",
            title: "has CVE?",
            position: { x: 0, y: 660 },
            config: { kind: "decision", predicate: { kind: "labels", op: "any", values: ["cve"] } },
          },
        },
      },
      { kind: "remove_edge", params: { from: "test", to: "exploit-verify" } },
      { kind: "add_edge", params: { edge: { from: "test", to: "has-cve", kind: "default" } } },
      { kind: "add_edge", params: { edge: { from: "has-cve", to: "exploit-verify", kind: "branch", label: "cve" } } },
      { kind: "add_edge", params: { edge: { from: "has-cve", to: "review-primary", kind: "branch", label: "no cve" } } },
      { kind: "add_edge", params: { edge: { from: "has-cve", to: "review-second", kind: "branch", label: "no cve" } } },
    ],
    status: "open",
    appliedOpBatchId: null,
    resolvedAt: null,
    createdAt: "2026-09-13T15:08:00.000Z",
    ...overrides,
  };
}

/**
 * The seeded run's two suggestions: `skipped-nothing-to-do` at 93% and `reviewer-disagreement`
 * at 81%.
 *
 * @returns The suggestions, in card order.
 */
export function seededSuggestions(): DryRunSuggestion[] {
  return [
    dryRunSuggestion(),
    dryRunSuggestion({
      id: SUGGESTION_REVIEW_ID,
      ruleId: "reviewer-disagreement",
      title: "Pin the pr-etiquette skill to both reviewers",
      body: "Pin the pr-etiquette skill to both reviewers — 6 of 10 replayed review pairs disagreed on comment style, not substance.",
      confidence: 81,
      confidenceBasis: {
        method: "rule_strength_x_sample_adequacy",
        inputs: {
          rule: "reviewer-disagreement",
          rule_version: 1,
          rule_strength: 0.9,
          sample_adequacy: 0.9,
          replay_set: "5eed008d-0000-4000-8000-000000000000",
          pairs: 10,
          style_disagreements: 6,
          substance_disagreements: 0,
          disagreement_rate: 0.6,
        },
      },
      proposedOps: ["review-primary", "review-second"].map((id) => ({
        kind: "set_stage" as const,
        params: { node: { id, type: "llm", title: id, config: { mode: "skill", skill: "pr-etiquette" } } },
      })),
    }),
  ];
}

/** A suggestion the model made: no rule, no confidence, labelled. */
export const LLM_SUGGESTION: DryRunSuggestion = dryRunSuggestion({
  id: "5eed008c-0000-4000-8000-000000000003",
  source: "llm",
  ruleId: null,
  ruleVersion: null,
  title: "Add a rollback note to the plan stage",
  body: "Add a rollback note to the plan stage — reviewers asked for one twice.",
  confidence: null,
  confidenceBasis: { method: "llm_unscored", inputs: { alias: "coder-max" } },
  proposedOps: [{ kind: "set_stage", params: { node: { id: "plan", type: "llm", title: "plan", config: {} } } }],
});

/** An advisory suggestion: it proposes no operations, so there is nothing to apply. */
export const ADVISORY_SUGGESTION: DryRunSuggestion = dryRunSuggestion({
  id: "5eed008c-0000-4000-8000-000000000004",
  title: "Consider a second reviewer for driver changes",
  body: "Consider a second reviewer for driver changes — this run touched `drivers/`.",
  applicable: false,
  proposedOps: [],
});

/**
 * The seeded history: one dry run, on draft `v0.3` with two copilot edits.
 *
 * @param overrides What this case is about.
 * @returns The history.
 */
export function seededHistory(overrides: Partial<DryRunHistory> = {}): DryRunHistory {
  const run = seededDryRun();

  return {
    draft: { label: "v0.3", rev: 3, baseVersion: null, copilotEdits: 2 },
    count: 1,
    spend: { costCents: 31, unpriced: 0 },
    runs: [
      {
        id: run.id,
        draftLabel: run.draft.label,
        draftRev: run.draft.rev,
        ticket: { key: run.ticket.key, title: run.ticket.title },
        status: run.status,
        failureReason: run.failureReason,
        totals: run.totals,
        guardsClean: run.guardsClean,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
      },
    ],
    ...overrides,
  };
}

/**
 * The seeded board — mockup 20's card: the run, its seven rows, the diff and the two suggestions.
 *
 * @param overrides What this case is about.
 * @returns The board.
 */
export function seededBoard(overrides: Partial<DryRunBoard> = {}): DryRunBoard {
  return { history: seededHistory(), run: seededDryRun(), suggestions: seededSuggestions(), ...overrides };
}

/**
 * A workflow never dry-run: draft `v0.3`, no runs.
 *
 * @returns The board.
 */
export function emptyBoard(): DryRunBoard {
  return { history: seededHistory({ count: 0, runs: [], spend: { costCents: null, unpriced: 0 } }), run: null, suggestions: [] };
}

/**
 * One ranked candidate.
 *
 * @param overrides What this case is about.
 * @returns The candidate.
 */
export function dryRunCandidate(overrides: Partial<DryRunCandidate> = {}): DryRunCandidate {
  return {
    rank: 1,
    ticket: {
      id: TICKET_489_ID,
      key: "#489",
      title: "CAN arbitration-lost storm under full telemetry load",
      url: "https://github.com/acme-robotics/helios-firmware/issues/489",
      labels: ["bug", "can-bus"],
      effort: "m",
      source: "github",
    },
    score: 2,
    dimensions: 3,
    matchesTrigger: false,
    mismatches: [],
    reason: "Carries no cve label — exercises the path that skips exploit-verify.",
    ...overrides,
  };
}

/** A second candidate, which would trigger the workflow as drafted. */
export const CANDIDATE_490: DryRunCandidate = dryRunCandidate({
  rank: 2,
  ticket: {
    id: "5eed0088-0000-4000-8000-000000000490",
    key: "#490",
    title: "Bootloader accepts unsigned image over DFU",
    url: "https://github.com/acme-robotics/helios-firmware/issues/490",
    labels: ["security", "cve"],
    effort: "l",
    source: "github",
  },
  score: 1,
  matchesTrigger: true,
  reason: "Has CVE-like labels — exercises the PoC path.",
});

/**
 * The first seeded suggestion's explanation, as the rule pack describes it.
 *
 * @param overrides What this case is about.
 * @returns The explanation.
 */
export function seededExplanation(overrides: Partial<DryRunExplanation> = {}): DryRunExplanation {
  const suggestion = dryRunSuggestion();

  return {
    suggestionId: suggestion.id,
    source: "rule",
    rule: {
      id: "skipped-nothing-to-do",
      version: 1,
      packVersion: 1,
      firesWhen: "A stage skipped because the ticket carried nothing for it to do.",
      proposes: "A decision ahead of the stage that routes such tickets around it.",
      scoring: {
        strength: "0.95 for a deterministic outcome.",
        adequacy: "0.98 when seen in one run.",
      },
    },
    evidence: {
      stage_key: "exploit-verify",
      verdict: "skipped",
      skip_kind: "nothing_to_do",
      skip_input: "cve",
      ticket: "#489",
      ticket_labels: ["bug", "can-bus"],
      trigger_labels: ["security"],
    },
    confidence: 93,
    confidenceBasis: suggestion.confidenceBasis,
    proposedOps: suggestion.proposedOps,
    ...overrides,
  };
}

/**
 * A transport whose every call is refused as unreachable — for a suite that renders the card and
 * replaces only the calls it is about.
 *
 * @param overrides The calls this case is about.
 * @returns The transport.
 */
export function dryRunTransport(overrides: Partial<DryRunTransport> = {}): DryRunTransport {
  const refused = async () => ({ ok: false as const, refusal: { status: 0, code: "unreachable", message: "unreachable" } });

  return {
    detail: refused,
    suggestions: refused,
    candidates: refused,
    explanation: refused,
    start: refused,
    cancel: refused,
    rerun: refused,
    apply: refused,
    ignore: refused,
    ...overrides,
  };
}
