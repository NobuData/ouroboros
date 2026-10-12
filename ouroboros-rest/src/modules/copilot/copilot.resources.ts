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
  DraftNodeProvenance,
  DraftProvenanceSummary,
  DryRun,
  DryRunStatus,
  Workflow,
  WorkflowDraftNodeProvenance,
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

/** Who one stage of the draft is by — the stage list's `added by copilot` pill (CE.3, #567). */
export interface CopilotNodeProvenanceResource {
  /** The stage's `id` in `definition.nodes`. */
  readonly nodeId: string;
  /**
   * `copilot` or `suggestion` for a stage the conversation or an Apply added and nobody has
   * edited since; `human` for one a person added or has since edited; `published` for one the
   * draft inherited from the version it started from.
   */
  readonly provenance: DraftNodeProvenance;
  /** The draft revision that added the stage; `null` for a `published` one. */
  readonly addedRev: number | null;
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
  /** Who each stage is by, one entry per stage in the document's order; empty without a draft. */
  readonly nodeProvenance: readonly CopilotNodeProvenanceResource[];
}

/** The whole conversation, for a surface switching back to it (decision W9). */
export interface CopilotConversationResource {
  readonly session: CopilotSessionResource;
  readonly messages: readonly CopilotMessageResource[];
  readonly draft: CopilotDraftResource;
}

/** One guard a promotion carries, with where it is really enforced (CE.1, #565). */
export interface CopilotPromotionGuardResource {
  readonly id: "never_auto_merge" | "spend_guard";
  /** The chip — `never auto-merge`, `spend cap $5.00/run`. */
  readonly label: string;
  /** Whether the document itself says it, or the conversation proposed it. */
  readonly source: "definition" | "conversation";
  /** `enforced` on real runs, or honoured by dry runs only. */
  readonly enforcement: "enforced" | "dry_run_only";
  /** One sentence naming where it is enforced — or is not yet. */
  readonly enforcedBy: string;
}

/** An unresolved reference of the draft, with whether the publish gate refuses it. */
export interface CopilotPromotionReferenceResource extends CopilotWarningResource {
  /** `true` exactly for `reference.unknown_alias`; skills and task routes are advisory. */
  readonly blocking: boolean;
}

/** What **Promote to workflow** would publish (CE.1, #565). */
export interface CopilotPromotionResource {
  readonly workflow: { readonly id: string; readonly slug: string; readonly name: string };
  /** The version a publish would create, and how the dialog names it — `security-patch v1`. */
  readonly publishes: { readonly version: number; readonly label: string };
  readonly draft: {
    /** `false` when the workflow has no draft row. */
    readonly present: boolean;
    /** `v{published}.{rev}` — `v0.3`. */
    readonly label: string;
    /** The draft slot's etag — what a save sends as `If-Match`. */
    readonly etag: string;
  };
  /** The active session, else the most recently closed one, else `null`. */
  readonly session: {
    readonly id: string;
    readonly status: "active" | "promoted" | "discarded";
  } | null;
  readonly guards: readonly CopilotPromotionGuardResource[];
  readonly references: readonly CopilotPromotionReferenceResource[];
  /** Whether something already known stands in the way. Publishing still validates. */
  readonly blocked: boolean;
  /** A sentence per reason; empty when not blocked. */
  readonly blockedReasons: readonly string[];
}

/** What **Discard draft** did (CE.1, #565). */
export interface CopilotDiscardResource {
  readonly workflowId: string;
  /** Whether a draft was removed — `false` when only a conversation was closed. */
  readonly draftDiscarded: boolean;
  /** The session just closed as `discarded`, or `null` when none was active. */
  readonly session: CopilotSessionResource | null;
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
 * `GET …/copilot/readiness` — whether a message sent now could be answered (CE.2, #566).
 *
 * What the service knows without asking anybody: nothing here invokes a model.
 */
export interface CopilotReadinessResource {
  /** Whether this deployment has the invocation gateway a reply is made through. */
  readonly gateway: { readonly available: boolean };
  /** What routing the next reply would find. */
  readonly route: {
    /** `copilot-workflow`. */
    readonly taskKind: string;
    readonly resolved: boolean;
    /** The alias a reply would be routed to — a string exactly when `resolved`. */
    readonly alias: string | null;
    /** That alias's model id — a string exactly when `resolved`. */
    readonly modelId: string | null;
    /**
     * Why not — `null` exactly when `resolved`. The sentence an unrouted reply gives, without
     * its leading "I can't reach a model: ".
     */
    readonly reason: string | null;
  };
  /** The workflow's dry run that has not ended, or `null`. */
  readonly dryRun: { readonly id: string; readonly status: DryRunStatus } | null;
}

/**
 * The readiness, as the API shows it.
 *
 * @param gatewayAvailable - Whether the deployment has the invocation gateway.
 * @param taskKind - The task kind the copilot is routed as.
 * @param routed - The alias and model a reply would use, or the reason there is none.
 * @param dryRun - The workflow's open dry run, when it has one.
 * @returns The resource.
 */
export function copilotReadiness(
  gatewayAvailable: boolean,
  taskKind: string,
  routed: { readonly alias: string; readonly modelId: string } | string,
  dryRun: Pick<DryRun, "id" | "status"> | undefined,
): CopilotReadinessResource {
  return {
    gateway: { available: gatewayAvailable },
    route:
      typeof routed === "string"
        ? { taskKind, resolved: false, alias: null, modelId: null, reason: routed }
        : { taskKind, resolved: true, alias: routed.alias, modelId: routed.modelId, reason: null },
    dryRun: dryRun === undefined ? null : { id: dryRun.id, status: dryRun.status },
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

/**
 * Who each stage of a draft is by, as the API shows it — in the document's order, whatever
 * order the view answered in.
 *
 * A stage the view has no row for, and a row for a stage the document does not have, are both
 * left out: the document and the view are two reads, and a batch may land between them.
 *
 * @param definition - The stored draft document, or `null` when there is none.
 * @param rows - The view's rows for the workflow.
 * @returns One entry per stage the two reads agree on, in `definition.nodes` order.
 */
export function copilotNodeProvenance(
  definition: unknown,
  rows: readonly Pick<WorkflowDraftNodeProvenance, "added_rev" | "node_id" | "provenance">[],
): readonly CopilotNodeProvenanceResource[] {
  const nodes = (definition as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(nodes)) return [];

  const byNode = new Map(rows.map((row) => [row.node_id, row]));
  const entries: CopilotNodeProvenanceResource[] = [];
  for (const node of nodes as readonly unknown[]) {
    const id = (node as { id?: unknown } | null)?.id;
    const row = typeof id === "string" ? byNode.get(id) : undefined;
    if (row === undefined) continue;
    byNode.delete(row.node_id);
    entries.push({ nodeId: row.node_id, provenance: row.provenance, addedRev: row.added_rev });
  }
  return entries;
}
