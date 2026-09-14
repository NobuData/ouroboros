/**
 * The printer: a canonical workflow document as mockup 05's TypeScript — U.1
 * ([#165](https://github.com/NobuData/ouroboros/issues/165)).
 *
 * ```ts
 * const { text, spans } = printWorkflowCode("standard-fix", document);
 * // text:  "import { defineLoop, effort, … } from \"@ouroboros/sdk\";\n\nexport default defineLoop(…"
 * // spans: [{ node: "issue-queued", startLine: 10, endLine: 14 }, …]
 * ```
 *
 * The language is [`docs/WORKFLOW_CODE_DSL.md`](../../../../docs/WORKFLOW_CODE_DSL.md), and the
 * two properties the issue asks of this file are the two it is built around:
 *
 * * **Deterministic.** The output is a function of the slug and the document's *values* — never
 *   of the order an object's keys happened to arrive in, the clock, or the environment. Every
 *   key is read by name and written in the order `STAGE_OPTIONS` fixes, so the same document
 *   prints the same bytes every time.
 * * **Lossless.** Every value in the document has exactly one place in the output: the stage
 *   calls carry what the workflow *does*, and the layout block (`code.layout.ts`) carries where
 *   the canvas draws it. `code.printer.spec.ts` recovers the graph from printed text with the
 *   TypeScript compiler and holds it to the document.
 *
 * **Why a string emitter rather than `ts.createPrinter`.** The compiler's printer was tried
 * first and cannot produce this format: it indents by four spaces, rewrites every non-ASCII
 * character of `≤ M ↓` as a six-character Unicode escape, and places a synthetic trailing
 * comment *before* the comma that follows it, which is not even valid TypeScript. So the
 * compiler is used as the **checker** instead — every
 * print in the suite is re-scanned with `ts.createSourceFile` and must produce no diagnostic —
 * and the formatting is this file's, where it can be read.
 *
 * **The input is a validated document**, as it is for `toWorkflowYaml`. A draft is not
 * validated (it is saved as the canvas holds it), and a document with a model stage that
 * names two routes has no honest spelling; such a document is refused with
 * {@link WorkflowCodePrintError} rather than printed as something it is not. What the code
 * view shows for a draft in that state is #167's to decide.
 */

import {
  DEFINE_LOOP,
  EDGE_OPTIONS,
  FLOW_CALLEES,
  INDENT,
  LOOP_COMMENT,
  PERMISSION_KEYS,
  ROUND_TRIP_COMMENT,
  ROUTE_METHODS,
  SDK_IMPORTS,
  SDK_MODULE,
  STAGE_OPTIONS,
  TERM_CALLEES,
  TRIGGER_EVENTS,
  type SdkImport,
  type StageCallee,
} from "./code.grammar";
import { printLayout } from "./code.layout";
import { quoteString, stringArray, templateLiteral, tokenBudgetLiteral } from "./code.literals";
import { printPredicate, printTriggerWhen, usesEffort } from "./code.predicates";
import type {
  LlmConfig,
  Predicate,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
} from "./dsl.schema";
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from "./slug";

/** Where one node's stage call sits in the printed text. */
export interface NodeSpan {
  /** The node id. */
  node: string;
  /** The 1-based line the call opens on — `llm("implement", {`. */
  startLine: number;
  /** The 1-based line it closes on — `}),` — inclusive. */
  endLine: number;
}

/** What the printer produces. */
export interface PrintedWorkflowCode {
  /** The file, ending in a line feed. */
  text: string;
  /**
   * One span per node, in the document's node order — the node→span map W.2 (#178) maps
   * node-anchored diagnostics through. An array rather than an object keyed by id, because a
   * node may legitimately be called `constructor`.
   */
  spans: NodeSpan[];
}

/** A document, or a slug, that the grammar has no spelling for. */
export class WorkflowCodePrintError extends Error {
  /**
   * @param message - What could not be printed, and why.
   */
  constructor(message: string) {
    super(message);
    this.name = "WorkflowCodePrintError";
  }
}

/** One stage option's rendering: the text after `key: `, possibly over several lines. */
type OptionValue = string[];

