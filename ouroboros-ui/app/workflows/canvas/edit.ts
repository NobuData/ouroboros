/**
 * The canvas's edits, as pure functions over the document (S.5,
 * [#151](https://github.com/NobuData/ouroboros/issues/151)).
 *
 * `graph.ts` projects the P.2 document into React Flow and writes positions, an Apply and a
 * **Delete stage** back into it. This module is the rest of what a builder does to a graph: a stage
 * added from the catalog, a connection drawn, an edge's kind, label and condition changed, a stage
 * inserted into an edge, and several things deleted at once. Each takes the document and hands back
 * a new one, leaving the input untouched — which is what lets the studio's undo history
 * (`app/workflows/history.ts`) be a list of documents rather than a list of inverse operations.
 *
 * **No rule is checked here.** Whether an edit is legal is `rules.ts`'s question, asked by the caller
 * before the edit is made, so an illegal one is refused with its reason rather than applied and
 * reported. What this module guarantees is the other half: an edit it makes to a legal graph
 * introduces no § 7 violation of its own (`edit.test.ts` asserts it for insertion on every seeded
 * edge).
 *
 * **React-free**, as `graph.ts` is.
 */

import type { WorkflowDefinition, WorkflowStageType } from "@/app/api/workflows";

import { type EdgeRef, type Point, readPoint, readStages, withoutStage } from "./graph";
import type { DeletionSummary } from "./view";

/* ------------------------------------------------------------------ the document's skeleton */

/** The DSL minor a document the canvas starts is written against (`v1.json`'s one `dsl_version`). */
export const DSL_VERSION = "1.0";

/** The schema's bounds on a coordinate (`v1.json`, `position.x` and `.y`). */
const COORDINATE_LIMIT = 100_000;

/** How far a dropped stage is nudged, down and right, off a stage already at the spot. */
export const DROP_STEP = 24;

/** The DSL's node id: a slug of one to sixty-four characters (`v1.json`, `node_id`). */
export const NODE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** The longest node id the pattern allows. */
const NODE_ID_MAX = 64;

/**
 * The trigger a document gets when its first trigger stage is added and it has none: the one event
 * the DSL defines, with no conditions — a trigger that fires on every queued ticket, which § 3 calls
 * *a thing an author may legitimately mean*, and which the page head describes as such.
 *
 * @returns A fresh object, so no two documents share one.
 */
