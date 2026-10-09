/**
 * The typed operation vocabulary, REST-side: what the copilot may propose, checked against the
 * DSL (WF-P.2, #133) **before** anything is applied, with a message a model can correct from.
 *
 * Decision **W2**: copilot edits are the same operations the canvas and the code editor produce,
 * recorded by `ouroboros.apply_draft_batch()` (V110, #556). This module holds the REST side of
 * that contract — the shape of each operation (`schemas/workflow-dsl/operations-v1.json`, as zod
 * over the DSL's own node, edge and trigger schemas), the preconditions `workflow_draft_apply_op()`
 * enforces (a stage must exist to be set, an edge must join two stages, …), mirrored here so a
 * refusal is a *bounce* with a sentence rather than a database error, and the application of one
 * operation to a document, which is the same transformation the database performs.
 *
 * **What bounces and what does not.** An operation bounces when its own object is wrong: a node
 * whose config does not parse, an edge naming a stage that is not there, a trigger with an
 * unknown condition. It does **not** bounce because the *document* is not yet whole — a draft
 * built up one operation at a time has no trigger node until the operation that adds one, and a
 * validator that refused every step before the last would make the copilot unable to build
 * anything. Whole-document validity is reported to the model as information
 * ({@link OperationApplied.documentErrors}) and to the person at promote time (the publish gate).
 *
 * **`set_guard` is a proposal.** DSL v1 has no guard construct, so the mockup's *"$5 a run"* is
 * recorded on the reply as `proposed` — checked against the workspace's guard vocabulary, never
 * applied to the document, and said so to the person.
 */

import { z, type ZodIssue } from "zod";

import { SCHEMA_STAGE_CODES, type DslDiagnostic } from "../workflows/dsl.errors";
import type { DslCatalogue } from "../workflows/dsl.references";
import { EdgeSchema, NodeIdSchema, NodeShapeSchema, TriggerSchema } from "../workflows/dsl.schema";
import { validateWorkflowDocument } from "../workflows/dsl.validator";

/** `draft_operations.op.kind` — the vocabulary `draft_op_shape_valid()` accepts (V110). */
export const OPERATION_KINDS = [
  "add_stage",
  "set_stage",
  "remove_stage",
  "add_edge",
  "remove_edge",
  "set_trigger",
] as const;

/** One of {@link OPERATION_KINDS}. */
export type OperationKind = (typeof OPERATION_KINDS)[number];

/** The guard proposal — in the copilot's vocabulary, not yet in the document's. */
export const GUARD_KIND = "set_guard";

/** Every write the copilot can propose: the operations, and the guard proposal. */
export const WRITE_KINDS: readonly string[] = [...OPERATION_KINDS, GUARD_KIND];

/**
 * One operation, exactly as `operations-v1.json` describes it: `{kind, params}` with the DSL's
 * own objects as params. Closed at every level, so a key the vocabulary does not know is a
 * bounce naming it rather than a parameter silently ignored.
 */
export const DraftOperationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("add_stage"),
    params: z.strictObject({ node: NodeShapeSchema }),
  }),
  z.strictObject({
    kind: z.literal("set_stage"),
    params: z.strictObject({ node: NodeShapeSchema }),
  }),
  z.strictObject({ kind: z.literal("remove_stage"), params: z.strictObject({ id: NodeIdSchema }) }),
  z.strictObject({ kind: z.literal("add_edge"), params: z.strictObject({ edge: EdgeSchema }) }),
  z.strictObject({
    kind: z.literal("remove_edge"),
    params: z.strictObject({ from: NodeIdSchema, to: NodeIdSchema }),
  }),
  z.strictObject({
    kind: z.literal("set_trigger"),
    params: z.strictObject({ trigger: TriggerSchema }),
  }),
]);

/** A validated operation. */
export type DraftOperation = z.infer<typeof DraftOperationSchema>;

/** An operation as proposed — `kind` known, `params` not yet. */
export interface ProposedOperation {
  readonly kind: string;
  readonly params: Record<string, unknown>;
}

/**
 * The document, as stored — read loosely, because the operations touch `nodes`, `edges` and
 * `trigger` and leave everything else exactly as it was.
 */
