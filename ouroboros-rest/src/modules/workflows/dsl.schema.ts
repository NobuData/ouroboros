/**
 * The workflow DSL in zod — this service's half of "two validators, one schema"
 * ([#133](https://github.com/NobuData/ouroboros/issues/133)).
 *
 * The published contract is
 * [`schemas/workflow-dsl/v1.json`](../../../../schemas/workflow-dsl/v1.json), a JSON Schema
 * 2020-12 document with an `$id`. This file is that schema written in the language this
 * service validates in, and `dsl.conformance.spec.ts` is what holds the two together: it
 * compiles the committed schema with ajv and asserts that ajv and these schemas classify
 * every golden fixture identically. A rule added to one and forgotten in the other is a
 * red check rather than a divergence discovered by a customer.
 *
 * **Why the document is validated in two stages** rather than as one nested schema. A
 * node's `config` shape depends on its `type`, and so does a predicate's on its `kind` and a
 * terminal's options on its `action`. Both zod and pydantic can express that — zod with
 * `discriminatedUnion`, pydantic with a tagged `Union` — and the two libraries anchor the
 * resulting errors at *different* places: zod reports an unknown discriminator at the
 * discriminator, pydantic at the object, with the matched tag prepended to every path
 * underneath it. Since the anchor is half of what the two validators have to agree on, the
 * dispatch is done by hand on both sides instead: {@link WorkflowDocumentShapeSchema}
 * validates the skeleton with `config` left opaque, and {@link NODE_CONFIG_SCHEMAS} is
 * applied to it afterwards by `dsl.validator.ts`. The engine's `dsl.py` is the same two
 * stages in the same order, which is what makes the two files reviewable side by side.
 *
 * Nothing here reads the committed JSON Schema at runtime. The service validates with zod
 * and ships without the file; the schema is the *published* contract, and the conformance
 * suite is where the two meet.
 */

import { z } from "zod";

/** The `dsl_version` values this build implements — the 1.x minors `v1.json` lists. */
export const SUPPORTED_DSL_VERSIONS = ["1.0"] as const;

/** How much work a ticket is, in the vocabulary `issue_estimates.effort` stores. */
export const EffortSchema = z.enum(["xs", "s", "m", "l", "xl"]);
/** How much work a ticket is. */
export type Effort = z.infer<typeof EffortSchema>;

/** Which tracker a ticket came from, in the vocabulary `ticket_sources.kind` stores. */
export const SourceKindSchema = z.enum(["github", "gitlab", "jira", "linear"]);
/** Which tracker a ticket came from. */
export type SourceKind = z.infer<typeof SourceKindSchema>;

/**
 * A skill name, a model identifier or a task-route name.
 *
 * Decision **P7**: a validated string, never a foreign key. Whether it names something that
 * exists is `dsl.references.ts`'s question, and its answer is a warning.
 */
export const ReferenceSchema = z.string().min(1).max(128);

/** A ticket label, as a tracker spells it. */
export const LabelSchema = z.string().min(1).max(64);

/** A node id: a slug, unique in the document, that edges and run journals both quote. */
export const NodeIdSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/);

/** Where a node sits on the canvas. */
export const PositionSchema = z.strictObject({
  x: z.number().min(-100000).max(100000),
  y: z.number().min(-100000).max(100000),
});
/** Where a node sits on the canvas. */
export type Position = z.infer<typeof PositionSchema>;

/** The five node types the mockup draws, and the vocabulary the canvas styles by. */
export const NodeTypeSchema = z.enum(["trigger", "llm", "infra", "flow", "term"]);
/** One of the five node types. */
export type NodeType = z.infer<typeof NodeTypeSchema>;

/** The three edge kinds: the plain path, one outcome of a fork, and the ouroboros edge. */
export const EdgeKindSchema = z.enum(["default", "branch", "loop"]);
/** One of the three edge kinds. */
export type EdgeKind = z.infer<typeof EdgeKindSchema>;

/**
 * What starts a run — decision **P8**, structured rather than free code.
 *
 * Held at the document root rather than in the trigger node's config, so the predicate has
 * one home and the node carries only what the canvas draws. An empty `conditions` is a
 * trigger that fires on every occurrence of its event, which is a thing an author may mean.
 */
export const TriggerSchema = z.strictObject({
  event: z.enum(["ticket_queued"]),
  conditions: z.strictObject({
    effort_lte: EffortSchema.optional(),
    labels: z.array(LabelSchema).min(1).max(32).optional(),
    source: SourceKindSchema.optional(),
  }),
});
/** What starts a run. */
export type TriggerSpec = z.infer<typeof TriggerSchema>;

/**
 * The predicate variants, by `kind`.
 *
 * Flat by design: composition would need recursion in three validators, and the canvas draws
 * branches rather than boolean trees. The same five kinds serve a flow node's predicate and
 * a branch edge's condition, so the dry-run simulator (R.2) needs one evaluator.
 */
