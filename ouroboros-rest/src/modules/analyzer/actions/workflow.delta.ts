/**
 * The node/edge deltas a workflow suggestion's binding describes (BV.5,
 * [#514](https://github.com/NobuData/ouroboros/issues/514)) — pure functions from a document to the
 * proposed document, so the preview and the apply compute the same thing from the same base.
 *
 * Two deltas, one per workflow template (`composer.templates.ts`):
 *
 *   * **move** — `{workflow, move, before}`: *"run self-review BEFORE the build stage"*. The moved
 *     stage leaves its place (its one predecessor is joined to its one successor) and is spliced in
 *     front of the target: every edge that entered the target now enters it, and it flows into the
 *     target.
 *   * **path stage** — `{workflow, when_paths, add_stage}`: *"loops touching drivers/can/: add a
 *     'flake-retry under load profile' test stage"*. After the test stage a decision asks the new
 *     `paths` predicate; a change touching the globs runs the new stage, every other change goes on
 *     as before. The new stage has no command: what it runs is the publisher's to fill in.
 *
 * **Stages are named as the analyzer names them**, by label — `self-review`, `build`. A label
 * resolves to the node whose id is the label, else to the one node whose title, slugged, is the
 * label or starts with it (`Self-review diff` → `self-review`). Anything else is not a delta this
 * module will guess at: it answers {@link DeltaRefusal} and the apply refuses with the reason.
 */

import type { WorkflowDocument, WorkflowEdge, WorkflowNode } from "../../workflows/dsl.schema";

/** A delta that cannot be projected onto this document, and why — said to the person. */
export class DeltaRefusal extends Error {}

/** What a delta produced: the proposed document and the sentence that describes the change. */
export interface DeltaResult {
  document: WorkflowDocument;
  /** The concrete change, e.g. *"moves `review` (Self-review diff) before `build` (Build farm)"*. */
  change: string;
}

/**
 * A title as a label — lower-case, words joined by `-`.
 *
 * @param title - A node's title.
 * @returns The slug.
 */
function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The node a stage label names — see the file header.
 *
 * @param document - The document.
 * @param label - The label.
 * @returns The node.
 * @throws {DeltaRefusal} When no node, or more than one, answers to the label.
 */
export function resolveStage(document: WorkflowDocument, label: string): WorkflowNode {
  const wanted = slug(label);
  const byId = document.nodes.find((node) => node.id === label || node.id === wanted);
  if (byId !== undefined) return byId;

  const byTitle = document.nodes.filter((node) => {
    const titled = slug(node.title);
    return titled === wanted || titled.startsWith(`${wanted}-`);
  });
  if (byTitle.length === 1) return byTitle[0];

  throw new DeltaRefusal(
    byTitle.length === 0
      ? `no stage of this workflow is named ${label}`
      : `${String(byTitle.length)} stages of this workflow could be ${label}`,
  );
}

/**
 * How a node reads in a sentence: `` `review` (Self-review diff) ``.
 *
 * @param node - The node.
 * @returns The phrase.
 */
export function stagePhrase(node: WorkflowNode): string {
  return `\`${node.id}\` (${node.title})`;
}

/**
 * A copy of the document, so a delta never edits the base it was handed.
 *
 * @param document - The base.
 * @returns A deep copy.
 */
function copy(document: WorkflowDocument): WorkflowDocument {
  return structuredClone(document);
}

/**
 * Move one stage to run immediately before another.
 *
 * @param base - The base document.
 * @param moveLabel - The stage to move.
 * @param beforeLabel - The stage it will run before.
 * @returns The proposed document and the sentence.
 * @throws {DeltaRefusal} When a label does not resolve, the stage to move is not a simple link of
 *   one chain (exactly one way in and one way out, both plain), or it already runs right before.
 */
