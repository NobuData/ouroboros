/**
 * Operation ⊇ DSL parity, certified from the schema itself (CD.6,
 * [#564](https://github.com/NobuData/ouroboros/issues/564)).
 *
 * Decision **W2** says the copilot edits a workflow through the same typed operations the canvas
 * and the code editor produce. That is only a promise worth making while the operations can say
 * everything the language can: a node type, an edge kind or a root key the DSL gains and no
 * operation can carry is a part of the language a conversation silently cannot reach.
 *
 * **Nothing here lists the language.** The constructs are read out of `dsl.schema.ts`'s zod
 * objects — the root's keys, the node skeleton and each type's config, the predicate kinds, a
 * terminal's options per action, the edge and the trigger — and every construct is then looked
 * for in a document that `checkOperation` actually produced from a schema-generated sample. So a
 * construct added to the schema is a construct this suite looks for without being edited, and one
 * no operation carries is reported by name ({@link parityGaps}). The suite proves that property
 * on itself: the same function, run over a doctored copy of the vocabulary with one construct the
 * operations have never heard of, reports exactly that construct.
 *
 * Three more things are certified beside it: **the round trip** (every golden and seeded
 * document, taken apart into operations, rebuilt from the empty draft and validated clean —
 * together they cover every node type, edge kind, trigger event, predicate kind and terminal
 * action the schema knows, which is asserted rather than assumed); **the validator is
 * load-bearing** (each kind of bad operation is bounced by `checkOperation`, and the same
 * operation applied with the gates removed yields a document the DSL validator rejects); and
 * **`set_guard` is a proposal**, not a gap — DSL v1 has no guard construct, so there is nothing
 * for an operation to reach.
 */

import { isDeepStrictEqual } from "node:util";

import type { z } from "zod";
import { z as zod } from "zod";

import { SCHEMA_STAGE_CODES } from "../../workflows/dsl.errors";
import { readFixture } from "../../workflows/dsl.golden.fixture";
import {
  EdgeKindSchema,
  EdgeSchema,
  NODE_CONFIG_SCHEMAS,
  NodeShapeSchema,
  NodeTypeSchema,
  PREDICATE_KINDS,
  PREDICATE_SCHEMAS,
  TERM_ACTIONS,
  TERM_OPTION_SCHEMAS,
  TriggerSchema,
  WorkflowRootSchema,
} from "../../workflows/dsl.schema";
import { SEED_DOCUMENT_TAGS, seededDocuments } from "../../workflows/dsl.seed.fixture";
import { validateWorkflowDocument } from "../../workflows/dsl.validator";
import {
  DraftOperationSchema,
  EMPTY_DRAFT,
  GUARD_KIND,
  OPERATION_KINDS,
  WRITE_KINDS,
  applyOperation,
  asDraftDocument,
  checkOperation,
  operationFromCall,
  type DraftDocument,
  type DraftOperation,
  type ProposedOperation,
} from "../copilot.operations";

/* ------------------------------------------------------------------ reading a zod schema */

/** The parts of a zod schema this suite reads; zod's own types do not expose them uniformly. */
interface Introspected {
  readonly def: { readonly type: string; readonly values?: readonly unknown[] };
  readonly shape?: Record<string, z.ZodType>;
  readonly options?: readonly unknown[];
  readonly element?: z.ZodType;
  readonly minValue?: number | null;
  unwrap?(): z.ZodType;
}

/** A schema, as something whose definition can be read. */
function read(schema: z.ZodType): Introspected {
  const seen: unknown = schema;
  return seen as Introspected;
}

/** A schema with any `optional` wrapper removed, and whether it had one. */
function required(schema: z.ZodType): { schema: z.ZodType; optional: boolean } {
  const seen = read(schema);
  if (seen.def.type === "optional" && seen.unwrap !== undefined) {
    return { schema: seen.unwrap(), optional: true };
  }
  return { schema, optional: false };
}

/** The values an enum or a literal admits; empty for anything else. */
function admitted(schema: z.ZodType): readonly unknown[] {
  const seen = read(schema);
  if (seen.def.type === "enum") return seen.options ?? [];
  if (seen.def.type === "literal") return seen.def.values ?? [];
  if (seen.def.type === "boolean") return [false, true];
  return [];
}

/** The first candidate a schema accepts. */
function firstAccepted(schema: z.ZodType, candidates: readonly unknown[]): unknown {
  const found = candidates.find((candidate) => schema.safeParse(candidate).success);
  if (found === undefined) {
    throw new Error(
      `No sample value satisfies a ${read(schema).def.type} schema — teach firstAccepted() one.`,
    );
  }
  return found;
}

/** Marks a key left out of a generated object. */
const ABSENT = Symbol("absent");

/**
 * Every value a schema's *vocabulary* distinguishes: the product of its enum members, its
 * optional keys (present and absent) and its booleans, with one sample for anything free-form.
 * An opaque `record` is `{}` — its real members are dispatched by {@link Vocabulary.dispatch}.
 *
 * @param schema - The schema.
 * @returns The variants.
 */