/** Indentation of a stage call's own lines. */
const STAGE_INDENT = INDENT.repeat(2);
/** Indentation of a stage option's key. */
const OPTION_INDENT = INDENT.repeat(3);
/** Indentation of an entry inside a multi-line option array. */
const ENTRY_INDENT = INDENT.repeat(4);

/**
 * Print a workflow as TypeScript.
 *
 * @param slug - The workflow's slug. The document does not carry it — it names the entity, not
 *   the definition — and it is the first argument of `defineLoop`.
 * @param document - A document the validator accepted.
 * @returns The file and the node→span map.
 * @throws {WorkflowCodePrintError} When the slug is not a workflow slug, or the document breaks
 *   an invariant validation guarantees (a model stage with two routes, a branch edge with no
 *   condition, an edge leaving a node the document does not have, …).
 */
export function printWorkflowCode(slug: string, document: WorkflowDocument): PrintedWorkflowCode {
  if (!SLUG_PATTERN.test(slug) || slug.length > SLUG_MAX_LENGTH) {
    throw new WorkflowCodePrintError(`${JSON.stringify(slug)} is not a workflow slug`);
  }

  const lines: string[] = [
    `import { ${importsFor(document).join(", ")} } from ${quoteString(SDK_MODULE)};`,
    "",
    `export default ${DEFINE_LOOP}(${quoteString(slug)}, {`,
    `${INDENT}dsl: ${quoteString(document.dsl_version)},`,
    ...triggerLines(document),
    `${INDENT}stages: [`,
  ];

  const spans: NodeSpan[] = [];
  let printedEdges = 0;

  for (const node of document.nodes) {
    const outgoing = document.edges.filter((edge) => edge.from === node.id);
    const stage = stageLines(node, outgoing);

    spans.push({
      node: node.id,
      startLine: lines.length + 1,
      endLine: lines.length + stage.length,
    });
    lines.push(...stage);
    printedEdges += outgoing.length;
  }

  if (printedEdges !== document.edges.length) {
    throw new WorkflowCodePrintError(
      `${document.edges.length - printedEdges} edge(s) leave a node the document does not have`,
    );
  }

  lines.push(`${INDENT}],`, "});", "", ...ROUND_TRIP_COMMENT, "", ...printLayout(document));

  return { text: `${lines.join("\n")}\n`, spans };
}

/**
 * The names the header imports: exactly those the file uses, in `SDK_IMPORTS`' order.
 *
 * @param document - The document.
 * @returns The names.
 */
function importsFor(document: WorkflowDocument): SdkImport[] {
  const used = new Set<SdkImport>([DEFINE_LOOP]);

  if (document.trigger.conditions.effort_lte !== undefined) used.add("effort");

  for (const node of document.nodes) {
    used.add(calleeFor(node));
    if (node.type === "llm") used.add("route");
    if (node.type === "flow" && usesEffort(node.config.predicate)) used.add("effort");
  }

  if (document.edges.some((edge) => usesEffort(edge.condition))) used.add("effort");

  return SDK_IMPORTS.filter((name) => used.has(name));
}

/**
 * The `trigger: {…}` entry of `defineLoop`'s options.
 *
 * @param document - The document.
 * @returns Its lines.
 */
function triggerLines(document: WorkflowDocument): string[] {
  const when = printTriggerWhen(document.trigger.conditions);

  return [
    `${INDENT}trigger: {`,
    `${INDENT}${INDENT}on: ${quoteString(TRIGGER_EVENTS[document.trigger.event])},`,
    ...(when === undefined ? [] : [`${INDENT}${INDENT}when: ${when},`]),
    `${INDENT}},`,
  ];
}

/**
 * Which stage call a node is written as.
 *
 * @param node - The node.
 * @returns Its callee.
 */
export function calleeFor(node: WorkflowNode): StageCallee {
  switch (node.type) {
    case "trigger":
    case "llm":
    case "infra":
      return node.type;
    case "flow":
      return FLOW_CALLEES[node.config.kind];
    case "term":
      return TERM_CALLEES[node.config.action];
  }
}

