/**
 * Stage calls, read back into nodes and the edges they declare — U.2
 * ([#166](https://github.com/NobuData/ouroboros/issues/166)).
 *
 * One stage call is one node. Its callee names the node's type (`STAGE_CALLEES`), its first
 * argument is the node id, and its options are `STAGE_OPTIONS[callee]` read backwards: `farm` into
 * `runner_pool`, `tokenBudget` into `limits.token_budget`, `require` into a `checks all_passed`
 * predicate, and `next` / `branches` / `onFail` into the edges that leave it.
 *
 * **What a stage call must get right is its shape.** A callee the grammar does not have, an option
 * key its callee does not take, a key written twice, or a value spelled as the wrong kind of
 * literal is `code_out_of_grammar`. **What it may leave to the validator is everything else.** A
 * missing `title`, a model stage with no `model`, a branch with no `when`, `retries: 99`, or
 * `merge: "fast-forward"` all read into the document as written, and `validateWorkflowDocument`
 * reports them against it with the same codes the canvas gets.
 *
 * **Accepted and normalised**, because each spells the same document as the canonical form:
 * options in any order, `next: ["a"]` for `next: "a"`, `onFail: [{ to: "a", when: (i) =>
 * i.checks.anyFailed() }]` for `onFail: "a"`, `when: (i) => i.checks.allPassed([…])` for
 * `require: […]`, and a prompt written as a quoted string rather than a template literal.
 */

import ts from "typescript";

import {
  EDGE_ENTRY_OPTIONS,
  EDGE_OPTIONS,
  FLOW_CALLEES,
  PERMISSION_KEYS,
  ROUTE_METHODS,
  STAGE_CALLEES,
  STAGE_OPTIONS,
  TERM_CALLEES,
  type StageCallee,
} from "./code.grammar";
import { readPredicate, type ReadValue } from "./code.parser.predicates";
import { type CodeReader, code, compact, list, unwrap } from "./code.reader";
import type { EdgeKind, NodeType } from "./dsl.schema";

/** One edge a stage call declares, before the layout block gives it a label and a place. */
export interface DeclaredEdge {
  /** The declaring stage's id. */
  from: string;
  /** The target id, when the entry names one. */
  to?: string;
  /** Which option declared it. */
  kind: EdgeKind;
  /** Its condition, when it has one. */
  condition?: ReadValue;
}

/** One stage call, read. */
export interface ReadStage {
  /** The node id. */
  id: string;
  /** The id argument, which an error about the whole stage is anchored to. */
  idNode: ts.Expression;
  /** The node type the callee names. */
  type: NodeType;
  /** The `title` option, when present. */
  title?: string;
  /** The `description` option, when present. */
  description?: string;
  /** The node's config, JSON-shaped and not yet validated. */
  config: ReadValue;
  /** Every edge the stage declares: `next`, then `branches`, then `onFail`, each in list order. */
  edges: DeclaredEdge[];
}

/** The SDK name a model stage's routing is called on. */
const ROUTE = "route";

/** The condition `onFail: "id"` stands for: any check failed. */
const BARE_FAILURE = { kind: "checks", op: "any_failed" } as const;

/** A flow node's `config.kind`, by its callee. */
const FLOW_KINDS = invert(FLOW_CALLEES);

/** A terminal's `config.action`, by its callee. */
const TERM_ACTIONS = invert(TERM_CALLEES);

/**
 * Read one entry of `stages`.
 *
 * Every option is read even when the id or another option is wrong, so each mistake in a stage is
 * reported at once.
 *
 * @param reader - The walk's reader, which collects any error.
 * @param element - The array element.
 * @returns The stage, or `undefined` having reported why it has no node.
 */
export function readStage(reader: CodeReader, element: ts.Expression): ReadStage | undefined {
  const call = unwrap(element);
  const callees = list(STAGE_CALLEES.map(code), "or");

  if (
    !ts.isCallExpression(call) ||
    !ts.isIdentifier(call.expression) ||
    call.questionDotToken !== undefined ||
    call.typeArguments !== undefined
  ) {
    reader.outOfGrammar(
      call,
      `Each entry of \`stages\` is a stage call, like llm("id", { … }). A stage is ${callees}.`,
    );
    return undefined;
  }

  const name = call.expression.text;
  const callee = STAGE_CALLEES.find((candidate) => candidate === name);
  if (callee === undefined) {
    reader.outOfGrammar(call.expression, `\`${name}\` is not a stage call. A stage is ${callees}.`);
    return undefined;
  }

  if (call.arguments.length !== 2) {
    reader.outOfGrammar(
      call,
      `\`${callee}\` takes the stage's id and its options: ${callee}("id", { … }).`,
    );
    return undefined;
  }

  const [idNode, optionsNode] = call.arguments;
  const id = reader.string(idNode, "a stage's id");
  const what = `\`${callee}(${id === undefined ? "…" : JSON.stringify(id)}, …)\``;
  const options = reader.object(optionsNode, what, STAGE_OPTIONS[callee]);
  if (options === undefined) return undefined;

  const title = textOption(reader, options, "title");
  const description = textOption(reader, options, "description");
  const { type, config } = readConfig(reader, callee, options, what);
  const edges = readEdges(reader, id ?? "", options);

  if (id === undefined) return undefined;
  return { id, idNode, type, title, description, config, edges };
}

