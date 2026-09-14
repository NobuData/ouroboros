/**
 * Generated workflow documents — test support for U.4's round-trip property and parser fuzz
 * ([#168](https://github.com/NobuData/ouroboros/issues/168)).
 *
 * ```ts
 * fc.assert(fc.property(WORKFLOW_CASE, ({ slug, document }) => {
 *   expect(parseWorkflowCode(printWorkflowCode(slug, document).text).document).toStrictEqual(document);
 * }), { seed: 168, numRuns: 1000 });
 * ```
 *
 * An example-based suite shows the printer and the parser agree on the documents someone thought to
 * write. These arbitraries write the rest, within the one limit the printer states: **every document
 * is valid**, because the printer takes what `validateWorkflowDocument` accepts.
 *
 * Validity is built in rather than filtered for, so no run is spent on a document that is thrown
 * away:
 *
 * * **A spine** runs from the trigger through every middle stage to the first terminal, so every
 *   stage is reachable and some path ends.
 * * **Every other terminal** hangs off a stage on the spine, and nothing leaves a terminal.
 * * **Skip edges** jump down the spine, and **loop edges** point back up it by one stage or more, so
 *   each loop's target reaches its source without it. No pair of stages is joined twice.
 * * **A default edge carries no condition, and a branch edge always carries one.**
 *
 * Everything else the grammar spells is arbitrary: every stage callee, every predicate form, every
 * edge option and its shorthand, both routings and both modes, the trigger's conditions, strings no
 * raw literal can hold, fractional and negative-zero positions, labels, and the order of both lists.
 * {@link grammarFeatures} names what one document exercises, so a suite can assert that a run covered
 * the grammar rather than hope it did.
 *
 * Value vocabularies (effort sizes, predicate operators, merge methods, …) are read from
 * `dsl.schema.ts`, so a value the schema gains is generated without an edit here, and
 * {@link GRAMMAR_FEATURES} then requires the run to reach it.
 *
 * `*.fixture.ts` is left out of the build, so none of this ships.
 */

import fc from "fast-check";

import { STAGE_CALLEES } from "./code.grammar";
import { calleeFor } from "./code.printer";
import {
  AliasNameSchema,
  EffortSchema,
  NodeIdSchema,
  PREDICATE_SCHEMAS,
  SourceKindSchema,
  TERM_OPTION_SCHEMAS,
  type LlmConfig,
  type NodeCommon,
  type Predicate,
  type TriggerSpec,
  type WorkflowDocument,
  type WorkflowEdge,
  type WorkflowNode,
} from "./dsl.schema";
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from "./slug";

/** A workflow slug and a document to print under it. */
export interface WorkflowCase {
  /** The slug `defineLoop` names. */
  slug: string;
  /** A valid document. */
  document: WorkflowDocument;
}

/** A node without the fields every type shares: its type and its config. */
type NodeBody = WorkflowNode extends infer Node
  ? Node extends WorkflowNode
    ? Omit<Node, keyof NodeCommon>
    : never
  : never;

/**
 * `fc.record`, building ordinary objects.
 *
 * fast-check may give a generated record a `null` prototype. The parser reads a document back as
 * ordinary objects, and `toStrictEqual` would tell the two apart on a difference no JSON document
 * can carry.
 */
const record = ((model: Record<string, fc.Arbitrary<unknown>>, constraints?: object) =>
  fc.record(model, { ...constraints, noNullPrototype: true })) as unknown as typeof fc.record;

/** A string of UTF-16 code units, so this file holds none of the characters it names raw. */
const units = (...codes: number[]): string => String.fromCharCode(...codes);

/** U+2028 and U+2029: line breaks to the TypeScript scanner, and left raw by JSON. */
const LINE_SEPARATOR = units(0x2028);
const PARAGRAPH_SEPARATOR = units(0x2029);

/**
 * Pieces of text chosen because a printer is most likely to get them wrong: quotes of every kind,
 * a template substitution, escapes, every line break the TypeScript scanner knows, lone surrogates,
 * control characters, a no-break space, comment openers, and non-ASCII text.
 */
