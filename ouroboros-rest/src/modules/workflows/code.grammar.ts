/**
 * The TypeScript DSL's vocabulary, as data — U.1
 * ([#165](https://github.com/NobuData/ouroboros/issues/165)).
 *
 * Mockup 05 shows a workflow as `defineLoop("standard-fix", {...})`. The language is specified
 * in [`docs/WORKFLOW_CODE_DSL.md`](../../../../docs/WORKFLOW_CODE_DSL.md); this file is every
 * word of it that is a *choice* — which names the header may import, what each node type is
 * called, which option keys a stage call takes and in what order — written once, as tables.
 *
 * **Why tables rather than string literals inside the printer.** Three more readers are coming
 * and all of them need the same vocabulary: the parser (#166) inverts these maps to read a
 * document back, the completions (#177) offer their keys, and the span map (#178) names what
 * it spans. A word spelled in two places is a word that drifts, and the grammar's promise is
 * that `print` and `parse` are one bijection rather than two approximations of it.
 *
 * Nothing here knows how to format anything. `code.literals.ts` owns the spelling of values,
 * `code.predicates.ts` the predicate expressions, `code.layout.ts` the trivia block, and
 * `code.printer.ts` puts them in order.
 */

import type { EdgeKind, Effort, LlmConfig, TermConfig, TriggerSpec } from "./dsl.schema";

/** The module every workflow file imports from, and the only one it may. */
export const SDK_MODULE = "@ouroboros/sdk";

/** The one top-level call a workflow file makes. */
export const DEFINE_LOOP = "defineLoop";

/** The single parameter every predicate arrow function names. */
export const PREDICATE_PARAMETER = "i";

/**
 * The stage-call names: one per node type, and one per variant where a type has two readings.
 *
 * A flow node is `decision` or `gate` by its `config.kind`, and a terminal is named by its
 * `config.action`, because those are the words the canvas and mockup 05 already use. Every
 * callee is a closed name: the node id is the call's first argument, never its name, so no
 * identifier a workspace chooses can collide with the grammar.
 */
export const STAGE_CALLEES = [
  "trigger",
  "llm",
  "infra",
  "decision",
  "gate",
  "openPr",
  "backToQueue",
  "needsReview",
] as const;

/** One of the stage-call names. */
export type StageCallee = (typeof STAGE_CALLEES)[number];

/** A flow node's callee, by its `config.kind`. */
export const FLOW_CALLEES = { decision: "decision", gate: "gate" } as const satisfies Record<
  "decision" | "gate",
  StageCallee
>;

/** A terminal's callee, by its `config.action`. */
export const TERM_CALLEES = {
  open_pr_automerge: "openPr",
  back_to_queue: "backToQueue",
  needs_review: "needsReview",
} as const satisfies Record<TermConfig["action"], StageCallee>;

/**
 * Every name the module header may import, in the order the printer lists them.
 *
 * The header imports exactly the names the file uses — `effort` only when a predicate compares
 * one, `route` only when a model stage exists — so the list is a vocabulary and an order, not
 * a line every file carries whole.
 */
export const SDK_IMPORTS = [DEFINE_LOOP, "effort", "route", ...STAGE_CALLEES] as const;

/** One importable name. */
export type SdkImport = (typeof SDK_IMPORTS)[number];

/**
 * The trigger's event, as the code view spells it.
 *
 * `ticket_queued` is the DSL's word and `issue.queued` is mockup 05's. A one-entry map is still
 * a map: the parser reads it backwards, and a second event is a second entry here.
 */
export const TRIGGER_EVENTS = {
  ticket_queued: "issue.queued",
} as const satisfies Record<TriggerSpec["event"], string>;

/** Effort values, as the `effort.M` constants mockup 05 writes them. */
export const EFFORT_CONSTANTS = {
  xs: "XS",
  s: "S",
  m: "M",
  l: "L",
  xl: "XL",
} as const satisfies Record<Effort, string>;

/**
 * The method each predicate operator is called as, by predicate kind.
 *
 * `in` is a reserved word in TypeScript but a legal property name, so `i.source.in([...])`
 * parses; `not_in` and the two check operators are camel-cased like every other key.
 */
