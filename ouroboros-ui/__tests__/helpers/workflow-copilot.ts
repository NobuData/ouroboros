import type {
  CopilotConversation,
  CopilotGuard,
  CopilotMessage,
  CopilotPromotion,
  CopilotReference,
  CopilotSession,
} from "@/app/api/workflow-copilot";
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
 * The open workflow's three reads, all answered.
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