export const PREDICATE_SCHEMAS = {
  always: z.strictObject({ kind: z.literal("always") }),
  effort: z.strictObject({
    kind: z.literal("effort"),
    op: z.enum(["lt", "lte", "eq", "gte", "gt"]),
    value: EffortSchema,
  }),
  labels: z.strictObject({
    kind: z.literal("labels"),
    op: z.enum(["any", "all", "none"]),
    values: z.array(LabelSchema).min(1).max(32),
  }),
  source: z.strictObject({
    kind: z.literal("source"),
    op: z.enum(["in", "not_in"]),
    values: z.array(SourceKindSchema).min(1).max(4),
  }),
  checks: z.strictObject({
    kind: z.literal("checks"),
    op: z.enum(["all_passed", "any_failed"]),
    names: z.array(z.string().min(1).max(128)).min(1).max(64).optional(),
  }),
} as const;

/** The `kind` values a predicate may carry. */
export const PREDICATE_KINDS = Object.keys(PREDICATE_SCHEMAS) as (keyof typeof PREDICATE_SCHEMAS)[];

/** One structured test, evaluated against the run's ticket and its check results. */
export type Predicate = {
  [K in keyof typeof PREDICATE_SCHEMAS]: z.infer<(typeof PREDICATE_SCHEMAS)[K]>;
}[keyof typeof PREDICATE_SCHEMAS];

/**
 * The trigger node configures nothing: its predicate is the document's own `trigger`.
 *
 * Closed and empty on purpose — a field put here would be a second place to look for the
 * thing the root already holds.
 */
export const TriggerConfigSchema = z.strictObject({});
/** A trigger node's config. */
export type TriggerConfig = z.infer<typeof TriggerConfigSchema>;

/**
 * A model stage's config — the inspector's exact field set (mockup 04).
 *
 * `skill` is declared optional here and made conditional by `dsl.validator.ts`, which is
 * where `config.skill_required` and `config.skill_not_allowed` are reported: zod can express
 * the dependency with a `superRefine`, but a refinement's issue carries a `custom` code that
 * says nothing about which rule broke, and the codes are what the parity fixtures record.
 *
 * `routing` is declared as a closed object with both members optional for the same reason:
 * it is a `oneOf` in the published schema, and *neither* and *both* are two different
 * mistakes an author makes, deserving two different codes.
 */
export const LlmConfigSchema = z.strictObject({
  mode: z.enum(["prompt", "skill"]),
  skill: ReferenceSchema.optional(),
  prompt_template: z.string().min(1).max(20000),
  routing: z.strictObject({
    inherit_task: ReferenceSchema.optional(),
    pinned_model: ReferenceSchema.optional(),
  }),
  limits: z.strictObject({
    max_retries: z.int().min(0).max(10),
    token_budget: z.int().min(1000).max(10000000),
  }),
  permissions: z.strictObject({
    push_fixup: z.boolean(),
    touch_ci: z.boolean(),
  }),
});
/** A model stage's config. */
export type LlmConfig = z.infer<typeof LlmConfigSchema>;

/**
 * A build-farm or test stage's config.
 *
 * Both fields are optional, as the issue specifies: a stage with neither runs the
 * repository's default command on the default pool, and which pool that is belongs to a
 * deployment rather than to a document that a workspace publishes once and runs everywhere.
 */
export const InfraConfigSchema = z.strictObject({
  runner_pool: ReferenceSchema.optional(),
  command: z.string().min(1).max(2000).optional(),
});
/** A build-farm or test stage's config. */
export type InfraConfig = z.infer<typeof InfraConfigSchema>;

/**
 * A fork's config.
 *
 * `decision` diverges and `gate` holds; the difference is topological — it is what the edges
 * say — so neither restricts which predicate kinds it accepts. What the two words buy is the
 * canvas treatment and the code view, which is honest about what they are.
 *
 * `predicate` is left opaque here and dispatched by `dsl.validator.ts`, for the reason the
 * module docstring gives.
 */
export const FlowConfigShapeSchema = z.strictObject({
  kind: z.enum(["decision", "gate"]),
  predicate: z.record(z.string(), z.unknown()),
});

/** A fork's config, once its predicate has been dispatched. */
export interface FlowConfig {
  /** Whether the fork diverges (`decision`) or holds (`gate`). */
  kind: "decision" | "gate";
  /** What it evaluates. */
  predicate: Predicate;
}

/** The per-action option schemas for a terminal. */
export const TERM_OPTION_SCHEMAS = {
  open_pr_automerge: z.strictObject({
    merge_method: z.enum(["squash", "merge", "rebase"]),
    delete_branch: z.boolean(),
  }),
  back_to_queue: z.strictObject({}),
  needs_review: z.strictObject({}),
} as const;

