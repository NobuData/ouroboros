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

/** The keys of `defineLoop`'s options, in the order the printer writes them. */
export const DEFINE_LOOP_OPTIONS = ["dsl", "trigger", "stages"] as const;

/** The keys of the `trigger: {…}` option, in the order the printer writes them. */
export const TRIGGER_OPTIONS = ["on", "when"] as const;

/** The keys of one `branches` or `onFail` entry, in the order the printer writes them. */
export const EDGE_ENTRY_OPTIONS = ["to", "when"] as const;

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

/*
 * ---------------------------------------------------------------------------
 * Where the grammar's words live in the published schema — W.1
 * ([#177](https://github.com/NobuData/ouroboros/issues/177)).
 *
 * The editor's completions and hover cards say what a symbol is: its type, the values it takes,
 * and its documentation. None of that is written here. These tables only point, as JSON Pointers
 * into `schemas/workflow-dsl/v1.json`, and `code.symbols.ts` reads the type, the `enum` and the
 * `description` from the schema. A symbol whose schema location has no description gets no doc,
 * never a sentence composed for it. `code.symbols.spec.ts` resolves every pointer below against
 * the committed schema.
 */

/** Model stage fields. */
const LLM_FIELD = "/$defs/llm_config/properties";

/** A model stage's routing — the `model: route.task(…)` option. */
export const ROUTING_FIELD = `${LLM_FIELD}/routing`;

/** Build-farm stage fields. */
const INFRA_FIELD = "/$defs/infra_config/properties";

/** The options an `open_pr_automerge` terminal carries. */
const OPEN_PR_OPTION_FIELD = "/$defs/term_config/allOf/0/then/properties/options/properties";

/** A node's own fields, which every stage call carries first. */
const NODE_FIELD = "/$defs/node/properties";

/** One connection. `next`, `branches` and `onFail` are all spellings of edges. */
const EDGE_FIELD = "/$defs/edge";

/** The root document. Its description is `defineLoop`'s doc. */
export const DEFINE_LOOP_FIELD = "";

/** A node's id — the first argument of every stage call. */
export const NODE_ID_FIELD = `${NODE_FIELD}/id`;

/** A structured predicate — what a flow node's and an edge's `when` spell. */
export const PREDICATE_FIELD = "/$defs/predicate";

/** The trigger's conditions, one property per condition `when` conjoins. */
export const TRIGGER_CONDITIONS_FIELD = "/$defs/trigger/properties/conditions/properties";

/** The effort vocabulary `effort.M` spells. */
export const EFFORT_FIELD = "/$defs/effort";

/** The tracker vocabulary a `source` predicate lists. */
export const SOURCE_KIND_FIELD = "/$defs/source_kind";

/** A model stage's permission flags — `PERMISSION_KEYS`' keys are its property names. */
export const PERMISSIONS_FIELD = `${LLM_FIELD}/permissions/properties`;

/** `defineLoop`'s options. */
export const DEFINE_LOOP_FIELDS = {
  dsl: "/properties/dsl_version",
  trigger: "/$defs/trigger",
  stages: "/properties/nodes",
} as const satisfies Record<(typeof DEFINE_LOOP_OPTIONS)[number], string>;

/** The `trigger: {…}` option's keys. */
export const TRIGGER_FIELDS = {
  on: "/$defs/trigger/properties/event",
  when: "/$defs/trigger/properties/conditions",
} as const satisfies Record<(typeof TRIGGER_OPTIONS)[number], string>;

/** The keys of one `branches` or `onFail` entry. */
export const EDGE_ENTRY_FIELDS = {
  to: `${EDGE_FIELD}/properties/to`,
  when: `${EDGE_FIELD}/properties/condition`,
} as const satisfies Record<(typeof EDGE_ENTRY_OPTIONS)[number], string>;

