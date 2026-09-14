/**
 * The DSL's structural rules, where an edit is made (S.5,
 * [#151](https://github.com/NobuData/ouroboros/issues/151)).
 *
 * `docs/WORKFLOW_DSL.md` § 7 lists the rules JSON Schema cannot express — one trigger, a terminal,
 * unique ids, reachability, and what an edge may join — and both validators run them at publish
 * (`ouroboros-rest`'s zod stage, `ouroboros-engine`'s pydantic stage). The canvas runs them too,
 * for a different reader at a different moment: **at the edit**, so an illegal connection is
 * refused with its reason on screen rather than accepted and reported minutes later at publish.
 *
 * Two kinds of entry point:
 *
 * - {@link structuralFindings} — the whole § 7 table over a document, with the codes, the paths
 *   and the names `schemas/workflow-dsl/fixtures/expected.json` freezes, so `rules.test.ts` holds
 *   this module to the same parity contract the two validators are held to.
 * - {@link edgeProblem}, {@link stageProblem} and {@link insertProblem} — one proposed edit, judged
 *   against the draft it would change: the rule it would break, or `null`.
 *
 * **Not a validator.** The publish gate (P.3) stays the authority: nothing here reads the schema,
 * and a document the canvas accepts may still be refused for a missing prompt template. What this
 * module promises is narrower — an edit the canvas makes never introduces a § 7 violation of its
 * own.
 *
 * **React-free**, as `graph.ts` is, and **defensive** in the same way: a draft is stored
 * unvalidated, so a node with no string id or an edge with no string endpoint is simply not one of
 * the things a rule is asked about — that is the schema stage's to report, not this one's.
 */

import type { WorkflowDefinition } from "@/app/api/workflows";

import type { EdgeRef } from "./graph";

/* ------------------------------------------------------------------ the vocabulary */

/** Every code § 7 defines, spelled as both validators and the parity file spell them. */
export type StructuralCode =
  | "document.no_trigger"
  | "document.multiple_triggers"
  | "document.no_terminal"
  | "node.duplicate_id"
  | "node.unreachable"
  | "edge.unknown_from"
  | "edge.unknown_to"
  | "edge.duplicate"
  | "edge.self_reference"
  | "edge.into_trigger"
  | "edge.out_of_terminal"
  | "edge.branch_without_condition"
  | "edge.unexpected_condition"
  | "edge.loop_not_upstream";

/**
 * The codes an edit on the canvas can be refused with — the ones one added stage or one edge can
 * break at the moment it is made. The rest (no trigger yet, no terminal yet, a stage not yet
 * connected, a duplicated id) describe a graph that is **unfinished**, which every graph is while
 * it is being built; refusing an edit for them would make building one impossible.
 */
export type EditRule = Extract<
  StructuralCode,
  | "document.multiple_triggers"
  | "edge.unknown_from"
  | "edge.unknown_to"
  | "edge.duplicate"
  | "edge.self_reference"
  | "edge.into_trigger"
  | "edge.out_of_terminal"
  | "edge.branch_without_condition"
  | "edge.unexpected_condition"
  | "edge.loop_not_upstream"
>;

/** One broken rule, as the parity file records a diagnostic: its code, where, and what it names. */
export interface StructuralFinding {
  readonly code: StructuralCode;
  /** The RFC 6901 pointer the diagnostic is anchored at — `/nodes/2`, `/edges/1/condition`. */
  readonly path: string;
  /** The node it names, for a node diagnostic that names one. */
  readonly node?: string;
  /** The edge it names, by its endpoints, for an edge diagnostic. */
  readonly edge?: EdgeRef;
}

/** An edge an edit proposes: its endpoints, its kind and whether it carries a condition. */
export interface EdgeCandidate {
  readonly from: string;
  readonly to: string;
  /** `default`, `branch` or `loop` — read as a string, because the kind is what is being judged. */
  readonly kind: string;
  /** The condition it carries, or `undefined` for none. Its shape is the schema's to check. */
  readonly condition?: unknown;
}

/* ------------------------------------------------------------------ reading the document */

/** One node, as the rules need it: its id, its type, and where in `nodes` it sits. */
interface NodeFacts {
  readonly id: string;
  readonly type: string;
  readonly index: number;
}

/** One edge, as the rules need it. */
interface EdgeFacts extends EdgeCandidate {
  readonly index: number;
}

/**
 * Whether a value is a plain object.
 *
 * @param value Anything.
 * @returns `true` for a non-null object that is not an array.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The document's nodes that carry a string id.
 *
 * @param definition The document.
 * @returns Every such node, with its index; a missing or non-string `type` reads as `""`.
 */
function readNodes(definition: WorkflowDefinition): NodeFacts[] {
  const { nodes } = definition;
  if (!Array.isArray(nodes)) return [];

  const facts: NodeFacts[] = [];
  nodes.forEach((node: unknown, index) => {
    if (!isRecord(node) || typeof node.id !== "string") return;
    facts.push({ id: node.id, type: typeof node.type === "string" ? node.type : "", index });
  });

  return facts;
}