/**
 * One node's stage call, from its opening line to its closing `}),`.
 *
 * @param node - The node.
 * @param outgoing - Every edge leaving it, in document order.
 * @returns The call's lines.
 */
function stageLines(node: WorkflowNode, outgoing: WorkflowEdge[]): string[] {
  const callee = calleeFor(node);
  const options = new Map<string, OptionValue>([["title", [quoteString(node.title)]]]);

  if (node.description !== undefined) options.set("description", [quoteString(node.description)]);
  configOptions(node, options);
  edgeOptions(node.id, outgoing, options);

  const order: readonly string[] = STAGE_OPTIONS[callee];
  for (const key of options.keys()) {
    if (!order.includes(key)) {
      throw new WorkflowCodePrintError(`${callee}(${JSON.stringify(node.id)}) cannot carry ${key}`);
    }
  }

  const lines = [`${STAGE_INDENT}${callee}(${quoteString(node.id)}, {`];

  for (const key of order) {
    const value = options.get(key);
    if (value === undefined) continue;

    // The first line joins its key; every later line is already indented (an array's entries)
    // or must not be (a template literal's continuation). The option's comma goes on its last.
    const rendered = [`${OPTION_INDENT}${key}: ${value[0]}`, ...value.slice(1)];
    rendered[rendered.length - 1] += ",";
    lines.push(...rendered);
  }

  const loops = outgoing.some((edge) => edge.kind === "loop");
  lines.push(`${STAGE_INDENT}}),${loops ? ` ${LOOP_COMMENT}` : ""}`);

  return lines;
}

/**
 * Add a node's type-dependent options.
 *
 * @param node - The node.
 * @param options - The stage's options so far, added to in place.
 */
function configOptions(node: WorkflowNode, options: Map<string, OptionValue>): void {
  switch (node.type) {
    case "trigger":
      return;
    case "llm":
      llmOptions(node.id, node.config, options);
      return;
    case "infra":
      if (node.config.runner_pool !== undefined) {
        options.set("farm", [quoteString(node.config.runner_pool)]);
      }
      if (node.config.command !== undefined) options.set("cmd", [quoteString(node.config.command)]);
      return;
    case "flow":
      if (isRequirement(node.config.predicate)) {
        options.set("require", [stringArray(node.config.predicate.names)]);
      } else {
        options.set("when", [printPredicate(node.config.predicate)]);
      }
      return;
    case "term":
      if (node.config.action === "open_pr_automerge") {
        options.set("merge", [quoteString(node.config.options.merge_method)]);
        options.set("deleteBranch", [String(node.config.options.delete_branch)]);
      }
      return;
  }
}

/**
 * Add a model stage's options.
 *
 * `mode` is not written: it is `skill` exactly when a skill is, which validation guarantees in
 * both directions (`config.skill_required`, `config.skill_not_allowed`).
 *
 * @param id - The node id, for the error.
 * @param config - The stage's config.
 * @param options - The stage's options so far, added to in place.
 * @throws {WorkflowCodePrintError} When the mode and the skill disagree, or routing names
 *   neither or both of a task and a model.
 */
function llmOptions(id: string, config: LlmConfig, options: Map<string, OptionValue>): void {
  if ((config.mode === "skill") !== (config.skill !== undefined)) {
    throw new WorkflowCodePrintError(
      `Model stage ${JSON.stringify(id)} is in ${config.mode} mode ${config.skill === undefined ? "without" : "with"} a skill`,
    );
  }

  const { inherit_task: task, pinned_model: model } = config.routing;
  if ((task === undefined) === (model === undefined)) {
    throw new WorkflowCodePrintError(
      `Model stage ${JSON.stringify(id)} must route by exactly one of a task or an alias`,
    );
  }

  const route =
    task === undefined
      ? `route.${ROUTE_METHODS.pinned_model}(${quoteString((model as { alias: string }).alias)})`
      : `route.${ROUTE_METHODS.inherit_task}(${quoteString(task)})`;
  const permissions = Object.entries(PERMISSION_KEYS)
    .map(
      ([key, name]) =>
        `${name}: ${String(config.permissions[key as keyof typeof PERMISSION_KEYS])}`,
    )
    .join(", ");

  if (config.skill !== undefined) options.set("skill", [quoteString(config.skill)]);
  options.set("model", [route]);
  options.set("retries", [String(config.limits.max_retries)]);
  options.set("tokenBudget", [tokenBudgetLiteral(config.limits.token_budget)]);
  options.set("permissions", [`{ ${permissions} }`]);
  options.set("prompt", templateLiteral(config.prompt_template).split("\n"));
}

