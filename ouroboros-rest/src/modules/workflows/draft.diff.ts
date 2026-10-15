/**
 * A studio save, as the draft's operation log records it (#1751).
 *
 * The canvas and the code view save a **whole document** (`PUT …/draft`, `PUT …/code`), but the
 * draft's history is a log of typed operations (V110, #556): `apply_draft_batch()` is its one
 * writer, and provenance, the `v0.N` revision, the per-actor edit counts and the replay probe all
 * read that log. So a save is diffed against the stored draft into one batch of the same
 * operations the copilot proposes, and applied as a `canvas` or `code` batch:
 *
 * ```
 * stored vs saved          the batch, in this order
 * edge gone or changed  →  remove_edge {from, to}     (not when a removed stage takes it anyway)
 * stage gone            →  remove_stage {id}          (its edges go with it)
 * stage changed         →  set_stage {node}           (in place)
 * stage new             →  add_stage {node}           (appended, in the saved order)
 * edge new or changed   →  add_edge {edge}            (appended, in the saved order)
 * trigger changed       →  set_trigger {trigger}
 * ```
 *
 * A changed stage id is a removal and an addition; a changed edge is a removal and an addition.
 * **Order is not recorded:** the stored draft is what the batch produces, so stages and edges keep
 * their place or are appended — a save that only reorders them changes nothing.
 *
 * **What the operations cannot say is refused** (`422 workflow_draft_inexpressible`), never
 * written around the log: a changed `dsl_version`, a removed trigger, a top-level key the log has
 * no operation for, a stage without a slug id, a repeated id, an edge naming no stage or repeating
 * a pair. The canvas cannot produce any of these.
 *
 * **What the operations can say is recorded however unfinished it is.** A model stage still
 * missing its route is a node the DSL schema refuses, and autosave exists to keep it; a person's
 * draft is held to the grammar at publish (WF-P.3), not here.
 *
 * Both documents are read as `apply_draft_batch()` reads a stored draft (V143, #1744): over the
 * empty document's keys, so a blank `{}` and `{"dsl_version": "1.0", "nodes": [], "edges": []}`
 * are the same document.
 */

import { isDeepStrictEqual } from "node:util";

import { emptyWorkflowDocument } from "./dsl.schema";

/** V110's `draft_op_shape_valid()` grammar for a stage id. */
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** The top-level keys an operation can change. Every other key must be left as it is. */
const OPERABLE_KEYS: ReadonlySet<string> = new Set(["dsl_version", "trigger", "nodes", "edges"]);

/** One operation of a studio batch: `draft_operations.op` — `{kind, params}`. */
export interface StudioOperation {
  readonly kind:
    "add_stage" | "set_stage" | "remove_stage" | "add_edge" | "remove_edge" | "set_trigger";
  readonly params: Readonly<Record<string, unknown>>;
}

/** Why a save cannot be recorded as operations. */
export interface DraftDiffProblem {
  /** A JSON pointer into the saved document. */
  readonly path: string;
  /** A sentence for the person. */
  readonly message: string;
}

/** The diff: the batch, or why there is none. */
export type DraftDiff =
  | { readonly ok: true; readonly operations: readonly StudioOperation[] }
  | { readonly ok: false; readonly problems: readonly DraftDiffProblem[] };

/** A document read over the empty one, its graph arrays checked. */
interface ReadDocument {
  readonly record: Readonly<Record<string, unknown>>;
  readonly nodes: readonly Readonly<Record<string, unknown>>[];
  readonly edges: readonly Readonly<Record<string, unknown>>[];
}

/**
 * The batch that turns the stored draft into the saved document.
 *
 * @param stored - The draft as the row holds it — or the base a first save is written over (the
 *   version in force, or the empty document). Trusted to be expressible: it is the log's output.
 * @param saved - The whole document the editor sent.
 * @returns The operations, in the order {@link StudioOperation} lists — empty when nothing
 *   changed — or every problem that keeps the save from being recorded.
 */