export function moveStageBefore(
  base: WorkflowDocument,
  moveLabel: string,
  beforeLabel: string,
): DeltaResult {
  const document = copy(base);
  const moved = resolveStage(document, moveLabel);
  const target = resolveStage(document, beforeLabel);

  if (moved.id === target.id) {
    throw new DeltaRefusal(`${moveLabel} and ${beforeLabel} are the same stage`);
  }

  const into = document.edges.filter((edge) => edge.to === moved.id);
  const out = document.edges.filter((edge) => edge.from === moved.id);
  if (into.length !== 1 || out.length !== 1 || out[0].kind !== "default") {
    throw new DeltaRefusal(
      `${stagePhrase(moved)} is not one link of a chain (it has ${String(into.length)} way(s) in ` +
        `and ${String(out.length)} way(s) out), so moving it would change more than its order`,
    );
  }
  if (out[0].to === target.id) {
    throw new DeltaRefusal(
      `${stagePhrase(moved)} already runs right before ${stagePhrase(target)}`,
    );
  }

  // Lift the stage out: its predecessor's edge now goes where the stage went.
  const [inEdge] = into;
  const [outEdge] = out;
  const rest = document.edges.filter((edge) => edge !== inEdge && edge !== outEdge);
  const bridged: WorkflowEdge = { ...inEdge, to: outEdge.to };

  // Splice it in front of the target: whatever entered the target enters it, and it flows on.
  const edges: WorkflowEdge[] = [...rest, bridged].map((edge) =>
    edge.to === target.id ? { ...edge, to: moved.id } : edge,
  );
  edges.push({ from: moved.id, to: target.id, kind: "default" });

  moved.position = { x: target.position.x, y: target.position.y - 140 };
  document.edges = edges;

  return {
    document,
    change: `moves ${stagePhrase(moved)} to run before ${stagePhrase(target)}`,
  };
}

/**
 * A node id not yet used in the document.
 *
 * @param document - The document.
 * @param wanted - The id wanted.
 * @returns `wanted`, or `wanted-2`, `wanted-3`, …
 */
function freeId(document: WorkflowDocument, wanted: string): string {
  const base = slug(wanted).slice(0, 56) || "stage";
  const taken = new Set(document.nodes.map((node) => node.id));
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${String(suffix)}`)) suffix += 1;
  return `${base}-${String(suffix)}`;
}

/**
 * The test stage a path stage follows: the node labelled `test`, else the last infra node in edge
 * order that names a test.
 *
 * @param document - The document.
 * @returns The anchor.
 * @throws {DeltaRefusal} When there is no test stage to follow.
 */
function testStage(document: WorkflowDocument): WorkflowNode {
  const exact = document.nodes.find((node) => node.id === "test");
  if (exact !== undefined) return exact;
  const tests = document.nodes.filter(
    (node) => node.type === "infra" && /test/i.test(`${node.id} ${node.title}`),
  );
  if (tests.length === 1) return tests[0];
  throw new DeltaRefusal("this workflow has no single test stage to add a stage after");
}

/**
 * Add a stage that runs only for changes touching some paths, right after the test stage.
 *
 * @param base - The base document.
 * @param globs - The paths, as globs — `drivers/can/**`.
 * @param stageTitle - The new stage's title — `flake-retry under load profile`.
 * @returns The proposed document and the sentence.
 * @throws {DeltaRefusal} When there is no single test stage, or it does not flow on by exactly one
 *   plain edge.
 */
export function addPathStage(
  base: WorkflowDocument,
  globs: readonly string[],
  stageTitle: string,
): DeltaResult {
  const document = copy(base);
  const anchor = testStage(document);
  const out = document.edges.filter((edge) => edge.from === anchor.id);
  if (out.length !== 1 || out[0].kind !== "default") {
    throw new DeltaRefusal(
      `${stagePhrase(anchor)} does not flow on by exactly one plain edge, so there is no single place to branch`,
    );
  }
  const next = out[0].to;
  const shown = globs.join(", ");
  const decisionId = freeId(document, `touches-${globs[0].replace(/\/?\*.*$/, "")}`);
  const stageId = freeId(document, stageTitle);
  const touched = [...globs];

  document.nodes.push(
    {
      id: decisionId,
      type: "flow",
      title: `Touches ${shown}?`.slice(0, 80),
      position: { x: anchor.position.x + 240, y: anchor.position.y + 140 },
      config: { kind: "decision", predicate: { kind: "paths", op: "any", globs: touched } },
    },
    {
      id: stageId,
      type: "infra",
      title: stageTitle.slice(0, 80),
      description:
        `Runs only for changes touching ${shown}. Proposed by the Build Analyzer — set its ` +
        "runner pool and command before publishing.",
      position: { x: anchor.position.x + 480, y: anchor.position.y + 140 },
      config: {},
    },
  );
  document.edges = [
    ...document.edges.filter((edge) => edge !== out[0]),
    { from: anchor.id, to: decisionId, kind: "default" },
    {
      from: decisionId,
      to: stageId,
      kind: "branch",
      label: "touches paths",
      condition: { kind: "paths", op: "any", globs: touched },
    },
    {
      from: decisionId,
      to: next,
      kind: "branch",
      label: "elsewhere",
      condition: { kind: "paths", op: "none", globs: touched },
    },
    { from: stageId, to: next, kind: "default" },
  ];

  return {
    document,
    change:
      `adds stage \`${stageId}\` (${stageTitle}) after ${stagePhrase(anchor)}, run only when a ` +
      `change touches ${shown}`,
  };
}