/**
 * Read a stage's type-dependent options into its node type and config.
 *
 * @param reader - The walk's reader.
 * @param callee - The stage call.
 * @param options - Its options.
 * @param what - The call, for messages.
 * @returns The node type and its config.
 */
function readConfig(
  reader: CodeReader,
  callee: StageCallee,
  options: ReadonlyMap<string, ts.Expression>,
  what: string,
): { type: NodeType; config: ReadValue } {
  switch (callee) {
    case "trigger":
      return { type: "trigger", config: {} };
    case "llm":
      return { type: "llm", config: readLlmConfig(reader, options) };
    case "infra":
      return {
        type: "infra",
        config: compact({
          runner_pool: textOption(reader, options, "farm"),
          command: textOption(reader, options, "cmd"),
        }),
      };
    case "decision":
    case "gate":
      return { type: "flow", config: readFlowConfig(reader, callee, options, what) };
    case "openPr":
      return {
        type: "term",
        config: {
          action: TERM_ACTIONS[callee],
          options: compact({
            merge_method: textOption(reader, options, "merge"),
            delete_branch: option(options, "deleteBranch", (node) =>
              reader.boolean(node, "`deleteBranch`"),
            ),
          }),
        },
      };
    case "backToQueue":
    case "needsReview":
      return { type: "term", config: { action: TERM_ACTIONS[callee], options: {} } };
  }
}

/**
 * Read a model stage's options.
 *
 * `mode` is not written in the code: it is `skill` exactly when a `skill` option is.
 *
 * @param reader - The walk's reader.
 * @param options - The stage's options.
 * @returns The config. A stage with no `model` has an empty `routing`, which the validator
 *   reports as `config.routing_missing`.
 */
function readLlmConfig(reader: CodeReader, options: ReadonlyMap<string, ts.Expression>): ReadValue {
  const number = (key: string) => option(options, key, (node) => reader.number(node, code(key)));

  return compact({
    mode: options.has("skill") ? "skill" : "prompt",
    skill: textOption(reader, options, "skill"),
    prompt_template: textOption(reader, options, "prompt"),
    routing: option(options, "model", (node) => readRoute(reader, node)) ?? {},
    limits: compact({ max_retries: number("retries"), token_budget: number("tokenBudget") }),
    permissions: option(options, "permissions", (node) => readPermissions(reader, node)),
  });
}

/**
 * Read `route.task("…")` or `route.alias("…")`.
 *
 * @param reader - The walk's reader.
 * @param node - The `model` option's value.
 * @returns The routing object — `{inherit_task: name}` or `{pinned_model: {alias: name}}`, the
 *   document's structural pin (CH.6, #589) — or `undefined` having reported why.
 */
function readRoute(reader: CodeReader, node: ts.Expression): ReadValue | undefined {
  const value = unwrap(node);
  const show = (method: string) => code(`${ROUTE}.${method}(…)`);

  if (
    !ts.isCallExpression(value) ||
    value.questionDotToken !== undefined ||
    value.typeArguments !== undefined ||
    !ts.isPropertyAccessExpression(value.expression) ||
    value.expression.questionDotToken !== undefined ||
    !ts.isIdentifier(value.expression.expression) ||
    value.expression.expression.text !== ROUTE ||
    !ts.isIdentifier(value.expression.name)
  ) {
    const routes = list(Object.values<string>(ROUTE_METHODS).map(show), "or");
    reader.outOfGrammar(value, `\`model\` is a route: ${routes}.`);
    return undefined;
  }

  const method = value.expression.name.text;
  const key = reader.name(ROUTE_METHODS, method, value.expression.name, "a route", show);

  if (value.arguments.length !== 1) {
    reader.outOfGrammar(
      value,
      `\`${ROUTE}.${method}\` takes one name, like route.task("implement").`,
    );
    return undefined;
  }

  const target = reader.string(value.arguments[0], `the name \`${ROUTE}.${method}\` routes to`);

  if (key === undefined || target === undefined) return undefined;
  return key === "pinned_model" ? { pinned_model: { alias: target } } : { [key]: target };
}

/**
 * Read `{ pushFixup: …, touchCi: … }`.
 *
 * @param reader - The walk's reader.
 * @param node - The `permissions` option's value.
 * @returns The permissions object with whichever flags are written, or `undefined` when it is not
 *   an object literal.
 */
function readPermissions(reader: CodeReader, node: ts.Expression): ReadValue | undefined {
  const properties = reader.object(node, "`permissions`", Object.values(PERMISSION_KEYS));
  if (properties === undefined) return undefined;

  const permissions: ReadValue = {};
  for (const [key, spelling] of Object.entries(PERMISSION_KEYS)) {
    const flag = option(properties, spelling, (value) => reader.boolean(value, code(spelling)));
    if (flag !== undefined) permissions[key] = flag;
  }
  return permissions;
}