const HOSTILE_UNITS: readonly string[] = [
  '"',
  "'",
  "`",
  "\\",
  "$",
  "${",
  "{{",
  "}}",
  "\n",
  "\r",
  "\r\n",
  "\t",
  units(0x00),
  units(0x1b),
  units(0x7f),
  units(0xa0),
  LINE_SEPARATOR,
  PARAGRAPH_SEPARATOR,
  units(0xd800),
  units(0xdfff),
  "//",
  "/*",
  "*/",
  "=>",
  "≤ M ↓",
  units(0xd83d, 0xdc0d),
];

/** The longest unit of generated text, in UTF-16 code units: `"≤ M ↓"`. */
const LONGEST_UNIT = Math.max(...HOSTILE_UNITS.map((unit) => unit.length));

/** One unit of generated text: mostly printable ASCII, then the hostile pieces, then any code point. */
const TEXT_UNIT = fc.oneof(
  { arbitrary: fc.string({ unit: "grapheme-ascii", minLength: 1, maxLength: 1 }), weight: 6 },
  { arbitrary: fc.constantFrom(...HOSTILE_UNITS), weight: 2 },
  { arbitrary: fc.string({ unit: "binary", minLength: 1, maxLength: 1 }), weight: 1 },
);

/**
 * Text whose length, in UTF-16 code units as the DSL counts it, stays inside a schema bound.
 *
 * @param minLength - The fewest code units the schema allows: `0` or `1`.
 * @param maxLength - The most it allows.
 * @returns The arbitrary.
 */
function text(minLength: 0 | 1, maxLength: number): fc.Arbitrary<string> {
  return fc.string({
    unit: TEXT_UNIT,
    minLength,
    maxLength: Math.max(minLength, Math.floor(maxLength / LONGEST_UNIT)),
  });
}

/** A node id, including the ones that are also JavaScript property or keyword names. */
const NODE_ID = fc
  .oneof(
    { arbitrary: fc.stringMatching(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/), weight: 8 },
    {
      arbitrary: fc.constantFrom(
        "constructor",
        "prototype",
        "in",
        "default",
        "0",
        "a--b",
        "x".repeat(64),
      ),
      weight: 1,
    },
  )
  .filter((id) => NodeIdSchema.safeParse(id).success);

/** A workflow slug the printer accepts, the longest one included. */
const WORKFLOW_SLUG = fc.oneof(
  {
    arbitrary: fc.stringMatching(SLUG_PATTERN).filter((slug) => slug.length <= SLUG_MAX_LENGTH),
    weight: 8,
  },
  { arbitrary: fc.constant("a".repeat(SLUG_MAX_LENGTH)), weight: 1 },
);