function variants(schema: z.ZodType): unknown[] {
  const seen = read(schema);
  switch (seen.def.type) {
    case "object": {
      let partial: Record<string, unknown>[] = [{}];
      for (const [key, member] of Object.entries(seen.shape ?? {})) {
        const { schema: inner, optional } = required(member);
        const values: unknown[] = [...(optional ? [ABSENT] : []), ...variants(inner)];
        partial = partial.flatMap((object) =>
          values.map((value) => (value === ABSENT ? object : { ...object, [key]: value })),
        );
      }
      return partial;
    }
    case "enum":
    case "literal":
    case "boolean":
      return [...admitted(schema)];
    case "array":
      return seen.element === undefined ? [[]] : variants(seen.element).map((value) => [value]);
    case "record":
      return [{}];
    case "string":
      return [firstAccepted(schema, ["a", "sample", "sample-1", "src/**", "x".repeat(16)])];
    case "number":
      return [firstAccepted(schema, [0, 1, seen.minValue ?? 0, 1000, 100000])];
    default:
      throw new Error(`variants() does not know how to sample a ${seen.def.type} schema.`);
  }
}

/** One construct of the language, and how to tell whether a value carries it. */
interface Facet {
  /** `node<llm>.config.routing.pinned_model`, `edge.kind=loop`. */
  readonly label: string;
  /** Whether a sample of the facet's family carries it. */
  in(sample: unknown): boolean;
}

/**
 * Every construct a schema declares: each key of each object, and each member of each enum.
 *
 * @param schema - The schema.
 * @param label - What the value at this place is called.
 * @param at - Reads the value at this place out of a family sample; `undefined` when absent.
 * @returns The facets, in schema order.
 */
function facetsOf(schema: z.ZodType, label: string, at: (sample: unknown) => unknown): Facet[] {
  const seen = read(required(schema).schema);
  switch (seen.def.type) {
    case "object":
      return Object.entries(seen.shape ?? {}).flatMap(([key, member]) => {
        const child = (sample: unknown): unknown => {
          const parent = at(sample);
          return parent !== null && typeof parent === "object"
            ? (parent as Record<string, unknown>)[key]
            : undefined;
        };
        return [
          { label: `${label}.${key}`, in: (sample: unknown) => child(sample) !== undefined },
          ...facetsOf(member, `${label}.${key}`, child),
        ];
      });
    case "array": {
      const first = (sample: unknown): unknown => {
        const list = at(sample);
        return Array.isArray(list) ? (list as unknown[])[0] : undefined;
      };
      return seen.element === undefined ? [] : facetsOf(seen.element, `${label}[]`, first);
    }
    default:
      return admitted(required(schema).schema).map((value) => ({
        label: `${label}=${String(value)}`,
        in: (sample: unknown) => at(sample) === value,
      }));
  }
}

/* ------------------------------------------------------------------ the vocabulary */

/** An opaque `record` field of a node config, and the closed schemas it is dispatched to. */
interface Dispatch {
  /** The config key — `predicate`, `options`. */
  readonly field: string;
  /** The members, by the name the DSL gives them. */
  readonly members: Readonly<Record<string, z.ZodType>>;
  /**
   * Which members a config may carry, when not all of them: a terminal's options are its own
   * action's. A fork takes any predicate, so it names none.
   */
  select?(config: Record<string, unknown>): readonly string[];
}

/**
 * The language, as `dsl.schema.ts` exports it. Held as a value so the suite can run its own
 * parity function over a doctored copy.
 */
interface Vocabulary {
  /** The document's frame. */
  readonly root: z.ZodType;
  /**
   * What each root key holds. The frame leaves `nodes` and `edges` as arrays of anything and
   * validates the elements one at a time (its docblock: *the pieces are these three schemas and
   * nothing else*), so the pairing is stated here once. A root key with no entry is a construct
   * only the base draft can supply.
   */
  readonly carried: Readonly<Record<string, z.ZodType>>;
  /** Each node type's config. */
  readonly nodeConfigs: Readonly<Record<string, z.ZodType>>;
  /** The second dispatch inside a config, by node type. */
  readonly dispatch: Readonly<Record<string, Dispatch>>;
  /** What an edge's opaque `condition` is dispatched to. */
  readonly conditions: Readonly<Record<string, z.ZodType>>;
}

/** The language as it is. */
const DSL: Vocabulary = {
  root: WorkflowRootSchema,
  carried: {
    trigger: WorkflowRootSchema.shape.trigger,
    nodes: NodeShapeSchema,
    edges: EdgeSchema,
  },
  nodeConfigs: NODE_CONFIG_SCHEMAS,
  dispatch: {
    flow: { field: "predicate", members: PREDICATE_SCHEMAS },
    term: {
      field: "options",
      members: TERM_OPTION_SCHEMAS,
      select: (config) => (typeof config.action === "string" ? [config.action] : []),
    },
  },
  conditions: PREDICATE_SCHEMAS,
};