export interface DraftDocument {
  readonly dsl_version: string;
  readonly trigger?: unknown;
  readonly nodes: readonly unknown[];
  readonly edges: readonly unknown[];
  readonly [key: string]: unknown;
}

/** `workflow_draft_base()` for a workflow with nothing published: the document the first operation builds on. */
export const EMPTY_DRAFT: DraftDocument = { dsl_version: "1.0", nodes: [], edges: [] };

/** A trigger that fires on every queued ticket — what a node is probed under before the draft has one. */
const PROBE_TRIGGER = { event: "ticket_queued", conditions: {} };

/** The operation applied, and what the document looks like afterwards. */
export interface OperationApplied {
  readonly ok: true;
  /** The operation, validated — what is recorded. */
  readonly operation: DraftOperation;
  /** The document after the operation. */
  readonly document: DraftDocument;
  /** Whether the whole document validates now; a draft under construction usually does not yet. */
  readonly documentValid: boolean;
  /** What keeps the document from validating — information for the model, never a bounce. */
  readonly documentErrors: readonly DslDiagnostic[];
}

/** The operation refused, with the sentence the model is told. */
export interface OperationBounced {
  readonly ok: false;
  readonly message: string;
}

/** What checking an operation produces. */
export type OperationCheck = OperationApplied | OperationBounced;

/**
 * Turn a tool call into the operation it proposes.
 *
 * The engine's manifest spells arguments the way the operation spells params — `add_stage{node}`,
 * `remove_edge{from, to}` — so this is a rename of the envelope, not a translation.
 *
 * @param tool - The tool called.
 * @param args - Its validated arguments.
 * @returns The operation, or `undefined` for a tool that is not one.
 */
export function operationFromCall(
  tool: string,
  args: Record<string, unknown>,
): ProposedOperation | undefined {
  return (OPERATION_KINDS as readonly string[]).includes(tool)
    ? { kind: tool, params: args }
    : undefined;
}

/**
 * Read a stored document loosely, defaulting what the operations need.
 *
 * @param stored - The draft as the row holds it, or `null`/`undefined` for no draft.
 * @returns The document, with `nodes` and `edges` arrays whatever was stored.
 */
export function asDraftDocument(stored: unknown): DraftDocument {
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return EMPTY_DRAFT;
  const record = stored as Record<string, unknown>;
  return {
    ...record,
    dsl_version: typeof record.dsl_version === "string" ? record.dsl_version : "1.0",
    nodes: Array.isArray(record.nodes) ? record.nodes : [],
    edges: Array.isArray(record.edges) ? record.edges : [],
  };
}

/**
 * Check one proposed operation against the document it would change, and apply it.
 *
 * Three gates, in order, each with a sentence written for the model: the operation's shape
 * (zod over the DSL's own schemas), the node's typed config (the DSL validator's own node stage,
 * run over a one-node probe so the verdict is about *this* node and not about the draft being
 * unfinished), and the preconditions `workflow_draft_apply_op()` enforces.
 *
 * @param stored - The draft as stored.
 * @param proposed - The operation as the copilot proposed it.
 * @param catalogue - The names that exist, for the whole-document verdict's warnings.
 * @returns Applied, with the new document — or bounced, with the message.
 */
export function checkOperation(
  stored: unknown,
  proposed: ProposedOperation,
  catalogue?: DslCatalogue,
): OperationCheck {
  const document = asDraftDocument(stored);

  // A stage the operation names has to exist before its spelling is held to the grammar: an
  // edge to `exploit_verify` is a near miss of `exploit-verify`, and *did you mean* is the
  // message that corrects it, not *must match pattern*.
  const missing = missingStage(document, proposed);
  if (missing !== undefined) return { ok: false, message: missing };

  const parsed = DraftOperationSchema.safeParse(proposed);
  if (!parsed.success) {
    return { ok: false, message: describeIssues(parsed.error.issues) };
  }
  const operation = parsed.data;

  if (operation.kind === "add_stage" || operation.kind === "set_stage") {
    const refused = probeNode(document, operation.params.node);
    if (refused !== undefined) return { ok: false, message: refused };
  }

  const applied = applyOperation(document, operation);
  if (!applied.ok) return applied;

  const verdict = validateWorkflowDocument(applied.document, { catalogue });
  return {
    ok: true,
    operation,
    document: applied.document,
    documentValid: verdict.valid,
    documentErrors: verdict.errors,
  };
}