export function startingTrigger(): Record<string, unknown> {
  return { event: "ticket_queued", conditions: {} };
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
 * The document with the four root fields a graph needs, in the schema's order.
 *
 * A blank draft is `{}` (`app/workflows/view.ts`'s `BLANK_DEFINITION`), so the first edit on one is
 * also the edit that makes it a document: `dsl_version` is written, `nodes` and `edges` become
 * lists, and — when the edit adds a trigger stage — the root `trigger` the stage stands for. Values
 * already present are kept, whatever they are; repairing them is the inspector's and the publish
 * gate's business, not an edit's.
 *
 * @param definition The document.
 * @param withTrigger Whether a root trigger is needed.
 * @returns The document, with its lists as arrays.
 */
function skeleton(
  definition: WorkflowDefinition,
  withTrigger: boolean,
): WorkflowDefinition & { nodes: unknown[]; edges: unknown[] } {
  const { dsl_version: version, trigger, nodes, edges, ...rest } = definition;
  const needsTrigger = withTrigger && !isRecord(trigger);

  return {
    dsl_version: version ?? DSL_VERSION,
    ...(needsTrigger ? { trigger: startingTrigger() } : trigger === undefined ? {} : { trigger }),
    nodes: Array.isArray(nodes) ? nodes : [],
    edges: Array.isArray(edges) ? edges : [],
    ...rest,
  };
}

/* ------------------------------------------------------------------ adding a stage */

/** What a dropped stage starts as — the catalog's `defaults` for a node type, with the type. */
export interface StageTemplate {
  /** The node type. */
  readonly type: string;
  /** Its starting title. */
  readonly title: string;
  /** Its starting config. Copied into the document, never shared with it. */
  readonly config: Readonly<Record<string, unknown>>;
}

/**
 * The template the catalog serves for a node type — its `defaults`, with the type.
 *
 * @param type One of the catalog's node types.
 * @returns What a stage of that type starts as.
 */
export function stageTemplate(type: WorkflowStageType): StageTemplate {
  return { type: type.type, title: type.defaults.title, config: type.defaults.config };
}

/**
 * A text as a node id: lower case, runs of anything else as one hyphen, no hyphen at either end,
 * and no longer than an id may be.
 *
 * @param text A title, a type.
 * @returns The slug; `""` when nothing in the text is a letter or a digit.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, NODE_ID_MAX)
    .replace(/^-+|-+$/g, "");
}

/**
 * An id for a new stage, unique in the document.
 *
 * Read from the title the stage starts with, because an id is what a prompt template quotes
 * (`{{model-stage}}`) and a run journal records, so it should read as something; numbered from two
 * when the title's slug is taken, the way a second copy of a file is.
 *
 * @param definition The document.
 * @param title The stage's title.
 * @param type Its type — the slug when the title has none.
 * @returns An id matching {@link NODE_ID_PATTERN} that no node in the document carries.
 */
export function freshStageId(definition: WorkflowDefinition, title: string, type: string): string {
  const { nodes } = definition;
  const taken = new Set(
    (Array.isArray(nodes) ? nodes : []).flatMap((node: unknown) =>
      isRecord(node) && typeof node.id === "string" ? [node.id] : [],
    ),
  );
  const base = slugify(title) || slugify(type) || "stage";
  if (!taken.has(base)) return base;

  for (let ordinal = 2; ; ordinal += 1) {
    const suffix = `-${ordinal}`;
    const candidate = `${base.slice(0, NODE_ID_MAX - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * A point as the document stores one: whole pixels, inside the schema's bounds.
 *
 * @param point Any point.
 * @returns The point, rounded and clamped.
 */
function stored(point: Point): Point {
  const clamp = (value: number) => Math.min(COORDINATE_LIMIT, Math.max(-COORDINATE_LIMIT, Math.round(value)));
  return { x: clamp(point.x), y: clamp(point.y) };
}

/**
 * Where a stage dropped at a point lands: the point itself, or — when a stage already has its
 * top-left corner there — nudged down and right until none does, so a second stage added without
 * moving the viewport is not hidden exactly under the first.
 *
 * @param definition The document.
 * @param at Where the stage was dropped.
 * @returns The point it lands on, in whole pixels.
 */
export function freePosition(definition: WorkflowDefinition, at: Point): Point {
  const taken = new Set(readStages(definition).map(({ position }) => `${position.x},${position.y}`));
  let point = stored(at);

  while (taken.has(`${point.x},${point.y}`) && point.x < COORDINATE_LIMIT && point.y < COORDINATE_LIMIT) {
    point = stored({ x: point.x + DROP_STEP, y: point.y + DROP_STEP });
  }

  return point;
}

/** A document with a stage added, and the id the stage was given. */
export interface AddedStage {
  readonly definition: WorkflowDefinition;
  readonly id: string;
}

/**
 * The document with a stage added — **Add stage ▾**.
 *
 * @param definition The document.
 * @param template The stage's type and starting title and config, as the catalog serves them.
 * @param at Where its top-left corner goes. Stored as given (rounded); {@link freePosition} is the
 *   caller's to apply first.
 * @returns The new document and the stage's id. The stage is appended to `nodes`.
 */
export function withAddedStage(definition: WorkflowDefinition, template: StageTemplate, at: Point): AddedStage {
  const id = freshStageId(definition, template.title, template.type);
  const base = skeleton(definition, template.type === "trigger");
  const node = {
    id,
    type: template.type,
    title: template.title === "" ? template.type : template.title,
    position: stored(at),
    config: structuredClone(template.config) as Record<string, unknown>,
  };

  return { definition: { ...base, nodes: [...base.nodes, node] }, id };
}

/* ------------------------------------------------------------------ edges */

/** What an edge carries beyond its endpoints. */
export interface EdgeFields {
  /** `default`, `branch` or `loop`. */
  readonly kind: string;
  /** What it prints, or `null` for nothing. An empty label is stored as none, as the DSL means. */
  readonly label: string | null;
  /** The predicate that selects it, or `undefined` for none. */
  readonly condition?: unknown;
}

/**
 * Whether a document entry is the edge a pair names.
 *
 * @param entry An entry of `edges`.
 * @param ref The pair.
 * @returns `true` for an object joining exactly that ordered pair.
 */
function isEdge(entry: unknown, ref: EdgeRef): entry is Record<string, unknown> {
  return isRecord(entry) && entry.from === ref.from && entry.to === ref.to;
}

/**
 * One edge as the document stores it: its endpoints and kind, and a label and condition only when
 * it has them — an absent optional field is *none* in the DSL, and `"label": ""` would be refused.
 *
 * @param ref Its endpoints.
 * @param fields What it carries.
 * @returns The entry.
 */
function edgeEntry(ref: EdgeRef, fields: EdgeFields): Record<string, unknown> {
  const label = fields.label?.trim() ?? "";

  return {
    from: ref.from,
    to: ref.to,
    kind: fields.kind,
    ...(label === "" ? {} : { label }),
    ...(fields.condition === undefined ? {} : { condition: fields.condition }),
  };
}

/**
 * The document with a connection added — a drag from one stage to another, or **Connect** in the
 * inspector.
 *
 * @param definition The document.
 * @param ref The two stages, source first.
 * @param fields What the edge carries.
 * @returns The new document, the edge appended to `edges`.
 */
export function withConnection(definition: WorkflowDefinition, ref: EdgeRef, fields: EdgeFields): WorkflowDefinition {
  const base = skeleton(definition, false);
  return { ...base, edges: [...base.edges, edgeEntry(ref, fields)] };
}

/**
 * The document with one edge's kind, label and condition replaced — the edge inspector's **Apply**.
 *
 * @param definition The document.
 * @param ref The edge.
 * @param fields What it carries now.
 * @returns The new document, or `definition` itself when no edge joins that pair.
 */
export function withConnectionFields(
  definition: WorkflowDefinition,
  ref: EdgeRef,
  fields: EdgeFields,
): WorkflowDefinition {
  const { edges } = definition;
  if (!Array.isArray(edges) || !edges.some((entry: unknown) => isEdge(entry, ref))) return definition;

  let replaced = false;
  const next = edges.map((entry: unknown) => {
    if (replaced || !isEdge(entry, ref)) return entry;
    replaced = true;
    return edgeEntry(ref, fields);
  });

  return { ...definition, edges: next };
}

/**
 * The document without one edge — **Delete edge**.
 *
 * @param definition The document.
 * @param ref The edge.
 * @returns The new document, or `definition` itself when no edge joins that pair.
 */
export function withoutConnection(definition: WorkflowDefinition, ref: EdgeRef): WorkflowDefinition {
  const { edges } = definition;
  if (!Array.isArray(edges)) return definition;

  const kept = edges.filter((entry: unknown) => !isEdge(entry, ref));
  return kept.length === edges.length ? definition : { ...definition, edges: kept };
}

/**
 * The document with a stage inserted into an edge — a double-click on the edge, or **Insert stage**
 * in the edge inspector.
 *
 * The edge `A → B` becomes `A → new` and `new → B`, in the old edge's place. The **first** hop keeps
 * everything the old edge carried — its kind, its label, its condition — because those describe how
 * a run leaves `A` (a gate's *fail ↺* is still the gate's failure); the second is a plain `default`,
 * because the new stage has no outcomes of its own yet. A loop stays legal: the new stage reaches
 * `A` through `B`, which the old loop's own legality says is upstream of `A`.
 *
 * @param definition The document.
 * @param ref The edge to insert into.
 * @param template The stage to insert.
 * @returns The new document and the stage's id, or `null` when no edge joins that pair. The stage is
 *   placed halfway between the two stages' corners, nudged off any stage already there.
 */
export function withInsertedStage(
  definition: WorkflowDefinition,
  ref: EdgeRef,
  template: StageTemplate,
): AddedStage | null {
  const { edges } = definition;
  const index = Array.isArray(edges) ? edges.findIndex((entry: unknown) => isEdge(entry, ref)) : -1;
  if (index < 0) return null;

  const positions = new Map(readStages(definition).map((stage) => [stage.id, stage.position]));
  const from = positions.get(ref.from) ?? readPoint(null);
  const to = positions.get(ref.to) ?? readPoint(null);
  const at = freePosition(definition, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });

  const added = withAddedStage(definition, template, at);
  const nextEdges = [...(added.definition.edges as unknown[])];
  const original = nextEdges[index] as Record<string, unknown>;
  nextEdges.splice(index, 1, { ...original, to: added.id }, { from: added.id, to: ref.to, kind: "default" });

  return { definition: { ...added.definition, edges: nextEdges }, id: added.id };
}

/* ------------------------------------------------------------------ deleting */

/** What a delete removes: stages by id, edges by their pairs. */
export interface Deletion {
  readonly stages: readonly string[];
  readonly edges: readonly EdgeRef[];
}

/**
 * The document without a selection — the Delete key over the canvas, once confirmed.
 *
 * Each stage goes with every edge that leaves or arrives at it (`graph.ts`'s `withoutStage`), so
 * nothing is left naming a stage that is gone.
 *
 * @param definition The document.
 * @param deletion What to remove.
 * @returns The new document, or `definition` itself when nothing named is in it.
 */
export function withoutItems(definition: WorkflowDefinition, deletion: Deletion): WorkflowDefinition {
  let next = definition;
  for (const ref of deletion.edges) next = withoutConnection(next, ref);
  for (const id of deletion.stages) next = withoutStage(next, id);
  return next;
}

/**
 * What a delete would remove, in the words its confirmation uses (`view.ts`'s `deletePrompt`).
 *
 * @param definition The document.
 * @param deletion What is to be removed.
 * @returns The titles of the named stages the document holds, the named edges it holds as
 *   `from → to` in titles, and how many further edges go because they touch a named stage.
 */
export function deletionSummary(definition: WorkflowDefinition, deletion: Deletion): DeletionSummary {
  const titles = new Map(readStages(definition).map((stage) => [stage.id, stage.title]));
  const doomed = new Set(deletion.stages.filter((id) => titles.has(id)));
  const edges = Array.isArray(definition.edges)
    ? definition.edges.filter(
        (entry: unknown): entry is { from: string; to: string } =>
          isRecord(entry) && typeof entry.from === "string" && typeof entry.to === "string",
      )
    : [];
  const named = deletion.edges.filter((ref) => edges.some((edge) => edge.from === ref.from && edge.to === ref.to));
  const isNamed = (edge: EdgeRef) => named.some((ref) => ref.from === edge.from && ref.to === edge.to);

  return {
    stages: [...doomed].map((id) => titles.get(id) ?? id),
    edges: named.map((ref) => `${titles.get(ref.from) ?? ref.from} → ${titles.get(ref.to) ?? ref.to}`),
    attached: edges.filter((edge) => !isNamed(edge) && (doomed.has(edge.from) || doomed.has(edge.to))).length,
  };
}