/** Whether a value is an object with string keys. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The members of a dispatch a config may carry. */
function selected(dispatch: Dispatch, config: Record<string, unknown>): readonly string[] {
  return dispatch.select?.(config) ?? Object.keys(dispatch.members);
}

/** What a root key's element is, told by its shape: a node has a typed config, an edge two ends. */
function familyOf(vocabulary: Vocabulary, key: string): "node" | "edge" | "other" {
  const shape = read(vocabulary.carried[key]).shape ?? {};
  if ("config" in shape && "type" in shape) return "node";
  if ("from" in shape && "to" in shape) return "edge";
  return "other";
}

/**
 * Every sample of one root key's element: a node per type and config variant, an edge per kind
 * and condition, a trigger per event and condition set.
 *
 * @param vocabulary - The language.
 * @param key - The root key.
 * @returns The samples.
 */
function samplesOf(vocabulary: Vocabulary, key: string): Record<string, unknown>[] {
  const skeletons = variants(vocabulary.carried[key]).filter(isRecord);

  switch (familyOf(vocabulary, key)) {
    case "node":
      return skeletons.flatMap((node) => {
        const type = String(node.type);
        const config = vocabulary.nodeConfigs[type] as z.ZodType | undefined;
        const dispatch = vocabulary.dispatch[type] as Dispatch | undefined;
        const configs = (config === undefined ? [{}] : variants(config).filter(isRecord)).flatMap(
          (candidate) =>
            dispatch === undefined
              ? [candidate]
              : selected(dispatch, candidate).flatMap((name) =>
                  variants(dispatch.members[name]).map((member) => ({
                    ...candidate,
                    [dispatch.field]: member,
                  })),
                ),
        );
        return configs.map((filled) => ({ ...node, id: "subject", config: filled }));
      });
    case "edge":
      return skeletons.flatMap((edge) => {
        const joined = { ...edge, from: "left", to: "right" };
        return "condition" in edge
          ? Object.values(vocabulary.conditions).flatMap((member) =>
              variants(member).map((condition) => ({ ...joined, condition })),
            )
          : [joined];
      });
    default:
      return skeletons;
  }
}

/**
 * Every construct one root key's element can carry.
 *
 * @param vocabulary - The language.
 * @param key - The root key.
 * @returns The facets.
 */
function constructsOf(vocabulary: Vocabulary, key: string): Facet[] {
  const schema = vocabulary.carried[key];
  const family = familyOf(vocabulary, key);
  const name = family === "other" ? key : family;
  const facets = facetsOf(schema, name, (sample) => sample);

  /** The facets of a dispatched member, guarded by the sample really being that member. */
  const dispatched = (
    label: string,
    member: z.ZodType,
    value: (sample: unknown) => unknown,
    allowed: (sample: unknown) => boolean,
  ): Facet[] => {
    const guarded = (sample: unknown): unknown =>
      allowed(sample) && member.safeParse(value(sample)).success ? value(sample) : undefined;
    return [
      { label, in: (sample) => guarded(sample) !== undefined },
      ...facetsOf(member, label, guarded),
    ];
  };

  if (family === "node") {
    for (const [type, config] of Object.entries(vocabulary.nodeConfigs)) {
      const configOf = (sample: unknown): unknown =>
        isRecord(sample) && sample.type === type ? sample.config : undefined;
      facets.push(...facetsOf(config, `node<${type}>.config`, configOf));

      const dispatch = vocabulary.dispatch[type] as Dispatch | undefined;
      if (dispatch === undefined) continue;
      for (const [member, memberSchema] of Object.entries(dispatch.members)) {
        facets.push(
          ...dispatched(
            `node<${type}>.config.${dispatch.field}<${member}>`,
            memberSchema,
            (sample) => {
              const held = configOf(sample);
              return isRecord(held) ? held[dispatch.field] : undefined;
            },
            (sample) => {
              const held = configOf(sample);
              return isRecord(held) && selected(dispatch, held).includes(member);
            },
          ),
        );
      }
    }
  }

  if (family === "edge") {
    for (const [member, memberSchema] of Object.entries(vocabulary.conditions)) {
      facets.push(
        ...dispatched(
          `edge.condition<${member}>`,
          memberSchema,
          (sample) => (isRecord(sample) ? sample.condition : undefined),
          () => true,
        ),
      );
    }
  }

  return facets;
}

/* ------------------------------------------------------------------ reaching a construct */

/** A stage for an edge to join, and for a `set_stage` to replace. */
function placeholder(id: string): Record<string, unknown> {
  return { id, type: "infra", title: "Placeholder", position: { x: 0, y: 0 }, config: {} };
}