export function diffDraft(stored: unknown, saved: unknown): DraftDiff {
  const problems: DraftDiffProblem[] = [];
  const before = readDocument(stored, []);
  const after = readDocument(saved, problems);

  if (after === undefined || before === undefined) return { ok: false, problems };

  checkKeys(before.record, after.record, problems);
  const ids = checkNodes(after.nodes, problems);
  checkEdges(after.edges, ids, problems);

  if (problems.length > 0) return { ok: false, problems };

  return { ok: true, operations: operationsBetween(before, after) };
}

/**
 * Read a document over the empty one.
 *
 * @param value - The document.
 * @param problems - Where a shape the operations cannot hold is reported.
 * @returns The document, or `undefined` when it is not an object with array `nodes` and `edges`.
 */
function readDocument(value: unknown, problems: DraftDiffProblem[]): ReadDocument | undefined {
  if (!isRecord(value)) {
    problems.push({ path: "", message: "A draft is a JSON object." });
    return undefined;
  }

  const record: Record<string, unknown> = { ...emptyWorkflowDocument(), ...value };
  let shaped = true;

  for (const key of ["nodes", "edges"] as const) {
    if (!Array.isArray(record[key])) {
      problems.push({ path: `/${key}`, message: `\`${key}\` is a list.` });
      shaped = false;
    }
  }
  if (!shaped) return undefined;

  const nodes = record.nodes as unknown[];
  const edges = record.edges as unknown[];
  nodes.forEach((node, index) => {
    if (!isRecord(node))
      problems.push({ path: `/nodes/${index}`, message: "A stage is an object." });
  });
  edges.forEach((edge, index) => {
    if (!isRecord(edge))
      problems.push({ path: `/edges/${index}`, message: "An edge is an object." });
  });

  return {
    record,
    nodes: nodes.filter(isRecord),
    edges: edges.filter(isRecord),
  };
}

/**
 * The top-level keys: only the trigger may change, and it may not go.
 *
 * @param before - The stored document.
 * @param after - The saved document.
 * @param problems - Where a refusal is reported.
 */
function checkKeys(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
  problems: DraftDiffProblem[],
): void {
  if (!sameJson(before.dsl_version, after.dsl_version)) {
    problems.push({
      path: "/dsl_version",
      message: "The DSL version cannot be changed from the editor.",
    });
  }

  if (after.trigger === undefined) {
    if (before.trigger !== undefined) {
      problems.push({ path: "/trigger", message: "The trigger can be changed but not removed." });
    }
  } else if (!isRecord(after.trigger)) {
    problems.push({ path: "/trigger", message: "The trigger is an object." });
  }

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (OPERABLE_KEYS.has(key) || sameJson(before[key], after[key])) continue;
    problems.push({
      path: `/${escapePointer(key)}`,
      message: `\`${key}\` is not part of a workflow draft and cannot be changed.`,
    });
  }
}

/**
 * The stages: each a slug id, each id once.
 *
 * @param nodes - The saved stages.
 * @param problems - Where a refusal is reported.
 * @returns The ids that are usable, for the edge check.
 */
function checkNodes(
  nodes: readonly Readonly<Record<string, unknown>>[],
  problems: DraftDiffProblem[],
): ReadonlySet<string> {
  const ids = new Set<string>();

  nodes.forEach((node, index) => {
    const id = node.id;
    if (typeof id !== "string" || !SLUG.test(id)) {
      problems.push({
        path: `/nodes/${index}/id`,
        message: "A stage's id is lower-case letters, digits and hyphens, at most 64 characters.",
      });
      return;
    }
    if (ids.has(id)) {
      problems.push({ path: `/nodes/${index}/id`, message: `Two stages are called "${id}".` });
      return;
    }
    ids.add(id);
  });

  return ids;
}