/**
 * The document's edges that carry two string endpoints.
 *
 * @param definition The document.
 * @returns Every such edge, with its index; a missing `kind` reads as `""`.
 */
function readEdges(definition: WorkflowDefinition): EdgeFacts[] {
  const { edges } = definition;
  if (!Array.isArray(edges)) return [];

  const facts: EdgeFacts[] = [];
  edges.forEach((edge: unknown, index) => {
    if (!isRecord(edge) || typeof edge.from !== "string" || typeof edge.to !== "string") return;
    facts.push({
      from: edge.from,
      to: edge.to,
      kind: typeof edge.kind === "string" ? edge.kind : "",
      condition: edge.condition,
      index,
    });
  });

  return facts;
}

/**
 * Each node id's type, taken from its first occurrence — the node the edges were written against
 * when an id is repeated.
 *
 * @param nodes The nodes.
 * @returns id → type.
 */
function typesById(nodes: readonly NodeFacts[]): Map<string, string> {
  const types = new Map<string, string>();
  for (const node of nodes) if (!types.has(node.id)) types.set(node.id, node.type);
  return types;
}

/**
 * Whether one stage can reach another by following edges forward.
 *
 * @param start Where the walk starts.
 * @param goal What it is looking for.
 * @param edges The edges it may follow.
 * @returns `true` when a path of one or more edges leads from `start` to `goal`.
 */
function reaches(start: string, goal: string, edges: readonly EdgeCandidate[]): boolean {
  const seen = new Set<string>();
  const queue = [start];

  while (queue.length > 0) {
    const current = queue.shift();
    for (const edge of edges) {
      if (edge.from !== current || seen.has(edge.to)) continue;
      if (edge.to === goal) return true;
      seen.add(edge.to);
      queue.push(edge.to);
    }
  }

  return false;
}

/**
 * The rules one edge between two known stages breaks, in the order a reader should hear them.
 *
 * *Upstream*, precisely as § 7 defines it: a loop edge `A → B` is legal when `B` reaches `A` by
 * following edges forward **without using that loop edge** — so `others` never holds the edge being
 * judged.
 *
 * @param edge The edge.
 * @param types Each known stage's type.
 * @param others Every other edge in the graph.
 * @returns The codes it breaks; empty for a legal edge. A self-reference is not judged further,
 *   because every rule after it would be about a stage's relation to itself.
 */
function edgeCodes(edge: EdgeCandidate, types: ReadonlyMap<string, string>, others: readonly EdgeCandidate[]): EditRule[] {
  const codes: EditRule[] = [];

  if (others.some((other) => other.from === edge.from && other.to === edge.to)) codes.push("edge.duplicate");
  if (edge.from === edge.to) return [...codes, "edge.self_reference"];
  if (types.get(edge.to) === "trigger") codes.push("edge.into_trigger");
  if (types.get(edge.from) === "term") codes.push("edge.out_of_terminal");
  if (edge.kind === "branch" && edge.condition === undefined) codes.push("edge.branch_without_condition");
  if (edge.kind === "default" && edge.condition !== undefined) codes.push("edge.unexpected_condition");
  if (edge.kind === "loop" && !reaches(edge.to, edge.from, others)) codes.push("edge.loop_not_upstream");

  return codes;
}

/**
 * Where on the edge a code's diagnostic is anchored: the condition's two rules at the condition,
 * every other rule at the edge itself.
 *
 * @param code The code.
 * @param index The edge's index in `edges`.
 * @returns The pointer.
 */
function edgePath(code: EditRule, index: number): string {
  const at = `/edges/${index}`;
  return code === "edge.branch_without_condition" || code === "edge.unexpected_condition" ? `${at}/condition` : at;
}

/**
 * Document order, as the parity file states it: by path, segment by segment, with numeric
 * segments compared as numbers — then by code.
 *
 * @param a One finding.
 * @param b Another.
 * @returns A comparator's answer.
 */
function byPathThenCode(a: StructuralFinding, b: StructuralFinding): number {
  const left = a.path.split("/");
  const right = b.path.split("/");

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const l = left[index];
    const r = right[index];
    if (l === r) continue;
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const numeric = /^\d+$/.test(l) && /^\d+$/.test(r);
    return numeric ? Number(l) - Number(r) : l < r ? -1 : 1;
  }

  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

/* ------------------------------------------------------------------ the whole table */

/**
 * Every § 7 rule a document breaks.
 *
 * The three *when* clauses § 7 states are kept: reachability is asked only with exactly one
 * trigger (with none there is nowhere to start, with two either walk misreports the other's
 * subgraph), and an edge whose endpoint does not resolve gets no further diagnostics.
 *
 * @param definition The document.
 * @returns The findings, in document order; empty for a structurally sound document.
 */