/** The drafts a sample is offered to: nothing yet, and one already holding what it would name. */
const BASES: readonly DraftDocument[] = [
  EMPTY_DRAFT,
  {
    ...EMPTY_DRAFT,
    trigger: { event: "ticket_queued", conditions: {} },
    nodes: [placeholder("subject"), placeholder("left"), placeholder("right")],
  },
];

/** Every `{kind, params}` the operation vocabulary could carry one object in. */
function envelopesFor(sample: unknown): ProposedOperation[] {
  return DraftOperationSchema.options.flatMap((option) => {
    const [kind] = admitted(option.shape.kind);
    return Object.keys(option.shape.params.shape).map((parameter) => ({
      kind: String(kind),
      params: { [parameter]: sample },
    }));
  });
}

/**
 * The operations that carry a sample into a draft: accepted by `checkOperation`, present
 * verbatim in the document afterwards, and with nothing the DSL validator's schema stage holds
 * against the place it landed.
 *
 * @param key - The root key the sample belongs under.
 * @param sample - The sample.
 * @param check - The operation validator — the real one, except in the negative control.
 * @returns The kinds of the operations that carried it; empty when none can.
 */
function carriers(key: string, sample: unknown, check: typeof checkOperation): string[] {
  const reached = new Set<string>();

  for (const base of BASES) {
    for (const envelope of envelopesFor(sample)) {
      const outcome = check(base, envelope);
      if (!outcome.ok) continue;

      const held = outcome.document[key];
      const index = Array.isArray(held)
        ? held.findIndex((element) => isDeepStrictEqual(element, sample))
        : -1;
      const landed = Array.isArray(held) ? index >= 0 : isDeepStrictEqual(held, sample);
      if (!landed) continue;

      const pointer = Array.isArray(held) ? `/${key}/${String(index)}` : `/${key}`;
      const refused = outcome.documentErrors.some(
        (error) => SCHEMA_STAGE_CODES.has(error.code) && error.path.startsWith(pointer),
      );
      if (!refused) reached.add(envelope.kind);
    }
  }

  return [...reached];
}

/** What the parity function found. */
interface Parity {
  /** How many constructs the vocabulary declares. */
  readonly constructs: number;
  /** The constructs no operation carries, by label. */
  readonly gaps: string[];
  /** Which operations carry something under each root key. */
  readonly carriedBy: Record<string, string[]>;
}

/**
 * Hold a vocabulary to the operations: every construct it declares must appear in a document
 * some operation produced.
 *
 * A root key the vocabulary pairs with no element schema can only come from the base draft, so
 * it is reachable exactly when {@link EMPTY_DRAFT} already holds each value it admits.
 *
 * @param vocabulary - The language.
 * @param check - The operation validator.
 * @returns The constructs counted, and the ones no operation reaches.
 */
function parityGaps(vocabulary: Vocabulary, check: typeof checkOperation = checkOperation): Parity {
  const gaps: string[] = [];
  const carriedBy: Record<string, string[]> = {};
  let constructs = 0;

  for (const [key, member] of Object.entries(read(vocabulary.root).shape ?? {})) {
    constructs += 1;

    if (!(key in vocabulary.carried)) {
      const fixed = admitted(member);
      const pinned = fixed.length > 0 && fixed.every((value) => EMPTY_DRAFT[key] === value);
      if (!pinned) gaps.push(`root.${key}`);
      continue;
    }

    const kinds = new Set<string>();
    const accepted = samplesOf(vocabulary, key).filter((sample) => {
      const by = carriers(key, sample, check);
      by.forEach((kind) => kinds.add(kind));
      return by.length > 0;
    });
    carriedBy[key] = [...kinds].sort();
    if (accepted.length === 0) gaps.push(`root.${key}`);

    for (const facet of constructsOf(vocabulary, key)) {
      constructs += 1;
      if (!accepted.some((sample) => facet.in(sample))) gaps.push(facet.label);
    }
  }

  return { constructs, gaps, carriedBy };
}

/* ------------------------------------------------------------------ the round trip */

/** The documents the round trip rebuilds: every valid golden fixture and every seeded workflow. */
const DOCUMENTS: readonly (readonly [string, DraftDocument])[] = [
  ...["minimal", "infra-bare", "predicate-kinds", "change-paths", "standard-fix"].map(
    (name) => [`golden ${name}`, asDraftDocument(readFixture(`valid/${name}.json`))] as const,
  ),
  ...SEED_DOCUMENT_TAGS.flatMap(([tag, , slug]) =>
    seededDocuments(tag).map(
      (document) => [`seeded ${slug} (${tag})`, asDraftDocument(document)] as const,
    ),
  ),
];

/** The operations that build a document from the empty draft: its trigger, its stages, its edges. */
function operationsFor(target: DraftDocument): ProposedOperation[] {
  return [
    { kind: "set_trigger", params: { trigger: target.trigger } },
    ...target.nodes.map((node) => ({ kind: "add_stage", params: { node } })),
    ...target.edges.map((edge) => ({ kind: "add_edge", params: { edge } })),
  ];
}