/**
 * The edges: both ends name a stage, and each ordered pair is joined once.
 *
 * @param edges - The saved edges.
 * @param ids - The saved stage ids.
 * @param problems - Where a refusal is reported.
 */
function checkEdges(
  edges: readonly Readonly<Record<string, unknown>>[],
  ids: ReadonlySet<string>,
  problems: DraftDiffProblem[],
): void {
  const pairs = new Set<string>();

  edges.forEach((edge, index) => {
    for (const end of ["from", "to"] as const) {
      const name = edge[end];
      if (typeof name !== "string" || !ids.has(name)) {
        problems.push({
          path: `/edges/${index}/${end}`,
          message:
            typeof name === "string"
              ? `This edge names "${name}", which is not a stage.`
              : `An edge's \`${end}\` names a stage.`,
        });
      }
    }

    const pair = pairOf(edge);
    if (pairs.has(pair)) {
      problems.push({
        path: `/edges/${index}`,
        message: `${String(edge.from)} → ${String(edge.to)} is joined twice.`,
      });
    }
    pairs.add(pair);
  });
}

/**
 * The operations, in the order the module header gives.
 *
 * @param before - The stored document.
 * @param after - The saved document, already checked.
 * @returns The batch.
 */
function operationsBetween(before: ReadDocument, after: ReadDocument): StudioOperation[] {
  const beforeNodes = new Map(before.nodes.map((node) => [node.id as string, node]));
  const afterNodes = new Map(after.nodes.map((node) => [node.id as string, node]));
  const removedIds = new Set([...beforeNodes.keys()].filter((id) => !afterNodes.has(id)));
  const operations: StudioOperation[] = [];

  for (const edge of before.edges) {
    const kept = after.edges.some((candidate) => sameJson(candidate, edge));
    const takenByStage = removedIds.has(edge.from as string) || removedIds.has(edge.to as string);
    if (!kept && !takenByStage) {
      operations.push({ kind: "remove_edge", params: { from: edge.from, to: edge.to } });
    }
  }

  for (const id of removedIds) operations.push({ kind: "remove_stage", params: { id } });

  for (const [id, node] of afterNodes) {
    const previous = beforeNodes.get(id);
    if (previous !== undefined && !sameJson(previous, node)) {
      operations.push({ kind: "set_stage", params: { node } });
    }
  }

  for (const [id, node] of afterNodes) {
    if (!beforeNodes.has(id)) operations.push({ kind: "add_stage", params: { node } });
  }

  for (const edge of after.edges) {
    const present = before.edges.some(
      (candidate) =>
        sameJson(candidate, edge) &&
        !removedIds.has(candidate.from as string) &&
        !removedIds.has(candidate.to as string),
    );
    if (!present) operations.push({ kind: "add_edge", params: { edge } });
  }

  if (
    after.record.trigger !== undefined &&
    !sameJson(before.record.trigger, after.record.trigger)
  ) {
    operations.push({ kind: "set_trigger", params: { trigger: after.record.trigger } });
  }

  return operations;
}

/**
 * Whether two values are the same JSON — what a `jsonb` column compares. Normalised through JSON
 * first, so neither key order nor where an object was made (a request body, a database row)
 * counts.
 *
 * @param a - One value.
 * @param b - The other.
 * @returns Whether they serialise to the same JSON value.
 */
function sameJson(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(asJson(a), asJson(b));
}

/** A value as JSON reads it back; `undefined` stays `undefined`. */
function asJson(value: unknown): unknown {
  return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as unknown);
}

/** An edge's identity: its ordered pair. */
function pairOf(edge: Readonly<Record<string, unknown>>): string {
  return JSON.stringify([edge.from, edge.to]);
}

/** Whether a value is a plain JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A key as one JSON pointer segment (RFC 6901). */
function escapePointer(key: string): string {
  return key.replaceAll("~", "~0").replaceAll("/", "~1");
}