/**
 * Add a node's outgoing edges: `next`, `branches` and `onFail`.
 *
 * @param id - The node id, for the error.
 * @param outgoing - Every edge leaving it, in document order.
 * @param options - The stage's options so far, added to in place.
 * @throws {WorkflowCodePrintError} When a branch edge carries no condition or a default edge
 *   carries one — neither has a spelling.
 */
function edgeOptions(
  id: string,
  outgoing: WorkflowEdge[],
  options: Map<string, OptionValue>,
): void {
  const defaults = outgoing.filter((edge) => edge.kind === "default");
  const branches = outgoing.filter((edge) => edge.kind === "branch");
  const loops = outgoing.filter((edge) => edge.kind === "loop");

  if (defaults.some((edge) => edge.condition !== undefined)) {
    throw new WorkflowCodePrintError(
      `A default edge from ${JSON.stringify(id)} carries a condition`,
    );
  }

  if (defaults.length === 1) options.set(EDGE_OPTIONS.default, [quoteString(defaults[0].to)]);
  if (defaults.length > 1) {
    options.set(EDGE_OPTIONS.default, [stringArray(defaults.map((edge) => edge.to))]);
  }

  if (branches.length > 0) {
    options.set(
      EDGE_OPTIONS.branch,
      entryList(
        branches.map((edge) => {
          if (edge.condition === undefined) {
            throw new WorkflowCodePrintError(
              `The branch edge ${id} → ${edge.to} carries no condition`,
            );
          }
          return edgeEntry(edge.to, edge.condition);
        }),
      ),
    );
  }

  if (loops.length === 1 && isBareFailure(loops[0].condition)) {
    options.set(EDGE_OPTIONS.loop, [quoteString(loops[0].to)]);
  } else if (loops.length > 0) {
    options.set(
      EDGE_OPTIONS.loop,
      entryList(loops.map((edge) => edgeEntry(edge.to, edge.condition))),
    );
  }
}

/**
 * One `{ to: "…", when: … }` entry of a `branches` or `onFail` list.
 *
 * @param to - The target node id.
 * @param condition - The edge's condition, when it has one.
 * @returns The entry, on one line.
 */
function edgeEntry(to: string, condition: Predicate | undefined): string {
  const when = condition === undefined ? "" : `, when: ${printPredicate(condition)}`;
  return `{ to: ${quoteString(to)}${when} }`;
}

/**
 * A multi-line array of one-line entries.
 *
 * @param entries - The entries.
 * @returns The value's lines: `[`, one indented line per entry, and the closing `]`.
 */
function entryList(entries: string[]): OptionValue {
  return ["[", ...entries.map((entry) => `${ENTRY_INDENT}${entry},`), `${OPTION_INDENT}]`];
}

/**
 * Whether a flow predicate is written `require: [...]` rather than `when: …`.
 *
 * @param predicate - The predicate.
 * @returns `true` for *all of these named checks passed* — mockup 05's gate.
 */
function isRequirement(
  predicate: Predicate,
): predicate is Extract<Predicate, { kind: "checks" }> & { names: string[] } {
  return (
    predicate.kind === "checks" && predicate.op === "all_passed" && predicate.names !== undefined
  );
}

/**
 * Whether a loop edge's condition is the one `onFail: "…"` stands for.
 *
 * @param condition - The condition, or `undefined` for an unconditioned loop.
 * @returns `true` for *any check failed*, with no names.
 */
function isBareFailure(condition: Predicate | undefined): boolean {
  return (
    condition?.kind === "checks" && condition.op === "any_failed" && condition.names === undefined
  );
}