/** The `action` values a terminal may carry. */
export const TERM_ACTIONS = Object.keys(
  TERM_OPTION_SCHEMAS,
) as (keyof typeof TERM_OPTION_SCHEMAS)[];

/**
 * A terminal's config, with its options left opaque for the dispatch.
 *
 * Options are per action and each set is closed, so adding one is an edit to the published
 * schema rather than a field that quietly appears in stored documents.
 */
export const TermConfigShapeSchema = z.strictObject({
  action: z.enum(["open_pr_automerge", "back_to_queue", "needs_review"]),
  options: z.record(z.string(), z.unknown()),
});

/** Where a run ends. */
export type TermConfig = {
  [A in keyof typeof TERM_OPTION_SCHEMAS]: {
    action: A;
    options: z.infer<(typeof TERM_OPTION_SCHEMAS)[A]>;
  };
}[keyof typeof TERM_OPTION_SCHEMAS];

/**
 * The per-type config schemas, applied after the skeleton parses.
 *
 * `flow` and `term` are the *shape* schemas: their own discriminated members are dispatched
 * a second time, by the same helper and for the same reason.
 */
export const NODE_CONFIG_SCHEMAS = {
  trigger: TriggerConfigSchema,
  llm: LlmConfigSchema,
  infra: InfraConfigSchema,
  flow: FlowConfigShapeSchema,
  term: TermConfigShapeSchema,
} as const;

/** One node's skeleton — everything but the type-dependent config. */
export const NodeShapeSchema = z.strictObject({
  id: NodeIdSchema,
  type: NodeTypeSchema,
  title: z.string().min(1).max(80),
  description: z.string().max(400).optional(),
  position: PositionSchema,
  config: z.record(z.string(), z.unknown()),
});

/** One connection between two nodes. */
export const EdgeSchema = z.strictObject({
  from: NodeIdSchema,
  to: NodeIdSchema,
  kind: EdgeKindSchema,
  label: z.string().min(1).max(40).optional(),
  condition: z.record(z.string(), z.unknown()).optional(),
});

/**
 * The document's frame: the root properties, with the two collections left as arrays of
 * anything.
 *
 * Their elements are validated one at a time, against {@link NodeShapeSchema} and
 * {@link EdgeSchema}, so that a mistake in one node does not hide a different mistake in the
 * next — a canvas that reports one error, is corrected, and then reports another is a canvas
 * an author stops trusting. Applying the schemas in pieces is not a second definition of the
 * document: the pieces are these three schemas and nothing else.
 */
export const WorkflowRootSchema = z.strictObject({
  dsl_version: z.enum(SUPPORTED_DSL_VERSIONS),
  trigger: TriggerSchema,
  nodes: z.array(z.unknown()).min(1).max(200),
  edges: z.array(z.unknown()).max(400),
});

/** The document's frame, as the first pass produces it. */
export type WorkflowRoot = z.infer<typeof WorkflowRootSchema>;
/** One node's skeleton. */
export type NodeShape = z.infer<typeof NodeShapeSchema>;
/** One edge's skeleton, with its condition still opaque. */
export type EdgeShape = z.infer<typeof EdgeSchema>;

/** What every node carries, whatever its type. */
export interface NodeCommon {
  /** The slug edges and run journals quote. */
  id: string;
  /** What the canvas prints as the node's name. */
  title: string;
  /** The sentence the inspector prints under the title. */
  description?: string;
  /** Where it sits on the canvas. */
  position: Position;
}

/** One stage, with its config typed by its `type`. */
export type WorkflowNode =
  | (NodeCommon & { type: "trigger"; config: TriggerConfig })
  | (NodeCommon & { type: "llm"; config: LlmConfig })
  | (NodeCommon & { type: "infra"; config: InfraConfig })
  | (NodeCommon & { type: "flow"; config: FlowConfig })
  | (NodeCommon & { type: "term"; config: TermConfig });

/** One connection, with its condition typed. */
export interface WorkflowEdge {
  /** The id of the node the edge leaves. */
  from: string;
  /** The id of the node the edge arrives at. */
  to: string;
  /** Which of the three kinds it is. */
  kind: EdgeKind;
  /** What the canvas prints beside it. Presentation, never evaluated. */
  label?: string;
  /** For a `branch`, the test that selects it; for a `loop`, the outcome it carries. */
  condition?: Predicate;
}

/** A whole workflow definition, typed. */
export interface WorkflowDocument {
  /** Which minor of the 1.x line the document is written against. */
  dsl_version: (typeof SUPPORTED_DSL_VERSIONS)[number];
  /** What starts a run. */
  trigger: TriggerSpec;
  /** Every stage on the canvas. */
  nodes: WorkflowNode[];
  /** Every connection between them. */
  edges: WorkflowEdge[];
}