/** Where each stage callee's node type is configured — the doc card a callee shows. */
export const STAGE_CALLEE_FIELDS = {
  trigger: "/$defs/trigger_config",
  llm: "/$defs/llm_config",
  infra: "/$defs/infra_config",
  decision: "/$defs/flow_config",
  gate: "/$defs/flow_config",
  openPr: "/$defs/term_config",
  backToQueue: "/$defs/term_config",
  needsReview: "/$defs/term_config",
} as const satisfies Record<StageCallee, string>;

/** `title` and `description`, on every stage. */
const COMMON_OPTION_FIELDS = {
  title: `${NODE_FIELD}/title`,
  description: `${NODE_FIELD}/description`,
} as const;

/** The edge options, on every stage that may have outgoing edges. */
const EDGE_OPTION_FIELDS = { next: EDGE_FIELD, branches: EDGE_FIELD, onFail: EDGE_FIELD } as const;

/** A flow node's two predicate spellings: `require` is named checks, `when` any predicate. */
const FLOW_OPTION_FIELDS = {
  require: `${PREDICATE_FIELD}/allOf/3/then/properties/names`,
  when: "/$defs/flow_config/properties/predicate",
} as const;

/**
 * Where each stage option's value lives in the schema, by callee.
 *
 * **Partial on purpose.** A key added to {@link STAGE_OPTIONS} is offered as a completion with no
 * edit here; it simply has no type and no doc until it points somewhere. The spec holds today's
 * table to full coverage, so a real addition is still noticed.
 */
export const STAGE_OPTION_FIELDS = {
  trigger: { ...COMMON_OPTION_FIELDS, ...EDGE_OPTION_FIELDS },
  llm: {
    ...COMMON_OPTION_FIELDS,
    skill: `${LLM_FIELD}/skill`,
    model: `${LLM_FIELD}/routing`,
    retries: `${LLM_FIELD}/limits/properties/max_retries`,
    tokenBudget: `${LLM_FIELD}/limits/properties/token_budget`,
    permissions: `${LLM_FIELD}/permissions`,
    prompt: `${LLM_FIELD}/prompt_template`,
    ...EDGE_OPTION_FIELDS,
  },
  infra: {
    ...COMMON_OPTION_FIELDS,
    farm: `${INFRA_FIELD}/runner_pool`,
    cmd: `${INFRA_FIELD}/command`,
    ...EDGE_OPTION_FIELDS,
  },
  decision: { ...COMMON_OPTION_FIELDS, ...FLOW_OPTION_FIELDS, ...EDGE_OPTION_FIELDS },
  gate: { ...COMMON_OPTION_FIELDS, ...FLOW_OPTION_FIELDS, ...EDGE_OPTION_FIELDS },
  openPr: {
    ...COMMON_OPTION_FIELDS,
    merge: `${OPEN_PR_OPTION_FIELD}/merge_method`,
    deleteBranch: `${OPEN_PR_OPTION_FIELD}/delete_branch`,
  },
  backToQueue: { ...COMMON_OPTION_FIELDS },
  needsReview: { ...COMMON_OPTION_FIELDS },
} as const satisfies {
  readonly [C in StageCallee]: Partial<Record<(typeof STAGE_OPTIONS)[C][number], string>>;
};

/** The type `route.task(…)` and `route.model(…)` both answer — mockup 05's Types card. */
export const ROUTE_RESULT_TYPE = "ModelRoute";

/**
 * `route.task(name: TaskKind): ModelRoute` and its sibling, as signatures.
 *
 * The parameter and type names are the SDK's words, which mockup 05 prints; the doc each card
 * shows is the `description` at `field`.
 */
export const ROUTE_SIGNATURES = {
  inherit_task: {
    parameter: "name",
    type: "TaskKind",
    field: `${LLM_FIELD}/routing/oneOf/0/properties/inherit_task`,
  },
  pinned_model: {
    parameter: "name",
    type: "ModelId",
    field: `${LLM_FIELD}/routing/oneOf/1/properties/pinned_model`,
  },
} as const satisfies Record<
  keyof LlmConfig["routing"],
  { parameter: string; type: string; field: string }
>;

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