export const PREDICATE_METHODS = {
  effort: { lt: "lt", lte: "lte", eq: "eq", gte: "gte", gt: "gt" },
  labels: { any: "any", all: "all", none: "none" },
  source: { in: "in", not_in: "notIn" },
  checks: { all_passed: "allPassed", any_failed: "anyFailed" },
} as const;

/**
 * The trigger's conditions, in the order `when` conjoins them, and the method each one reads as.
 *
 * All present conditions are ANDed (docs/WORKFLOW_DSL.md §3), so the order is presentation —
 * which is exactly why it has to be fixed: two orders would be two spellings of one document.
 * `source` is a single value in a trigger, so it gets `is` rather than a predicate's `in`.
 */
export const TRIGGER_CONDITION_METHODS = [
  ["effort_lte", "effort", "lte"],
  ["labels", "labels", "all"],
  ["source", "source", "is"],
] as const;

/** How a model stage's routing is written: `route.task("implement")` or `route.model("…")`. */
export const ROUTE_METHODS = {
  inherit_task: "task",
  pinned_model: "model",
} as const satisfies Record<keyof LlmConfig["routing"], string>;

/** A model stage's permission flags, camel-cased inside `permissions: {…}`. */
export const PERMISSION_KEYS = {
  push_fixup: "pushFixup",
  touch_ci: "touchCi",
} as const satisfies Record<keyof LlmConfig["permissions"], string>;

/** Which stage option each edge kind is written under, on the edge's source stage. */
export const EDGE_OPTIONS = {
  default: "next",
  branch: "branches",
  loop: "onFail",
} as const satisfies Record<EdgeKind, string>;

/** What every stage call carries first. */
const COMMON_OPTIONS = ["title", "description"] as const;

/** The edge options, last in every stage that may have outgoing edges. */
const EDGE_OPTION_KEYS = [EDGE_OPTIONS.default, EDGE_OPTIONS.branch, EDGE_OPTIONS.loop] as const;

/**
 * Every option key each stage call may take, in the order the printer writes them.
 *
 * The printer emits keys by walking this table, so the table is not documentation of the
 * order — it *is* the order. Terminals carry no edge keys because nothing may leave a terminal
 * (`edge.out_of_terminal`), and the trigger carries no config keys because its config is closed
 * and empty.
 */
export const STAGE_OPTIONS = {
  trigger: [...COMMON_OPTIONS, ...EDGE_OPTION_KEYS],
  llm: [
    ...COMMON_OPTIONS,
    "skill",
    "model",
    "retries",
    "tokenBudget",
    "permissions",
    "prompt",
    ...EDGE_OPTION_KEYS,
  ],
  infra: [...COMMON_OPTIONS, "farm", "cmd", ...EDGE_OPTION_KEYS],
  decision: [...COMMON_OPTIONS, "require", "when", ...EDGE_OPTION_KEYS],
  gate: [...COMMON_OPTIONS, "require", "when", ...EDGE_OPTION_KEYS],
  openPr: [...COMMON_OPTIONS, "merge", "deleteBranch"],
  backToQueue: [...COMMON_OPTIONS],
  needsReview: [...COMMON_OPTIONS],
} as const satisfies Record<StageCallee, readonly string[]>;

/** One level of indentation. */
export const INDENT = "  ";

/** The trailing comment on the closing line of every stage that carries a loop edge. */
export const LOOP_COMMENT = "// the loop bites its tail";

/**
 * The generated comment block after `defineLoop(...)`: mockup 05's round-trip promise.
 *
 * Constant text, so a document prints the same bytes whatever version it will be published as.
 * The mockup's *"Publishing writes v15"* and *"`gate.onFail`"* are the two words that differ,
 * and `docs/WORKFLOW_CODE_DSL.md` §10 records why.
 */
export const ROUND_TRIP_COMMENT = [
  "// Round-trips with the visual canvas: every node on the graph is one",
  "// stage call above, and `onFail` is the declared back-edge that",
  "// closes the loop. Publishing writes the next version for both editors.",
] as const;

/** The line that opens the layout block. Everything after it is `// node` and `// edge` lines. */
export const LAYOUT_MARKER = "// @ouroboros/layout v1 — generated; the canvas owns these lines";

/** The prefix of a layout line recording one node's canvas position. */
export const LAYOUT_NODE_PREFIX = "// node ";

/** The prefix of a layout line recording one edge's place in the order, and its label. */
export const LAYOUT_EDGE_PREFIX = "// edge ";