/**
 * Apply a sequence through the validator, as the exchange does.
 *
 * @param start - The draft before.
 * @param operations - The operations, in order.
 * @returns The draft after.
 * @throws {Error} Naming the operation and the validator's sentence when one bounces.
 */
function build(start: DraftDocument, operations: readonly ProposedOperation[]): DraftDocument {
  return operations.reduce((document, operation) => {
    const outcome = checkOperation(document, operation);
    if (!outcome.ok) throw new Error(`${operation.kind} bounced: ${outcome.message}`);
    return outcome.document;
  }, start);
}

/** Every value found under a key anywhere in some documents' collections. */
function gathered(
  collection: "nodes" | "edges",
  pick: (element: Record<string, unknown>) => unknown,
): unknown[] {
  const found = DOCUMENTS.flatMap(([, document]) =>
    document[collection].filter(isRecord).map(pick),
  ).filter((value) => value !== undefined);
  return [...new Set(found)].sort();
}

/* ------------------------------------------------------------------ the validator, removed */

/**
 * The transformation with every gate removed: no shape check, no node probe, no precondition —
 * what applying an operation would be if nothing validated it first.
 *
 * @param document - The draft before.
 * @param operation - The operation, as proposed.
 * @returns The draft after.
 */
function applyUnchecked(document: DraftDocument, operation: ProposedOperation): DraftDocument {
  const { params } = operation;
  switch (operation.kind) {
    case "add_stage":
      return { ...document, nodes: [...document.nodes, params.node] };
    case "set_stage":
      return {
        ...document,
        nodes: document.nodes.map((node) =>
          isRecord(node) && isRecord(params.node) && node.id === params.node.id
            ? params.node
            : node,
        ),
      };
    case "add_edge":
      return { ...document, edges: [...document.edges, params.edge] };
    case "set_trigger":
      return { ...document, trigger: params.trigger };
    default:
      throw new Error(`applyUnchecked() has no case for ${operation.kind}.`);
  }
}

/** A whole, valid draft the bad operations are proposed against. */
const WHOLE = asDraftDocument(readFixture("valid/minimal.json"));

/** A stage that is fine, for the cases that spoil one thing about it. */
const SOUND_NODE = {
  id: "implement",
  type: "llm",
  title: "Implement",
  position: { x: 120, y: 0 },
  config: {
    mode: "prompt",
    prompt_template: "Make the change the ticket asks for.",
    routing: { inherit_task: "implement" },
    limits: { max_retries: 1, token_budget: 200_000 },
    permissions: { push_fixup: false, touch_ci: false },
  },
};

/** One kind of operation the validator must bounce, and the part of its sentence that names why. */
const BAD_OPERATIONS: readonly (readonly [string, ProposedOperation, RegExp])[] = [
  [
    "a stage with a key the node skeleton does not have",
    { kind: "add_stage", params: { node: { ...SOUND_NODE, colour: "red" } } },
    /colour/,
  ],
  [
    "a stage of a type the language does not have",
    { kind: "add_stage", params: { node: { ...SOUND_NODE, type: "human" } } },
    /params\.node\.type/,
  ],
  [
    "a model stage whose config lacks its prompt",
    {
      kind: "add_stage",
      params: {
        node: {
          ...SOUND_NODE,
          config: { ...SOUND_NODE.config, prompt_template: undefined },
        },
      },
    },
    /prompt_template/,
  ],
  [
    "a model stage whose config carries a key the type does not have",
    {
      kind: "add_stage",
      params: { node: { ...SOUND_NODE, config: { ...SOUND_NODE.config, temperature: 0.2 } } },
    },
    /temperature/,
  ],
  [
    "a model stage with no routing at all",
    {
      kind: "add_stage",
      params: { node: { ...SOUND_NODE, config: { ...SOUND_NODE.config, routing: {} } } },
    },
    /routing/,
  ],
  [
    "a stage whose id is already taken",
    {
      kind: "add_stage",
      params: { node: { ...SOUND_NODE, id: "start" } },
    },
    /already exists/,
  ],
  [
    "a replacement that turns a stage into a malformed one",
    {
      kind: "set_stage",
      params: {
        node: { id: "done", type: "term", title: "Done", position: { x: 240, y: 0 }, config: {} },
      },
    },
    /action/,
  ],
  [
    "an edge to a stage that is not there",
    { kind: "add_edge", params: { edge: { from: "start", to: "nowhere", kind: "default" } } },
    /edge\.to "nowhere" names no stage/,
  ],
  [
    "an edge of a kind the language does not have",
    { kind: "add_edge", params: { edge: { from: "done", to: "start", kind: "fallback" } } },
    /params\.edge\.kind/,
  ],
  [
    "a trigger on an event the language does not have",
    { kind: "set_trigger", params: { trigger: { event: "pr_opened", conditions: {} } } },
    /params\.trigger\.event/,
  ],
  [
    "a trigger with a condition the language does not have",
    {
      kind: "set_trigger",
      params: { trigger: { event: "ticket_queued", conditions: { author: "kenji" } } },
    },
    /author/,
  ],
];