/**
 * Read a decision's or a gate's predicate, from `require` or `when`.
 *
 * @param reader - The walk's reader.
 * @param callee - `decision` or `gate`.
 * @param options - The stage's options.
 * @param what - The call, for messages.
 * @returns The config. Both options at once are refused, since no document has two predicates.
 */
function readFlowConfig(
  reader: CodeReader,
  callee: "decision" | "gate",
  options: ReadonlyMap<string, ts.Expression>,
  what: string,
): ReadValue {
  const requirement = options.get("require");
  const when = options.get("when");
  const names = requirement === undefined ? undefined : reader.strings(requirement, "`require`");
  const tested = when === undefined ? undefined : readPredicate(reader, when);

  if (requirement !== undefined && when !== undefined) {
    const later = requirement.pos > when.pos ? requirement : when;
    reader.outOfGrammar(
      later.parent,
      `${what} is decided by \`require\` or by \`when\`, never both.`,
    );
  }

  const predicate =
    requirement === undefined
      ? tested
      : names === undefined
        ? undefined
        : { kind: "checks", op: "all_passed", names };

  return compact({ kind: FLOW_KINDS[callee], predicate });
}

/**
 * Read the edges a stage declares.
 *
 * @param reader - The walk's reader.
 * @param from - The stage's id.
 * @param options - The stage's options.
 * @returns `next`'s edges, then `branches`', then `onFail`'s, each in list order.
 */
function readEdges(
  reader: CodeReader,
  from: string,
  options: ReadonlyMap<string, ts.Expression>,
): DeclaredEdge[] {
  const edges: DeclaredEdge[] = [];

  const next = options.get(EDGE_OPTIONS.default);
  if (next !== undefined) {
    const what = code(EDGE_OPTIONS.default);
    const value = unwrap(next);
    const targets = ts.isArrayLiteralExpression(value)
      ? reader.strings(value, what)
      : [reader.string(value, what)];

    for (const to of targets ?? []) {
      if (to !== undefined) edges.push({ from, to, kind: "default" });
    }
  }

  const branches = options.get(EDGE_OPTIONS.branch);
  if (branches !== undefined) {
    for (const entry of reader.array(branches, code(EDGE_OPTIONS.branch)) ?? []) {
      const read = readEntry(reader, entry, EDGE_OPTIONS.branch);
      if (read !== undefined) edges.push({ from, ...read, kind: "branch" });
    }
  }

  const loops = options.get(EDGE_OPTIONS.loop);
  if (loops !== undefined) {
    const value = unwrap(loops);

    if (ts.isArrayLiteralExpression(value)) {
      for (const entry of value.elements) {
        const read = readEntry(reader, entry, EDGE_OPTIONS.loop);
        if (read !== undefined) edges.push({ from, ...read, kind: "loop" });
      }
    } else {
      const to = reader.string(value, code(EDGE_OPTIONS.loop));
      if (to !== undefined) edges.push({ from, to, kind: "loop", condition: { ...BARE_FAILURE } });
    }
  }

  return edges;
}

/**
 * Read one `{ to: "…", when: … }` entry of `branches` or `onFail`.
 *
 * @param reader - The walk's reader.
 * @param node - The entry.
 * @param option - `branches` or `onFail`, for messages.
 * @returns The target and condition that are written, or `undefined` when the entry is not an
 *   object literal.
 */
function readEntry(
  reader: CodeReader,
  node: ts.Expression,
  option: string,
): { to?: string; condition?: ReadValue } | undefined {
  const properties = reader.object(node, `an entry of \`${option}\``, EDGE_ENTRY_OPTIONS);
  if (properties === undefined) return undefined;

  const to = properties.get("to");
  const when = properties.get("when");
  const target = to === undefined ? undefined : reader.string(to, "an edge's `to`");
  const condition = when === undefined ? undefined : readPredicate(reader, when);

  return {
    ...(target === undefined ? {} : { to: target }),
    ...(condition === undefined ? {} : { condition }),
  };
}

/**
 * Read a string option, when it is written.
 *
 * @param reader - The walk's reader.
 * @param options - The stage's options.
 * @param key - The option.
 * @returns Its string, or `undefined` when absent or misspelled.
 */
function textOption(
  reader: CodeReader,
  options: ReadonlyMap<string, ts.Expression>,
  key: string,
): string | undefined {
  return option(options, key, (node) => reader.string(node, code(key)));
}

/**
 * Read an option, when it is written.
 *
 * @param options - The object's properties.
 * @param key - The option.
 * @param read - How to read its value.
 * @returns The value, or `undefined` when the option is absent or its reading failed.
 */
function option<T>(
  options: ReadonlyMap<string, ts.Expression>,
  key: string,
  read: (node: ts.Expression) => T | undefined,
): T | undefined {
  const node = options.get(key);
  return node === undefined ? undefined : read(node);
}

/**
 * Swap a table's keys and values.
 *
 * @param table - DSL value → callee.
 * @returns Callee → DSL value.
 */
function invert(table: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(table).map(([value, callee]) => [callee, value]));
}