export function structuralFindings(definition: WorkflowDefinition): StructuralFinding[] {
  const nodes = readNodes(definition);
  const edges = readEdges(definition);
  const types = typesById(nodes);
  const findings: StructuralFinding[] = [];

  const triggers = nodes.filter((node) => node.type === "trigger");
  if (triggers.length === 0) findings.push({ code: "document.no_trigger", path: "/nodes" });
  for (const extra of triggers.slice(1)) {
    findings.push({ code: "document.multiple_triggers", path: `/nodes/${extra.index}`, node: extra.id });
  }
  if (!nodes.some((node) => node.type === "term")) findings.push({ code: "document.no_terminal", path: "/nodes" });

  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.id)) findings.push({ code: "node.duplicate_id", path: `/nodes/${node.index}/id`, node: node.id });
    seen.add(node.id);
  }

  const resolved: EdgeFacts[] = [];
  for (const edge of edges) {
    const ref = { from: edge.from, to: edge.to };
    const at = `/edges/${edge.index}`;
    if (!types.has(edge.from)) findings.push({ code: "edge.unknown_from", path: `${at}/from`, edge: ref });
    if (!types.has(edge.to)) findings.push({ code: "edge.unknown_to", path: `${at}/to`, edge: ref });
    if (types.has(edge.from) && types.has(edge.to)) resolved.push(edge);
  }

  resolved.forEach((edge, position) => {
    // A duplicate is the *second* edge of a pair, so only the edges before this one count for it;
    // every other rule is asked of the whole graph without this edge.
    const earlier = resolved.slice(0, position);
    const others = resolved.filter((other) => other !== edge);
    const codes = edgeCodes(edge, types, others).filter(
      (code) => code !== "edge.duplicate" || earlier.some((other) => other.from === edge.from && other.to === edge.to),
    );

    for (const code of codes) {
      findings.push({ code, path: edgePath(code, edge.index), edge: { from: edge.from, to: edge.to } });
    }
  });

  if (triggers.length === 1) {
    const start = triggers[0].id;
    const reached = new Set([start]);
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift();
      for (const edge of resolved) {
        if (edge.from === current && !reached.has(edge.to)) {
          reached.add(edge.to);
          queue.push(edge.to);
        }
      }
    }
    for (const node of nodes) {
      if (!reached.has(node.id)) findings.push({ code: "node.unreachable", path: `/nodes/${node.index}`, node: node.id });
    }
  }

  return findings.sort(byPathThenCode);
}

/* ------------------------------------------------------------------ one edit */

/**
 * The rule an edge would break if the draft held it — a connection being drawn, or an edge's kind
 * and condition being changed in the inspector.
 *
 * @param definition The draft.
 * @param candidate The edge as it would be.
 * @param replacing The edge this one replaces, when an existing edge is being edited, so it is not
 *   judged a duplicate of itself and a loop's upstream walk does not follow the edge being changed.
 *   `null` for a new edge.
 * @returns The first rule broken, in the order {@link edgeCodes} gives, or `null` when the edge is
 *   legal.
 */
export function edgeProblem(
  definition: WorkflowDefinition,
  candidate: EdgeCandidate,
  replacing: EdgeRef | null = null,
): EditRule | null {
  const types = typesById(readNodes(definition));
  if (!types.has(candidate.from)) return "edge.unknown_from";
  if (!types.has(candidate.to)) return "edge.unknown_to";

  const others = readEdges(definition).filter(
    (edge) =>
      types.has(edge.from) &&
      types.has(edge.to) &&
      !(replacing !== null && edge.from === replacing.from && edge.to === replacing.to),
  );

  const codes = edgeCodes(candidate, types, others);
  // A self-reference is the most basic of the mistakes, and is said first even when the pair is
  // also taken.
  if (codes.includes("edge.self_reference")) return "edge.self_reference";

  return codes[0] ?? null;
}

/**
 * The rule adding a stage of this type would break — a second trigger is the only one.
 *
 * @param definition The draft.
 * @param type The node type to add.
 * @returns `document.multiple_triggers`, or `null`.
 */
export function stageProblem(definition: WorkflowDefinition, type: string): EditRule | null {
  return type === "trigger" && readNodes(definition).some((node) => node.type === "trigger")
    ? "document.multiple_triggers"
    : null;
}

/**
 * The rule inserting a stage of this type **between** two stages would break. On top of
 * {@link stageProblem}: an edge would arrive at the inserted stage, which a trigger forbids, and
 * one would leave it, which a terminal forbids.
 *
 * @param definition The draft.
 * @param type The node type to insert.
 * @returns The rule, or `null` when a stage of this type can sit between two others.
 */
export function insertProblem(definition: WorkflowDefinition, type: string): EditRule | null {
  if (type === "trigger") return stageProblem(definition, type) ?? "edge.into_trigger";
  if (type === "term") return "edge.out_of_terminal";
  return null;
}
