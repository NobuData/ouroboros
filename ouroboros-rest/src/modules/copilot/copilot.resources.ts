/**
 * What the copilot's routes answer with — rows in this API's names.
 *
 * Every shape here is the one `openapi.yaml` documents under `copilot`, and the mapping from a
 * row is the whole of this file: no business rule lives in a mapper.
 */

import type {
  CopilotChoice,
  CopilotMessage,
  CopilotSession,
  CopilotToolTrace,
  DraftProvenanceSummary,
  Workflow,
} from "../db/schema";
import type { UnresolvedReference } from "./copilot.references";

/** One `ask_user` question of a reply — a chip row — and its answer once given. */
export interface CopilotChoiceResource {
  readonly prompt: string;
  readonly options: readonly string[];
  readonly selected: string | null;
  readonly answeredAt: string | null;
}

/** One operation of a reply's tool trace. */
export interface CopilotTraceOperationResource {
  /** The operation as proposed — `{kind, params}`. */
  readonly op: { readonly kind: string; readonly params?: Record<string, unknown> };
  readonly outcome: "proposed" | "applied" | "bounced";
  /** The validator's message — a string exactly on a bounce. */
  readonly validatorMessage: string | null;
}

/** How a reply came to be: the operations it proposed, the reads it made, the dry runs it suggested. */
export interface CopilotTraceResource {
  readonly operations: readonly CopilotTraceOperationResource[];
  readonly reads: readonly { readonly tool: string; readonly [key: string]: unknown }[];
  readonly dryRunProposals: readonly { readonly ticket: string; readonly [key: string]: unknown }[];
}

/** One message of the conversation. */
export interface CopilotMessageResource {
  readonly id: string;
  /** The message's place in its session, from 1. */
  readonly seq: number;
  readonly role: "user" | "copilot";
  readonly body: string;
  /** The chip rows — copilot replies only; `null` for a reply that asked nothing. */
  readonly choices: readonly CopilotChoiceResource[] | null;
  readonly toolTrace: CopilotTraceResource;
  /** Null when the exchange was not metered. */
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  /** Cents; `null` when the exchange was not priced — never a fabricated `0`. */
  readonly costCents: number | null;
  readonly status: "streaming" | "complete" | "interrupted";
  readonly createdAt: string;
}

/** The resolved alias of one exchange — the head's model pill. */
export interface CopilotProvenanceResource {
  readonly seq: number;
  readonly alias: string;
  readonly modelId: string;
}

/** One conversation. */
export interface CopilotSessionResource {
  readonly id: string;
  readonly workflowId: string;
  readonly status: "active" | "promoted" | "discarded";
  /** The `draft: security-patch` tag. */
  readonly draftName: string;
  readonly modelProvenance: readonly CopilotProvenanceResource[];
  readonly createdAt: string;
  readonly closedAt: string | null;
  /** The highest message `seq` handed out. */
  readonly lastSeq: number;
}

/** A reference in the draft that resolves to nothing yet (decision W7). */
export interface CopilotWarningResource {
  readonly code: string;
  readonly node: string;
  readonly name: string;
  readonly path: string;
  readonly message: string;
}

/** The shared draft as the conversation sees it. */
export interface CopilotDraftResource {
  /** The draft slot's etag — what the canvas sends as `If-Match`, so the two surfaces agree on what is current. */
  readonly etag: string;
  /** `v{published}.{rev}` — the head's `draft v0.3`. */
  readonly label: string;
  /** The stored document, or `null` before the first operation. */
  readonly definition: unknown;
  /** Operation batches per actor — the footer's `2 copilot edits applied`. */
  readonly provenanceSummary: DraftProvenanceSummary;
  /** W7's unresolved references, in document order. */
  readonly warnings: readonly CopilotWarningResource[];
}

/** The whole conversation, for a surface switching back to it (decision W9). */
export interface CopilotConversationResource {
  readonly session: CopilotSessionResource;
  readonly messages: readonly CopilotMessageResource[];
  readonly draft: CopilotDraftResource;
}

/**
 * The draft's revision label.
 *
 * @param workflow - The workflow row.
 * @returns `v{current_version or 0}.{draft_rev}`.
 */
export function draftLabel(workflow: Pick<Workflow, "current_version" | "draft_rev">): string {
  return `v${workflow.current_version ?? 0}.${workflow.draft_rev}`;
}

/**
 * A session row, as the API shows it.
 *
 * @param row - The row.
 * @returns The resource.
 */
export function copilotSession(row: CopilotSession): CopilotSessionResource {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    status: row.status,
    draftName: row.draft_name,
    modelProvenance: row.model_provenance.map((entry) => ({
      seq: entry.seq,
      alias: entry.alias,
      modelId: entry.model_id,
    })),
    createdAt: row.created_at.toISOString(),
    closedAt: row.closed_at === null ? null : row.closed_at.toISOString(),
    lastSeq: row.last_seq,
  };
}

/**
 * The chip rows, as the API shows them.
 *
 * @param choices - The stored value.
 * @returns The resource, or `null`.
 */
export function copilotChoices(
  choices: readonly CopilotChoice[] | null,
): readonly CopilotChoiceResource[] | null {
  return choices === null
    ? null
    : choices.map((choice) => ({
        prompt: choice.prompt,
        options: choice.options,
        selected: choice.selected,
        answeredAt: choice.answered_at,
      }));
}

/**
 * The tool trace, as the API shows it.
 *
 * @param trace - The stored value.
 * @returns The resource.
 */
export function copilotTrace(trace: CopilotToolTrace): CopilotTraceResource {
  return {
    operations: trace.operations.map((entry) => ({
      op: entry.op,
      outcome: entry.outcome,
      validatorMessage: entry.validator_message ?? null,
    })),
    reads: trace.reads,
    dryRunProposals: trace.dry_run_proposals,
  };
}

/**
 * A message row, as the API shows it.
 *
 * @param row - The row.
 * @returns The resource.
 */
export function copilotMessage(row: CopilotMessage): CopilotMessageResource {
  return {
    id: row.id,
    seq: row.seq,
    role: row.role,
    body: row.body,
    choices: copilotChoices(row.choices),
    toolTrace: copilotTrace(row.tool_trace),
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    costCents: row.cost_cents,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * An unresolved reference, as the API shows it.
 *
 * @param reference - The reference.
 * @returns The resource.
 */
export function copilotWarning(reference: UnresolvedReference): CopilotWarningResource {
  return {
    code: reference.code,
    node: reference.node,
    name: reference.name,
    path: reference.path,
    message: reference.message,
  };
}