/** A registry alias, as a pinned model names one. */
const ALIAS = fc
  .stringMatching(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .filter((alias) => AliasNameSchema.safeParse(alias).success);

/** A skill, task-route or runner-pool name: any string of 1 to 128 code units (decision P7). */
const REFERENCE = text(1, 128);

/** A ticket label. */
const LABEL = text(1, 64);

/** A check name, as `require` and `names` list them. */
const CHECK_NAME = text(1, 128);

const EFFORT = fc.constantFrom(...EffortSchema.options);
const SOURCE = fc.constantFrom(...SourceKindSchema.options);

/**
 * Every structured predicate (`WORKFLOW_CODE_DSL.md` §6): each kind, each operator, and a checks
 * predicate with and without its names.
 */
export const PREDICATE: fc.Arbitrary<Predicate> = fc.oneof(
  fc.constant<Predicate>({ kind: "always" }),
  record({ op: fc.constantFrom(...PREDICATE_SCHEMAS.effort.shape.op.options), value: EFFORT }).map(
    ({ op, value }): Predicate => ({ kind: "effort", op, value }),
  ),
  record({
    op: fc.constantFrom(...PREDICATE_SCHEMAS.labels.shape.op.options),
    values: fc.array(LABEL, { minLength: 1, maxLength: 3 }),
  }).map(({ op, values }): Predicate => ({ kind: "labels", op, values })),
  record({
    op: fc.constantFrom(...PREDICATE_SCHEMAS.source.shape.op.options),
    values: fc.array(SOURCE, { minLength: 1, maxLength: 4 }),
  }).map(({ op, values }): Predicate => ({ kind: "source", op, values })),
  record(
    {
      op: fc.constantFrom(...PREDICATE_SCHEMAS.checks.shape.op.options),
      names: fc.array(CHECK_NAME, { minLength: 1, maxLength: 3 }),
    },
    { requiredKeys: ["op"] },
  ).map(({ op, names }): Predicate => ({
    kind: "checks",
    op,
    ...(names === undefined ? {} : { names }),
  })),
);

/** The root trigger: `ticket_queued`, with any subset of its three conditions. */
const TRIGGER: fc.Arbitrary<TriggerSpec> = record(
  { effort_lte: EFFORT, labels: fc.array(LABEL, { minLength: 1, maxLength: 3 }), source: SOURCE },
  { requiredKeys: [] },
).map((conditions): TriggerSpec => ({ event: "ticket_queued", conditions }));

/**
 * A canvas coordinate inside `PositionSchema`'s bounds: integers, fractions from a drag, the
 * bounds themselves, the smallest double, and negative zero — the one value `String(n)` loses.
 */
const COORDINATE = fc.oneof(
  { arbitrary: fc.integer({ min: -100000, max: 100000 }), weight: 4 },
  { arbitrary: fc.double({ min: -100000, max: 100000, noNaN: true }), weight: 3 },
  { arbitrary: fc.constantFrom(-0, 0.5, -99999.25, 5e-324, 100000, -100000), weight: 1 },
);

/** What every node carries whatever its type, but its id: a title, maybe a description, a position. */
const COMMON = record(
  {
    title: text(1, 80),
    description: text(0, 400),
    position: record({ x: COORDINATE, y: COORDINATE }),
  },
  { requiredKeys: ["title", "position"] },
);

/** A model stage, in either mode and routed either way. */
const LLM_BODY: fc.Arbitrary<NodeBody> = record({
  skill: fc.option(REFERENCE, { nil: undefined }),
  prompt: text(1, 20000),
  routing: fc.oneof(
    REFERENCE.map((task): LlmConfig["routing"] => ({ inherit_task: task })),
    ALIAS.map((alias): LlmConfig["routing"] => ({ pinned_model: { alias } })),
  ),
  retries: fc.integer({ min: 0, max: 10 }),
  budget: fc.oneof(
    fc.integer({ min: 1000, max: 10_000_000 }),
    fc.constantFrom(1000, 400_000, 10_000_000),
  ),
  pushFixup: fc.boolean(),
  touchCi: fc.boolean(),
}).map(({ skill, prompt, routing, retries, budget, pushFixup, touchCi }): NodeBody => ({
  type: "llm",
  config: {
    mode: skill === undefined ? "prompt" : "skill",
    ...(skill === undefined ? {} : { skill }),
    prompt_template: prompt,
    routing,
    limits: { max_retries: retries, token_budget: budget },
    permissions: { push_fixup: pushFixup, touch_ci: touchCi },
  },
}));

/** A build-farm or test stage, with either, both or neither of its options. */
const INFRA_BODY: fc.Arbitrary<NodeBody> = record(
  { runner_pool: REFERENCE, command: text(1, 2000) },
  { requiredKeys: [] },
).map((config): NodeBody => ({ type: "infra", config }));

/** A decision or a gate, on any predicate — a gate's `require` included. */
const FLOW_BODY: fc.Arbitrary<NodeBody> = record({
  kind: fc.constantFrom("decision", "gate"),
  predicate: PREDICATE,
}).map(({ kind, predicate }): NodeBody => ({ type: "flow", config: { kind, predicate } }));

/** A stage that is neither the trigger nor a terminal. */
const MIDDLE_BODY = fc.oneof(LLM_BODY, INFRA_BODY, FLOW_BODY);

/** A terminal, with each action and each merge option. */
const TERM_BODY: fc.Arbitrary<NodeBody> = fc.oneof(
  record({
    merge_method: fc.constantFrom(
      ...TERM_OPTION_SCHEMAS.open_pr_automerge.shape.merge_method.options,
    ),
    delete_branch: fc.boolean(),
  }).map((options): NodeBody => ({
    type: "term",
    config: { action: "open_pr_automerge", options },
  })),
  fc
    .constantFrom("back_to_queue", "needs_review")
    .map((action): NodeBody => ({ type: "term", config: { action, options: {} } })),
);

/** How a forward edge is drawn: its kind, the condition a branch carries, and maybe a label. */
const FORWARD = record(
  { branch: fc.boolean(), condition: PREDICATE, label: text(1, 40) },
  { requiredKeys: ["branch", "condition"] },
);

/**
 * A loop edge's condition: none, *any check failed* (what `onFail: "id"` stands for), or any other
 * predicate.
 */
const LOOP_CONDITION = fc.oneof(
  { arbitrary: fc.constant(undefined), weight: 1 },
  { arbitrary: fc.constant<Predicate>({ kind: "checks", op: "any_failed" }), weight: 3 },
  { arbitrary: PREDICATE, weight: 2 },
);

/** Sort keys for reordering a list; absent means the list keeps its natural order. */
const ORDER = fc.option(fc.array(fc.nat({ max: 99 }), { minLength: 16, maxLength: 16 }), {
  nil: undefined,
});

/** The most middle stages a generated document has. */
const MAX_MIDDLE = 6;
/** The most terminals. */
const MAX_TERMINALS = 3;

/**
 * Every valid document shape the grammar spells: see this file's header for how validity is kept.
 * Documents stay small (at most ten stages) so a thousand of them run in seconds; size is not what
 * breaks a printer, and the golden fixtures and seeds cover the large ones.
 */
export const WORKFLOW_DOCUMENT: fc.Arbitrary<WorkflowDocument> = record({
  middle: fc.integer({ min: 0, max: MAX_MIDDLE }),
  terminals: fc.integer({ min: 1, max: MAX_TERMINALS }),
})
  .chain(({ middle, terminals }) => {
    const stages = 1 + middle + terminals;
    const exactly = (count: number) => ({ minLength: count, maxLength: count });

    return record({
      trigger: TRIGGER,
      ids: fc.uniqueArray(NODE_ID, exactly(stages)),
      commons: fc.array(COMMON, exactly(stages)),
      middles: fc.array(MIDDLE_BODY, exactly(middle)),
      terms: fc.array(TERM_BODY, exactly(terminals)),
      spine: fc.array(FORWARD, exactly(middle + 1)),
      attachments: fc.array(record({ from: fc.nat(), choice: FORWARD }), exactly(terminals - 1)),
      skips: fc.array(record({ from: fc.nat(), to: fc.nat(), choice: FORWARD }), {
        maxLength: 4,
      }),
      loops: fc.array(
        record(
          { from: fc.nat(), to: fc.nat(), condition: LOOP_CONDITION, label: text(1, 40) },
          { requiredKeys: ["from", "to", "condition"] },
        ),
        { maxLength: 3 },
      ),
      nodeOrder: ORDER,
      edgeOrder: ORDER,
    });
  })
  .map(buildDocument);

/** A slug and a document, for the printer. */
export const WORKFLOW_CASE: fc.Arbitrary<WorkflowCase> = record({
  slug: WORKFLOW_SLUG,
  document: WORKFLOW_DOCUMENT,
});

/** What {@link WORKFLOW_DOCUMENT} generates before it is assembled. */
interface DocumentParts {
  trigger: TriggerSpec;
  ids: string[];
  commons: Omit<NodeCommon, "id">[];
  middles: NodeBody[];
  terms: NodeBody[];
  spine: ForwardChoice[];
  attachments: { from: number; choice: ForwardChoice }[];
  skips: { from: number; to: number; choice: ForwardChoice }[];
  loops: { from: number; to: number; condition: Predicate | undefined; label?: string }[];
  nodeOrder: number[] | undefined;
  edgeOrder: number[] | undefined;
}

/** One forward edge's drawing, as {@link FORWARD} generates it. */
interface ForwardChoice {
  branch: boolean;
  condition: Predicate;
  label?: string;
}

/**
 * Assemble a valid document from its generated parts.
 *
 * Stage indices: `0` is the trigger, `1…m` the middle stages, `m + 1` the first terminal (the end of
 * the spine), and the other terminals follow. Generated numbers pick among the indices that keep the
 * document valid, by remainder, so every value of every part is usable and shrinks cleanly.
 *
 * @param parts - The generated parts.
 * @returns The document.
 */
function buildDocument(parts: DocumentParts): WorkflowDocument {
  const middle = parts.middles.length;
  const spineEnd = middle + 1;
  const bodies: NodeBody[] = [{ type: "trigger", config: {} }, ...parts.middles, ...parts.terms];
  const nodes = bodies.map((body, index) => ({
    id: parts.ids[index],
    ...parts.commons[index],
    ...body,
  }));

  const edges: WorkflowEdge[] = [];
  const joined = new Set<string>();

  /** Add an edge between two stage indices, unless the pair is already joined. */
  const join = (from: number, to: number, edge: Omit<WorkflowEdge, "from" | "to">) => {
    const pair = `${from} ${to}`;
    if (joined.has(pair)) return;

    joined.add(pair);
    edges.push({ from: nodes[from].id, to: nodes[to].id, ...edge });
  };

  /** Add a default or branch edge as a choice draws it. */
  const forward = (from: number, to: number, { branch, condition, label }: ForwardChoice) =>
    join(from, to, {
      kind: branch ? "branch" : "default",
      ...(label === undefined ? {} : { label }),
      ...(branch ? { condition } : {}),
    });

  parts.spine.forEach((choice, index) => forward(index, index + 1, choice));

  // Every other terminal hangs off a non-terminal stage on the spine: the trigger or a middle stage.
  parts.attachments.forEach(({ from, choice }, index) =>
    forward(from % (middle + 1), spineEnd + 1 + index, choice),
  );

  // A skip edge leaves a non-terminal spine stage and lands two or more stages further down.
  for (const { from, to, choice } of parts.skips) {
    const source = from % (middle + 1);
    const span = spineEnd - (source + 2) + 1;
    if (span > 0) forward(source, source + 2 + (to % span), choice);
  }

  // A loop edge leaves a middle stage and returns to an earlier middle stage — never the trigger,
  // which nothing enters. The spine carries the target back down to the source without it.
  if (middle >= 2) {
    for (const { from, to, condition, label } of parts.loops) {
      const source = 2 + (from % (middle - 1));
      const target = 1 + (to % (source - 1));
      join(source, target, {
        kind: "loop",
        ...(label === undefined ? {} : { label }),
        ...(condition === undefined ? {} : { condition }),
      });
    }
  }

  return {
    dsl_version: "1.0",
    trigger: parts.trigger,
    nodes: reorder(nodes, parts.nodeOrder),
    edges: reorder(edges, parts.edgeOrder),
  };
}

/**
 * A list sorted by generated keys, stably.
 *
 * @param items - The list.
 * @param keys - One key per position, cycled; `undefined` keeps the list as it is.
 * @returns The reordered copy.
 */
function reorder<T>(items: T[], keys: number[] | undefined): T[] {
  if (keys === undefined) return items;

  return items
    .map((item, index) => ({ item, index, key: keys[index % keys.length] }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map(({ item }) => item);
}

/** Every predicate's form, as {@link grammarFeatures} names it: `effort.lte`, `checks.all_passed+names`, … */
const PREDICATE_FORMS = [
  "always",
  ...PREDICATE_SCHEMAS.effort.shape.op.options.map((op) => `effort.${op}`),
  ...PREDICATE_SCHEMAS.labels.shape.op.options.map((op) => `labels.${op}`),
  ...PREDICATE_SCHEMAS.source.shape.op.options.map((op) => `source.${op}`),
  ...PREDICATE_SCHEMAS.checks.shape.op.options.flatMap((op) => [
    `checks.${op}`,
    `checks.${op}+names`,
  ]),
];

/**
 * Everything a run of generated documents has to reach before it can be said to span the grammar
 * (`WORKFLOW_CODE_DSL.md` §3–§9). {@link grammarFeatures} names the same features for one document.
 */
export const GRAMMAR_FEATURES: readonly string[] = [
  ...STAGE_CALLEES.map((callee) => `stage:${callee}`),
  "model:task",
  "model:alias",
  "llm:prompt",
  "llm:skill",
  "infra:farm",
  "infra:cmd",
  "infra:bare",
  ...TERM_OPTION_SCHEMAS.open_pr_automerge.shape.merge_method.options.map(
    (method) => `merge:${method}`,
  ),
  "deleteBranch:true",
  "deleteBranch:false",
  "flow:decision:require",
  "flow:decision:when",
  "flow:gate:require",
  "flow:gate:when",
  ...PREDICATE_FORMS.map((form) => `predicate:${form}`),
  ...EffortSchema.options.map((effort) => `effort:${effort}`),
  "trigger:none",
  "trigger:effort_lte",
  "trigger:labels",
  "trigger:source",
  "trigger:all",
  "next:one",
  "next:list",
  "branches",
  "onFail:shorthand",
  "onFail:list",
  "onFail:entry-bare",
  "onFail:entry-when",
  "loop:far",
  "label:present",
  "label:absent",
  "position:negative-zero",
  "position:fraction",
  "description:absent",
  "description:empty",
  "description:present",
  "order:trigger-not-first",
  "order:edges-regrouped",
  "string:line-feed",
  "string:carriage-return",
  "string:line-separator",
  "string:quote",
  "string:backtick",
  "string:substitution",
  "string:lone-surrogate",
  "string:non-ascii",
];

/**
 * The grammar features one document exercises, in {@link GRAMMAR_FEATURES}' vocabulary.
 *
 * Read from the document, never from its print, so the coverage a suite asserts cannot depend on
 * the code under test.
 *
 * @param document - A valid document.
 * @returns The features it reaches.
 */
export function grammarFeatures(document: WorkflowDocument): Set<string> {
  const features = new Set<string>();
  const predicate = (value: Predicate) => {
    features.add(`predicate:${predicateForm(value)}`);
    if (value.kind === "effort") features.add(`effort:${value.value}`);
  };

  const conditions = Object.keys(document.trigger.conditions);
  if (conditions.length === 0) features.add("trigger:none");
  if (conditions.length === 3) features.add("trigger:all");
  for (const condition of conditions) features.add(`trigger:${condition}`);
  if (document.trigger.conditions.effort_lte !== undefined) {
    features.add(`effort:${document.trigger.conditions.effort_lte}`);
  }

  for (const node of document.nodes) {
    features.add(`stage:${calleeFor(node)}`);
    features.add(
      `description:${node.description === undefined ? "absent" : node.description === "" ? "empty" : "present"}`,
    );
    for (const coordinate of [node.position.x, node.position.y]) {
      if (Object.is(coordinate, -0)) features.add("position:negative-zero");
      if (!Number.isInteger(coordinate)) features.add("position:fraction");
    }
    nodeFeatures(node, features, predicate);
    edgeOptionFeatures(document, node.id, features);
  }

  for (const edge of document.edges) {
    features.add(edge.label === undefined ? "label:absent" : "label:present");
    if (edge.condition !== undefined) predicate(edge.condition);
    const shortcut = document.edges.some(
      (other) => other.kind !== "loop" && other.from === edge.to && other.to === edge.from,
    );
    if (edge.kind === "loop" && !shortcut) features.add("loop:far");
  }

  if (document.nodes[0].type !== "trigger") features.add("order:trigger-not-first");
  if (!isDeclarationOrder(document)) features.add("order:edges-regrouped");

  for (const value of strings(document)) stringFeatures(value, features);

  return features;
}

/**
 * Add the features of one node's type-dependent config.
 *
 * @param node - The node.
 * @param features - The set, added to in place.
 * @param predicate - Records a predicate's features.
 */
function nodeFeatures(
  node: WorkflowNode,
  features: Set<string>,
  predicate: (value: Predicate) => void,
): void {
  switch (node.type) {
    case "llm":
      features.add(`llm:${node.config.mode}`);
      features.add(node.config.routing.inherit_task === undefined ? "model:alias" : "model:task");
      return;
    case "infra":
      if (node.config.runner_pool !== undefined) features.add("infra:farm");
      if (node.config.command !== undefined) features.add("infra:cmd");
      if (node.config.runner_pool === undefined && node.config.command === undefined) {
        features.add("infra:bare");
      }
      return;
    case "flow": {
      const { kind, predicate: value } = node.config;
      const requires =
        value.kind === "checks" && value.op === "all_passed" && value.names !== undefined;
      features.add(`flow:${kind}:${requires ? "require" : "when"}`);
      predicate(value);
      return;
    }
    case "term":
      if (node.config.action === "open_pr_automerge") {
        features.add(`merge:${node.config.options.merge_method}`);
        features.add(`deleteBranch:${String(node.config.options.delete_branch)}`);
      }
      return;
    case "trigger":
      return;
  }
}

/**
 * Add the features of the edge options one stage writes: `next`, `branches` and `onFail`.
 *
 * @param document - The document.
 * @param id - The stage's id.
 * @param features - The set, added to in place.
 */
function edgeOptionFeatures(document: WorkflowDocument, id: string, features: Set<string>): void {
  const outgoing = document.edges.filter((edge) => edge.from === id);
  const defaults = outgoing.filter((edge) => edge.kind === "default");
  const loops = outgoing.filter((edge) => edge.kind === "loop");

  if (defaults.length === 1) features.add("next:one");
  if (defaults.length > 1) features.add("next:list");
  if (outgoing.some((edge) => edge.kind === "branch")) features.add("branches");

  const [only] = loops;
  const shorthand =
    loops.length === 1 &&
    only.condition?.kind === "checks" &&
    only.condition.op === "any_failed" &&
    only.condition.names === undefined;

  if (shorthand) features.add("onFail:shorthand");
  else if (loops.length > 0) {
    features.add("onFail:list");
    for (const loop of loops) {
      features.add(loop.condition === undefined ? "onFail:entry-bare" : "onFail:entry-when");
    }
  }
}

/**
 * A predicate's form: its kind, its operator, and whether a checks predicate names its checks.
 *
 * @param predicate - The predicate.
 * @returns `always`, `effort.lte`, `checks.any_failed+names`, …
 */
function predicateForm(predicate: Predicate): string {
  if (predicate.kind === "always") return "always";
  const names = predicate.kind === "checks" && predicate.names !== undefined ? "+names" : "";
  return `${predicate.kind}.${predicate.op}${names}`;
}

/**
 * Whether the document lists its edges in the order the stage calls declare them — stage order,
 * then `next`, `branches` and `onFail` — so that the layout block's edge order carries nothing the
 * calls do not.
 *
 * @param document - The document.
 * @returns `true` when the two orders agree.
 */
function isDeclarationOrder(document: WorkflowDocument): boolean {
  const declared = document.nodes.flatMap((node) =>
    (["default", "branch", "loop"] as const).flatMap((kind) =>
      document.edges.filter((edge) => edge.from === node.id && edge.kind === kind),
    ),
  );
  return declared.every((edge, index) => edge === document.edges[index]);
}

/**
 * Every string anywhere in a value.
 *
 * @param value - A JSON value.
 * @returns Its strings, depth first.
 */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(strings);
  return [];
}

/**
 * Add the features of one string: the characters a literal has to escape or keep.
 *
 * @param value - The string.
 * @param features - The set, added to in place.
 */
function stringFeatures(value: string, features: Set<string>): void {
  if (value.includes("\n")) features.add("string:line-feed");
  if (value.includes("\r")) features.add("string:carriage-return");
  if (value.includes(LINE_SEPARATOR) || value.includes(PARAGRAPH_SEPARATOR)) {
    features.add("string:line-separator");
  }
  if (value.includes('"')) features.add("string:quote");
  if (value.includes("`")) features.add("string:backtick");
  if (value.includes("${")) features.add("string:substitution");
  if (hasLoneSurrogate(value)) features.add("string:lone-surrogate");
  if ([...value].some((character) => character.charCodeAt(0) > 0x7f)) {
    features.add("string:non-ascii");
  }
}

/**
 * Whether a string holds half of a surrogate pair without the other half.
 *
 * @param value - The string.
 * @returns `true` for a high surrogate not followed by a low one, or a low surrogate not preceded by
 *   a high one.
 */
function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const next = value.charCodeAt(index + 1);

    if (code >= 0xdc00 && code <= 0xdfff) return true;
    if (code >= 0xd800 && code <= 0xdbff) {
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    }
  }

  return false;
}