/**
 * Apply one validated operation — the same transformation `workflow_draft_apply_op()` performs,
 * with the same preconditions, refused with a sentence instead of a `check_violation`.
 *
 * @param document - The document before.
 * @param operation - The operation, validated.
 * @returns The document after, or the refusal.
 */
export function applyOperation(
  document: DraftDocument,
  operation: DraftOperation,
): { ok: true; document: DraftDocument } | OperationBounced {
  const ids = nodeIds(document);

  switch (operation.kind) {
    case "add_stage": {
      const { node } = operation.params;
      if (ids.includes(node.id)) {
        return {
          ok: false,
          message: `add_stage: stage "${node.id}" already exists — use set_stage to change it.`,
        };
      }
      return { ok: true, document: { ...document, nodes: [...document.nodes, node] } };
    }
    case "set_stage": {
      const { node } = operation.params;
      if (!ids.includes(node.id)) {
        return {
          ok: false,
          message: `set_stage: no stage "${node.id}"${suggest(node.id, ids)} — use add_stage to add one.`,
        };
      }
      return {
        ok: true,
        document: {
          ...document,
          nodes: document.nodes.map((existing) => (idOf(existing) === node.id ? node : existing)),
        },
      };
    }
    case "remove_stage": {
      const { id } = operation.params;
      if (!ids.includes(id)) {
        return { ok: false, message: `remove_stage: no stage "${id}"${suggest(id, ids)}.` };
      }
      return {
        ok: true,
        document: {
          ...document,
          nodes: document.nodes.filter((existing) => idOf(existing) !== id),
          edges: document.edges.filter((edge) => fromOf(edge) !== id && toOf(edge) !== id),
        },
      };
    }
    case "add_edge": {
      const { edge } = operation.params;
      for (const [end, name] of [
        ["from", edge.from],
        ["to", edge.to],
      ] as const) {
        if (!ids.includes(name)) {
          return {
            ok: false,
            message: `edge.${end} "${name}" names no stage${suggest(name, ids)}.`,
          };
        }
      }
      if (
        document.edges.some(
          (existing) => fromOf(existing) === edge.from && toOf(existing) === edge.to,
        )
      ) {
        return { ok: false, message: `add_edge: ${edge.from} → ${edge.to} is already joined.` };
      }
      return { ok: true, document: { ...document, edges: [...document.edges, edge] } };
    }
    case "remove_edge": {
      const { from, to } = operation.params;
      if (!document.edges.some((existing) => fromOf(existing) === from && toOf(existing) === to)) {
        return { ok: false, message: `remove_edge: no edge ${from} → ${to}.` };
      }
      return {
        ok: true,
        document: {
          ...document,
          edges: document.edges.filter(
            (existing) => !(fromOf(existing) === from && toOf(existing) === to),
          ),
        },
      };
    }
    case "set_trigger":
      return { ok: true, document: { ...document, trigger: operation.params.trigger } };
  }
}

/**
 * The first stage an operation names that is not in the document, as the bounce sentence.
 *
 * @param document - The document.
 * @param proposed - The operation as proposed, params unvalidated.
 * @returns The sentence, or `undefined` when every stage named exists (or the kind names none).
 */
function missingStage(document: DraftDocument, proposed: ProposedOperation): string | undefined {
  const ids = nodeIds(document);
  const params = proposed.params;
  const named: { label: string; name: unknown; hint: string }[] = [];

  switch (proposed.kind) {
    case "set_stage":
      named.push({
        label: "set_stage: no stage",
        name: (params.node as { id?: unknown } | undefined)?.id,
        hint: " — use add_stage to add one",
      });
      break;
    case "remove_stage":
      named.push({ label: "remove_stage: no stage", name: params.id, hint: "" });
      break;
    case "add_edge": {
      const edge = params.edge as { from?: unknown; to?: unknown } | undefined;
      named.push({ label: "edge.from", name: edge?.from, hint: " names no stage" });
      named.push({ label: "edge.to", name: edge?.to, hint: " names no stage" });
      break;
    }
    case "remove_edge":
      named.push({ label: "edge.from", name: params.from, hint: " names no stage" });
      named.push({ label: "edge.to", name: params.to, hint: " names no stage" });
      break;
    default:
      return undefined;
  }

  for (const { label, name, hint } of named) {
    if (typeof name !== "string" || ids.includes(name)) continue;
    return hint === " names no stage"
      ? `${label} "${name}"${hint}${suggest(name, ids)}.`
      : `${label} "${name}"${suggest(name, ids)}${hint}.`;
  }
  return undefined;
}