/* ------------------------------------------------------------------ the suite */

describe("copilot certification — operation ⊇ DSL parity (#564)", () => {
  describe("every construct the schema declares is reachable through an operation", () => {
    const parity = parityGaps(DSL);

    it("finds no construct of the language that no operation carries", () => {
      expect(parity.gaps).toEqual([]);
    });

    it("reads the language out of the schema rather than out of a list", () => {
      // Guards the enumeration itself: were the walk to come back near-empty — a zod upgrade
      // that renamed `def`, say — `gaps` would be vacuously empty. Each count is derived from the
      // schema objects, so none of these numbers is written down here.
      const labels = new Set(
        Object.keys(DSL.carried).flatMap((key) =>
          constructsOf(DSL, key).map((facet) => facet.label),
        ),
      );

      for (const type of NodeTypeSchema.options) expect(labels).toContain(`node.type=${type}`);
      for (const kind of EdgeKindSchema.options) expect(labels).toContain(`edge.kind=${kind}`);
      for (const event of TriggerSchema.shape.event.options) {
        expect(labels).toContain(`trigger.event=${event}`);
      }
      for (const key of Object.keys(TriggerSchema.shape.conditions.shape)) {
        expect(labels).toContain(`trigger.conditions.${key}`);
      }
      for (const kind of PREDICATE_KINDS) {
        expect(labels).toContain(`node<flow>.config.predicate<${kind}>`);
        expect(labels).toContain(`edge.condition<${kind}>`);
      }
      for (const action of TERM_ACTIONS) {
        expect(labels).toContain(`node<term>.config.action=${action}`);
        expect(labels).toContain(`node<term>.config.options<${action}>`);
      }
      for (const [type, config] of Object.entries(NODE_CONFIG_SCHEMAS)) {
        for (const key of Object.keys(config.shape)) {
          expect(labels).toContain(`node<${type}>.config.${key}`);
        }
      }
      for (const key of Object.keys(NodeShapeSchema.shape)) expect(labels).toContain(`node.${key}`);
      for (const key of Object.keys(EdgeSchema.shape)) expect(labels).toContain(`edge.${key}`);

      expect(parity.constructs).toBe(labels.size + Object.keys(WorkflowRootSchema.shape).length);
    });

    it("pairs every node type with a config schema, and nothing else", () => {
      expect(Object.keys(NODE_CONFIG_SCHEMAS).sort()).toEqual([...NodeTypeSchema.options].sort());
    });

    it("carries each root collection through the operations that name it", () => {
      expect(parity.carriedBy).toEqual({
        trigger: ["set_trigger"],
        nodes: ["add_stage", "set_stage"],
        edges: ["add_edge"],
      });
    });

    it("leaves only the removals carrying nothing — and they take ids, not constructs", () => {
      const carrying = new Set(Object.values(parity.carriedBy).flat());
      const idle = OPERATION_KINDS.filter((kind) => !carrying.has(kind));

      expect(idle).toEqual(["remove_stage", "remove_edge"]);
      for (const option of DraftOperationSchema.options) {
        const [kind] = admitted(option.shape.kind);
        if (!idle.includes(kind as (typeof idle)[number])) continue;
        const parameters = Object.values<z.ZodType>(option.shape.params.shape);
        const kinds = parameters.map((parameter) => read(parameter).def.type);
        expect(kinds.every((type) => type === "string")).toBe(true);
      }
    });

    it("holds the operation schema and the declared kinds to one list", () => {
      const declared = DraftOperationSchema.options.map((option) =>
        String(admitted(option.shape.kind)[0]),
      );
      expect(declared).toEqual([...OPERATION_KINDS]);
    });
  });

  describe("a construct without an operation fails — the suite's own negative controls", () => {
    it("reports a root key no operation writes", () => {
      const doctored: Vocabulary = {
        ...DSL,
        root: WorkflowRootSchema.extend({ guards: zod.array(zod.unknown()) }),
      };

      expect(parityGaps(doctored).gaps).toEqual(["root.guards"]);
    });

    it("reports a root collection whose element no operation takes", () => {
      const Guard = zod.strictObject({ name: zod.enum(["spend_cap", "never_auto_merge"]) });
      const doctored: Vocabulary = {
        ...DSL,
        root: WorkflowRootSchema.extend({ guards: zod.array(zod.unknown()) }),
        carried: { ...DSL.carried, guards: Guard },
      };

      expect(parityGaps(doctored).gaps).toEqual([
        "root.guards",
        "guards.name",
        "guards.name=spend_cap",
        "guards.name=never_auto_merge",
      ]);
    });

    it("reports a second DSL version the base draft does not start from", () => {
      const doctored: Vocabulary = {
        ...DSL,
        root: WorkflowRootSchema.extend({ dsl_version: zod.enum(["1.0", "1.1"]) }),
      };

      expect(parityGaps(doctored).gaps).toEqual(["root.dsl_version"]);
    });

    it("reports a node type the operations' node does not admit", () => {
      const Human = zod.strictObject({ assignee: zod.string().min(1) });
      const doctored: Vocabulary = {
        ...DSL,
        carried: {
          ...DSL.carried,
          nodes: NodeShapeSchema.extend({
            type: zod.enum([...NodeTypeSchema.options, "human"]),
          }),
        },
        nodeConfigs: { ...NODE_CONFIG_SCHEMAS, human: Human },
      };

      expect(parityGaps(doctored).gaps).toEqual(["node.type=human", "node<human>.config.assignee"]);
    });

    it("reports an edge kind the operations' edge does not admit", () => {
      const doctored: Vocabulary = {
        ...DSL,
        carried: {
          ...DSL.carried,
          edges: EdgeSchema.extend({
            kind: zod.enum([...EdgeKindSchema.options, "fallback"]),
          }),
        },
      };

      expect(parityGaps(doctored).gaps).toEqual(["edge.kind=fallback"]);
    });

    it("reports a trigger event and a trigger condition the operations' trigger does not admit", () => {
      const doctored: Vocabulary = {
        ...DSL,
        carried: {
          ...DSL.carried,
          trigger: zod.strictObject({
            event: zod.enum([...TriggerSchema.shape.event.options, "pr_opened"]),
            conditions: TriggerSchema.shape.conditions.extend({
              author: zod.string().min(1).optional(),
            }),
          }),
        },
      };

      expect(parityGaps(doctored).gaps).toEqual([
        "trigger.event=pr_opened",
        "trigger.conditions.author",
      ]);
    });

    it("reports a predicate kind and a terminal action the node probe refuses", () => {
      const Author = zod.strictObject({ kind: zod.literal("author"), op: zod.enum(["is"]) });
      const doctored: Vocabulary = {
        ...DSL,
        nodeConfigs: {
          ...NODE_CONFIG_SCHEMAS,
          term: NODE_CONFIG_SCHEMAS.term.extend({
            action: zod.enum([...TERM_ACTIONS, "close_ticket"]),
          }),
        },
        dispatch: {
          flow: { ...DSL.dispatch.flow, members: { ...PREDICATE_SCHEMAS, author: Author } },
          term: {
            ...DSL.dispatch.term,
            members: { ...TERM_OPTION_SCHEMAS, close_ticket: zod.strictObject({}) },
          },
        },
        conditions: { ...PREDICATE_SCHEMAS, author: Author },
      };

      expect(parityGaps(doctored).gaps).toEqual([
        "node<flow>.config.predicate<author>",
        "node<flow>.config.predicate<author>.kind",
        "node<flow>.config.predicate<author>.kind=author",
        "node<flow>.config.predicate<author>.op",
        "node<flow>.config.predicate<author>.op=is",
        "node<term>.config.action=close_ticket",
        "node<term>.config.options<close_ticket>",
        "edge.condition<author>",
        "edge.condition<author>.kind",
        "edge.condition<author>.kind=author",
        "edge.condition<author>.op",
        "edge.condition<author>.op=is",
      ]);
    });

    it("reports everything once the operation validator accepts nothing", () => {
      const parity = parityGaps(DSL, () => ({ ok: false, message: "refused" }));

      expect(parity.gaps).toHaveLength(parity.constructs - 1);
      expect(parity.gaps).not.toContain("root.dsl_version");
    });
  });

  describe("set_guard is a proposal, not a construct the operations miss", () => {
    it("is in the copilot's vocabulary and outside the document's", () => {
      // The DSL has no guard construct: no root key, node type or config key holds one. So the
      // guard tool has nothing in the document to reach, and its absence from the operations is
      // the vocabulary being honest — the exchange records it as `proposed` and never applies it.
      expect(WRITE_KINDS).toEqual([...OPERATION_KINDS, GUARD_KIND]);
      expect(OPERATION_KINDS).not.toContain(GUARD_KIND);
      expect(operationFromCall(GUARD_KIND, { guard: "spend_cap" })).toBeUndefined();
      expect(
        DraftOperationSchema.safeParse({ kind: GUARD_KIND, params: { guard: "spend_cap" } })
          .success,
      ).toBe(false);

      const labels = [
        ...Object.keys(WorkflowRootSchema.shape).map((key) => `root.${key}`),
        ...Object.keys(DSL.carried).flatMap((key) =>
          constructsOf(DSL, key).map((facet) => facet.label),
        ),
      ];
      expect(labels.filter((label) => /guard/i.test(label))).toEqual([]);
    });

    it("is refused by the operation validator rather than applied", () => {
      const outcome = checkOperation(WHOLE, {
        kind: GUARD_KIND,
        params: { guard: "spend_cap", value: 500 },
      });

      expect(outcome.ok).toBe(false);
    });
  });

  describe("round trip: operations → draft → validator clean", () => {
    it.each(DOCUMENTS)("rebuilds the %s document from the empty draft", (_name, target) => {
      expect(validateWorkflowDocument(target).errors).toEqual([]);

      const built = build(EMPTY_DRAFT, operationsFor(target));

      expect(built).toEqual(target);
      const verdict = validateWorkflowDocument(built);
      expect(verdict.errors).toEqual([]);
      expect(verdict.valid).toBe(true);
    });

    it.each(DOCUMENTS)("takes the %s document apart again with the removals", (_name, target) => {
      const edges = target.edges.filter(isRecord);
      const withoutEdges = build(
        target,
        edges.map((edge) => ({ kind: "remove_edge", params: { from: edge.from, to: edge.to } })),
      );
      expect(withoutEdges).toEqual({ ...target, edges: [] });

      // Removing a stage takes its edges with it, so the whole document comes apart by stages alone.
      const emptied = build(
        target,
        target.nodes
          .filter(isRecord)
          .map((node) => ({ kind: "remove_stage", params: { id: node.id } })),
      );
      expect(emptied).toEqual({ ...target, nodes: [], edges: [] });
    });

    it.each(DOCUMENTS)("replaces every stage of the %s document with itself", (_name, target) => {
      const replaced = build(
        target,
        target.nodes.map((node) => ({ kind: "set_stage", params: { node } })),
      );

      expect(replaced).toEqual(target);
    });

    it("covers, between the documents, every type, kind, event and action the schema knows", () => {
      const configs = (type: string, key: string): unknown[] =>
        gathered("nodes", (node) =>
          node.type === type && isRecord(node.config) ? node.config[key] : undefined,
        );
      const kindOf = (value: unknown): unknown => (isRecord(value) ? value.kind : undefined);
      const events = DOCUMENTS.map(([, document]) =>
        isRecord(document.trigger) ? document.trigger.event : undefined,
      );

      expect(gathered("nodes", (node) => node.type)).toEqual([...NodeTypeSchema.options].sort());
      expect(gathered("edges", (edge) => edge.kind)).toEqual([...EdgeKindSchema.options].sort());
      expect([...new Set(events)].sort()).toEqual([...TriggerSchema.shape.event.options].sort());
      expect(configs("term", "action")).toEqual([...TERM_ACTIONS].sort());
      expect(
        [
          ...new Set([
            ...configs("flow", "predicate").map(kindOf),
            ...gathered("edges", (edge) => kindOf(edge.condition)),
          ]),
        ].sort(),
      ).toEqual([...PREDICATE_KINDS].sort());
    });
  });

  describe("the operation validator is load-bearing", () => {
    it("starts from a draft that validates", () => {
      expect(validateWorkflowDocument(WHOLE).errors).toEqual([]);
    });

    it.each(BAD_OPERATIONS)("bounces %s", (_name, operation, why) => {
      const outcome = checkOperation(WHOLE, operation);

      expect(outcome.ok).toBe(false);
      expect(outcome.ok ? "" : outcome.message).toMatch(why);
    });

    it.each(BAD_OPERATIONS)(
      "would store an invalid draft for %s were the validator removed",
      (_name, operation) => {
        const unchecked = applyUnchecked(WHOLE, operation);
        const verdict = validateWorkflowDocument(unchecked);

        expect(unchecked).not.toEqual(WHOLE);
        expect(verdict.valid).toBe(false);
        expect(verdict.errors.length).toBeGreaterThan(0);
      },
    );

    it("is the shape gate, not the transformation, that refuses a malformed object", () => {
      // `applyOperation` trusts its argument to be validated: handed the same malformed stage
      // directly — the schema gate and the node probe skipped — it writes it, and the DSL
      // validator rejects what it wrote.
      const malformed = {
        kind: "add_stage",
        params: { node: { ...SOUND_NODE, type: "human", colour: "red" } },
      } as unknown as DraftOperation;

      const applied = applyOperation(WHOLE, malformed);

      expect(applied.ok).toBe(true);
      expect(validateWorkflowDocument(applied.ok ? applied.document : WHOLE).valid).toBe(false);
    });

    it("turns the round trip red when a bounce is ignored", () => {
      // The round trip's own check, with the validator's verdict discarded for one bad stage:
      // the built draft no longer validates, so a suite run without the validator cannot be green.
      const [name, target] = DOCUMENTS[0];
      const spoiled = applyUnchecked(build(EMPTY_DRAFT, operationsFor(target)), {
        kind: "add_stage",
        params: { node: { ...SOUND_NODE, config: {} } },
      });

      expect(name).toBe("golden minimal");
      expect(() =>
        build(EMPTY_DRAFT, [
          ...operationsFor(target),
          { kind: "add_stage", params: { node: { ...SOUND_NODE, config: {} } } },
        ]),
      ).toThrow(/add_stage bounced/);
      expect(validateWorkflowDocument(spoiled).valid).toBe(false);
    });
  });
});