/**
 * The DSL validator's own verdict on one node, isolated from the draft around it.
 *
 * @param document - The draft, for its trigger when it has one.
 * @param node - The node to probe.
 * @returns The sentence to bounce with, or `undefined` when the node's config parses.
 */
function probeNode(
  document: DraftDocument,
  node: z.infer<typeof NodeShapeSchema>,
): string | undefined {
  const probe = {
    dsl_version: "1.0",
    trigger: document.trigger ?? PROBE_TRIGGER,
    nodes: [node],
    edges: [],
  };
  const verdict = validateWorkflowDocument(probe);
  const own = verdict.errors.filter(
    (error) => SCHEMA_STAGE_CODES.has(error.code) && error.node === node.id,
  );
  if (own.length === 0) return undefined;
  return own
    .map(
      (error) =>
        `${error.path.replace(/^\/nodes\/0\/?/, "node.").replace(/\//g, ".")}: ${error.message}`,
    )
    .join(" ");
}

/**
 * Zod's issues, as one sentence the model can act on — `params.node.position: Required`.
 *
 * @param issues - What zod refused.
 * @returns The sentence.
 */
export function describeIssues(issues: readonly ZodIssue[]): string {
  const parts = issues.map((issue) => {
    const where = issue.path.length === 0 ? "operation" : issue.path.map(String).join(".");
    return `${where}: ${issue.message}`;
  });
  return `the operation does not validate — ${parts.join("; ")}`;
}

/**
 * The ids of a document's stages, in order.
 *
 * @param document - The document.
 * @returns Every string `id` found.
 */
export function nodeIds(document: DraftDocument): string[] {
  return document.nodes.map(idOf).filter((id): id is string => id !== undefined);
}

/**
 * *— did you mean "exploit-verify"?*, when a name is close to one that exists.
 *
 * @param name - The name that resolved to nothing.
 * @param candidates - The names that exist.
 * @returns The suffix, or an empty string when nothing is close.
 */
export function suggest(name: string, candidates: readonly string[]): string {
  const near = nearest(name, candidates);
  return near === undefined ? "" : ` — did you mean "${near}"`;
}

/**
 * The closest candidate — equal up to `_`/`-` spelling, or within two edits.
 *
 * @param name - The name.
 * @param candidates - The names that exist.
 * @returns The closest, or `undefined` when none is close.
 */
export function nearest(name: string, candidates: readonly string[]): string | undefined {
  const normalized = name.replace(/_/g, "-").toLowerCase();
  const spelled = candidates.find(
    (candidate) => candidate.replace(/_/g, "-").toLowerCase() === normalized,
  );
  if (spelled !== undefined) return spelled;

  let best: { candidate: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const distance = editDistance(normalized, candidate.toLowerCase());
    if (distance <= 2 && (best === undefined || distance < best.distance)) {
      best = { candidate, distance };
    }
  }
  return best?.candidate;
}

/**
 * Levenshtein distance, for the suggestion.
 *
 * @param a - One string.
 * @param b - The other.
 * @returns How many single-character edits turn one into the other.
 */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length];
}

function idOf(node: unknown): string | undefined {
  const id = (node as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : undefined;
}

function fromOf(edge: unknown): string | undefined {
  const from = (edge as { from?: unknown } | null)?.from;
  return typeof from === "string" ? from : undefined;
}

function toOf(edge: unknown): string | undefined {
  const to = (edge as { to?: unknown } | null)?.to;
  return typeof to === "string" ? to : undefined;
}
