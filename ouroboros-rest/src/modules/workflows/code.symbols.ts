/**
 * The code view's symbol table — W.1 ([#177](https://github.com/NobuData/ouroboros/issues/177)).
 *
 * Mockup 05's editor completes and documents what an author types: stage calls, each stage's
 * options, enum values, predicate forms, and the `route.task(name: TaskKind): ModelRoute` card.
 * Decision **C5** says that comes from what is already on disk rather than from a language server,
 * and this file is where it is assembled:
 *
 * ```
 * code.grammar.ts  which words the language has, and where each lives in the schema
 * v1.json          each word's type, values and description        (code.symbols.schema.ts reads it)
 * catalog          the workspace's task-route and skill names        (advice, decision P7)
 *        └──▶ CodeSymbolTable { scopes: what to offer where, symbols: what a hover card says }
 * ```
 *
 * ---------------------------------------------------------------------------
 * ## Why a table served by the API rather than one built into the UI
 *
 * Two of the three sources live here, and the third is per workspace: `task_kinds` changes when
 * an operator edits the routing matrix. So `GET /api/v1/workflows/code-symbols` builds the static
 * part once at boot, beside the stage catalog, and merges the suggestions per request. A key added
 * to `STAGE_OPTIONS`, a value added to a schema `enum`, or a task kind added to the matrix is in
 * the next answer, with no edit to the UI.
 *
 * ## Scopes and symbols
 *
 * A **scope** is a place in a file, named the way `ouroboros-ui` names the cursor's position:
 *
 * | Scope | Where | Offers |
 * |---|---|---|
 * | `<base>.options` | a key position in an options object | its keys |
 * | `<base>.<key>` | the value of that key | its values, forms or snippets |
 * | `route.methods`, `effort.constants` | after `route.`, `effort.` | methods, constants |
 * | `predicate.subjects`, `predicate.<kind>` | after `i.`, `i.<kind>.` in a predicate | subjects, methods |
 * | `condition.subjects`, `condition.<subject>` | the same, in the trigger's `when` | subjects, methods |
 * | `route.task` | inside `route.task("…")` | the workspace's task routes |
 * | `source.values` | inside a source method's argument | tracker kinds |
 *
 * `<base>` is `loop` (`defineLoop`'s options), `trigger`, `stage.<callee>`, `permissions` or
 * `edge` (one `branches` or `onFail` entry). A **symbol** is something a hover card describes,
 * named the same way: `defineLoop`, `stage.llm`, `stage.llm.retries`, `route.task`, `effort.M`,
 * `predicate.effort.lte`. A completion that names a symbol shares its card.
 *
 * ## Nothing is invented
 *
 * Every doc is a `description` in the schema. A symbol whose location has none has a signature
 * and no doc; a name that is not a symbol has no card at all, which `ouroboros-ui` shows as
 * nothing. Mockup 05's card adds *"Falls back to the tenant default chain."* — routing has no such
 * chain (`ResolutionService.resolve` answers `route_not_found` for an unrouted task kind), so the
 * served doc is the schema's first sentence only.
 */

import { deepFreeze } from "./catalog.presentation";
import type { StageSuggestions } from "./catalog.resources";
import { publishedSchemaId, type JsonSchema } from "./catalog.schema";
import {
  DEFINE_LOOP,
  DEFINE_LOOP_FIELD,
  DEFINE_LOOP_FIELDS,
  DEFINE_LOOP_OPTIONS,
  EDGE_ENTRY_FIELDS,
  EDGE_ENTRY_OPTIONS,
  EFFORT_CONSTANTS,
  EFFORT_FIELD,
  NODE_ID_FIELD,
  PERMISSION_KEYS,
  PERMISSIONS_FIELD,
  PREDICATE_FIELD,
  PREDICATE_METHODS,
  PREDICATE_PARAMETER,
  ROUTE_METHODS,
  ROUTE_RESULT_TYPE,
  ROUTE_SIGNATURES,
  ROUTING_FIELD,
  SOURCE_KIND_FIELD,
  STAGE_CALLEE_FIELDS,
  STAGE_CALLEES,
  STAGE_OPTION_FIELDS,
  STAGE_OPTIONS,
  TRIGGER_CONDITION_METHODS,
  TRIGGER_CONDITIONS_FIELD,
  TRIGGER_EVENTS,
  TRIGGER_FIELDS,
  TRIGGER_OPTIONS,
  type StageCallee,
} from "./code.grammar";
import { printPredicate } from "./code.predicates";
import {
  describe,
  locate,
  referenced,
  spelledValues,
  spellType,
  typeName,
  type ValueSpelling,
} from "./code.symbols.schema";

/**
 * What a completion inserts, as the editor draws it.
 *
 * `value` is a string the editor quotes unless the cursor is already inside quotes; every other
 * kind is inserted as written.
 */
export type CodeCompletionKind =
  "function" | "method" | "property" | "constant" | "value" | "snippet";

/** One thing offered at a scope. */
export interface CodeCompletion {
  /** The text shown, and inserted. */
  readonly label: string;
  /** How it is drawn and inserted. */
  readonly kind: CodeCompletionKind;
  /** The symbol whose card describes it, when there is one. */
  readonly symbol?: string;
  /** A workspace name offered as advice (decision **P7**): a name not offered is still valid. */
  readonly suggestion?: boolean;
}

/** Everything offered at one place in a file. */
export interface CodeScope {
  /** The place — see this file's header. */
  readonly scope: string;
  /** In the order the grammar and the schema list them. */
  readonly completions: readonly CodeCompletion[];
}

/** How a signature part is coloured: the mockup's `sig-fn`, `sig-ty`, and plain text. */
export type SignatureRole = "name" | "type" | "text";

/** One run of a signature. */
export interface SignaturePart {
  /** The text. */
  readonly text: string;
  /** Its colour. */
  readonly role: SignatureRole;
}

/** What a hover card says about one symbol. */
export interface CodeSymbol {
  /** The symbol — see this file's header. */
  readonly symbol: string;
  /** `route.task(name: TaskKind): ModelRoute`, in parts. */
  readonly signature: readonly SignaturePart[];
  /** The schema's description, verbatim. Absent when the schema has none. */
  readonly doc?: string;
}

/** `GET /api/v1/workflows/code-symbols`. */
export interface CodeSymbolTable {
  /** The `$id` of the schema every type, value and doc was read from. */
  readonly schemaId: string;
  /** What to offer, by place. */
  readonly scopes: readonly CodeScope[];
  /** What a hover card says, by symbol. */
  readonly symbols: readonly CodeSymbol[];
}

/** The option keys each callee takes — `STAGE_OPTIONS`' shape, replaceable for the spec. */
export type StageOptionsTable = { readonly [C in StageCallee]: readonly string[] };

/** Which scope each list of workspace suggestions fills. */
export const SUGGESTION_SCOPES = {
  skills: "stage.llm.skill",
  taskRoutes: `route.${ROUTE_METHODS.inherit_task}`,
} as const satisfies Record<keyof StageSuggestions, string>;

/** A signature run in the symbol's own colour. */
const named = (text: string): SignaturePart => ({ text, role: "name" });

/** A signature run in the type colour. */
const typed = (text: string): SignaturePart => ({ text, role: "type" });

/** A plain signature run. */
const plain = (text: string): SignaturePart => ({ text, role: "text" });

/** The schema-derived pieces more than one scope needs, read once per build. */
interface Vocabulary {
  /** What a predicate-valued key offers: `() => true`, `(i) => i.effort.`, … */
  readonly predicateForms: readonly CodeCompletion[];
  /** What the trigger's `when` offers: `(i) => i.effort.`, … */
  readonly conditionForms: readonly CodeCompletion[];
  /** What `model:` offers: `route.task("")`, `route.alias("")`. */
  readonly routeSnippets: readonly CodeCompletion[];
}

/** A table being assembled: scopes and symbols in first-seen order. */
class TableDraft {
  private readonly scopes = new Map<string, CodeCompletion[]>();
  private readonly symbols = new Map<string, CodeSymbol>();

  /**
   * @param schema - The published document every location is read from.
   */
  constructor(readonly schema: JsonSchema) {}

  /**
   * Make sure a scope exists, even with nothing offered yet.
   *
   * @param scope - The scope.
   * @returns Its completions, to push onto.
   */
  open(scope: string): CodeCompletion[] {
    const existing = this.scopes.get(scope);
    if (existing !== undefined) return existing;

    const created: CodeCompletion[] = [];
    this.scopes.set(scope, created);
    return created;
  }

  /**
   * Offer something at a scope.
   *
   * @param scope - The scope.
   * @param completions - What is offered, in order.
   */
  offer(scope: string, ...completions: CodeCompletion[]): void {
    this.open(scope).push(...completions);
  }

  /**
   * Describe a symbol.
   *
   * @param symbol - The symbol.
   * @param signature - Its signature.
   * @param doc - The schema's description, or `undefined` for none.
   */
  declare(symbol: string, signature: readonly SignaturePart[], doc: string | undefined): void {
    this.symbols.set(
      symbol,
      doc === undefined ? { symbol, signature } : { symbol, signature, doc },
    );
  }

  /**
   * The finished table.
   *
   * @returns The scopes and symbols, in the order they were first seen.
   */
  finish(): CodeSymbolTable {
    return {
      schemaId: publishedSchemaId(this.schema),
      scopes: [...this.scopes].map(([scope, completions]) => ({ scope, completions })),
      symbols: [...this.symbols.values()],
    };
  }
}

/**
 * The static symbol table: everything but the workspace's suggestions.
 *
 * @param schema - The published schema — the committed `v1.json`, or an edited clone.
 * @param stageOptions - The option keys each callee takes. Defaults to the grammar's; the spec
 *   passes a table with a key added, to prove it surfaces with no other edit.
 * @returns The table, deep-frozen, with each suggestion scope present and empty.
 * @throws {DslSchemaError} If a grammar pointer names a location the schema does not have.
 */
export function buildCodeSymbols(
  schema: JsonSchema,
  stageOptions: StageOptionsTable = STAGE_OPTIONS,
): CodeSymbolTable {
  const draft = new TableDraft(schema);
  const vocabulary: Vocabulary = {
    predicateForms: predicateForms(schema),
    conditionForms: conditionForms(schema),
    routeSnippets: Object.values(ROUTE_METHODS).map((method) => ({
      label: `route.${method}("")`,
      kind: "snippet",
      symbol: `route.${method}`,
    })),
  };

  draft.declare(
    DEFINE_LOOP,
    [named(DEFINE_LOOP), plain("(slug, options)")],
    describe(schema, locate(schema, DEFINE_LOOP_FIELD)),
  );
  addOptions(draft, vocabulary, "loop", DEFINE_LOOP_OPTIONS, DEFINE_LOOP_FIELDS);
  addOptions(draft, vocabulary, "trigger", TRIGGER_OPTIONS, TRIGGER_FIELDS, {
    on: (event) => (TRIGGER_EVENTS as Readonly<Record<string, string>>)[String(event)],
  });
  addStages(draft, vocabulary, stageOptions);
  addOptions(
    draft,
    vocabulary,
    "permissions",
    Object.values(PERMISSION_KEYS),
    Object.fromEntries(
      Object.entries(PERMISSION_KEYS).map(([field, key]) => [key, `${PERMISSIONS_FIELD}/${field}`]),
    ),
  );
  addOptions(draft, vocabulary, "edge", EDGE_ENTRY_OPTIONS, EDGE_ENTRY_FIELDS);
  addRoutes(draft);
  addEffort(draft);
  addPredicates(draft);
  addConditions(draft);
  draft.offer(
    "source.values",
    ...spelledValues(schema, locate(schema, SOURCE_KIND_FIELD)).map(valueCompletion),
  );

  for (const scope of Object.values(SUGGESTION_SCOPES)) draft.open(scope);

  return deepFreeze(draft.finish());
}

/**
 * The table one workspace's editor reads: the static table and its suggestions.
 *
 * @param table - {@link buildCodeSymbols}' answer, built once at boot.
 * @param suggestions - The stage catalog's suggestions for this workspace.
 * @returns A new table. The static one is never modified, and the suggestion lists are copied.
 */
export function codeSymbolTable(
  table: CodeSymbolTable,
  suggestions: StageSuggestions,
): CodeSymbolTable {
  const byScope = new Map<string, readonly string[]>(
    (Object.keys(SUGGESTION_SCOPES) as (keyof StageSuggestions)[]).map((list) => [
      SUGGESTION_SCOPES[list],
      suggestions[list],
    ]),
  );

  return {
    schemaId: table.schemaId,
    scopes: table.scopes.map(({ scope, completions }) => {
      const names = byScope.get(scope);
      if (names === undefined) return { scope, completions };

      return {
        scope,
        completions: [
          ...completions,
          ...names.map((label): CodeCompletion => ({ label, kind: "value", suggestion: true })),
        ],
      };
    }),
    symbols: table.symbols,
  };
}

/**
 * An enum value as a completion: a string is a `value` the editor quotes, anything else a
 * constant written as-is.
 *
 * @param value - A value as the code holds it.
 * @returns The completion.
 */
function valueCompletion(value: unknown): CodeCompletion {
  return typeof value === "string"
    ? { label: value, kind: "value" }
    : { label: String(value), kind: "constant" };
}

/**
 * One options object: its keys, each key's card, and what each key's value offers.
 *
 * @param draft - The table being built.
 * @param vocabulary - The shared forms and snippets.
 * @param base - The scope base — `loop`, `stage.llm`, `edge`.
 * @param keys - The keys, in the grammar's order.
 * @param fields - Where each key's value lives in the schema. A key with no entry is still
 *   offered, with a name-only card.
 * @param spellings - How a key's enum values are written, when not as listed.
 */
function addOptions(
  draft: TableDraft,
  vocabulary: Vocabulary,
  base: string,
  keys: readonly string[],
  fields: Readonly<Partial<Record<string, string>>>,
  spellings: Readonly<Partial<Record<string, ValueSpelling>>> = {},
): void {
  const { schema } = draft;

  for (const key of keys) {
    const symbol = `${base}.${key}`;
    const pointer = fields[key];
    draft.offer(`${base}.options`, { label: key, kind: "property", symbol });

    if (pointer === undefined) {
      draft.declare(symbol, [named(key)], undefined);
      continue;
    }

    const node = locate(schema, pointer);
    const spelling = spellings[key];
    const type = spellType(schema, node, spelling);
    draft.declare(
      symbol,
      type === undefined ? [named(key)] : [named(key), plain(": "), typed(type)],
      describe(schema, node),
    );

    const values = valuesFor(schema, vocabulary, pointer, node, type, spelling);
    if (values.length > 0) draft.offer(symbol, ...values);
  }
}

/**
 * What the value of one key offers.
 *
 * @param schema - The published document.
 * @param vocabulary - The shared forms and snippets.
 * @param pointer - Where the value lives.
 * @param node - The subschema there.
 * @param type - Its spelled type, when it has one.
 * @param spelling - How its enum values are written.
 * @returns Predicate forms for a predicate, the trigger's forms for its conditions, the route
 *   snippets for routing, `true`/`false` for a boolean, the written values for an enum, and
 *   nothing otherwise.
 */
function valuesFor(
  schema: JsonSchema,
  vocabulary: Vocabulary,
  pointer: string,
  node: JsonSchema,
  type: string | undefined,
  spelling: ValueSpelling | undefined,
): readonly CodeCompletion[] {
  if (referenced(schema, node)?.node === locate(schema, PREDICATE_FIELD)) {
    return vocabulary.predicateForms;
  }
  if (pointer === TRIGGER_FIELDS.when) return vocabulary.conditionForms;
  if (pointer === ROUTING_FIELD) return vocabulary.routeSnippets;
  if (type === "boolean") return [true, false].map(valueCompletion);

  return spelledValues(schema, node, spelling).map(valueCompletion);
}

/**
 * The stage calls: each callee offered in `stages`, its card, and its options.
 *
 * @param draft - The table being built.
 * @param vocabulary - The shared forms and snippets.
 * @param stageOptions - The option keys each callee takes.
 */
function addStages(
  draft: TableDraft,
  vocabulary: Vocabulary,
  stageOptions: StageOptionsTable,
): void {
  const { schema } = draft;
  const idType = spellType(schema, locate(schema, NODE_ID_FIELD)) ?? "string";

  for (const callee of STAGE_CALLEES) {
    const symbol = `stage.${callee}`;
    draft.offer("loop.stages", { label: callee, kind: "function", symbol });
    draft.declare(
      symbol,
      [named(callee), plain("(id: "), typed(idType), plain(", options)")],
      describe(schema, locate(schema, STAGE_CALLEE_FIELDS[callee])),
    );
    addOptions(draft, vocabulary, symbol, stageOptions[callee], STAGE_OPTION_FIELDS[callee]);
  }
}

/**
 * `route.task` and `route.alias`: offered after `route.`, and mockup 05's Types card.
 *
 * @param draft - The table being built.
 */
function addRoutes(draft: TableDraft): void {
  for (const [routing, method] of Object.entries(ROUTE_METHODS) as [
    keyof typeof ROUTE_METHODS,
    string,
  ][]) {
    const signature = ROUTE_SIGNATURES[routing];
    const symbol = `route.${method}`;

    draft.offer("route.methods", { label: method, kind: "method", symbol });
    draft.declare(
      symbol,
      [
        named(symbol),
        plain(`(${signature.parameter}: `),
        typed(signature.type),
        plain("): "),
        typed(ROUTE_RESULT_TYPE),
      ],
      describe(draft.schema, locate(draft.schema, signature.field)),
    );
  }
}

/**
 * `effort.XS` … `effort.XL`: offered after `effort.`, in the schema's order.
 *
 * @param draft - The table being built.
 */
function addEffort(draft: TableDraft): void {
  const { schema } = draft;
  const effort = locate(schema, EFFORT_FIELD);
  const type = typeName(EFFORT_FIELD.slice(EFFORT_FIELD.lastIndexOf("/") + 1));
  const constants = EFFORT_CONSTANTS as Readonly<Record<string, string>>;

  for (const value of spelledValues(schema, effort, (member) => constants[String(member)])) {
    const symbol = `effort.${String(value)}`;
    draft.offer("effort.constants", { label: String(value), kind: "constant", symbol });
    draft.declare(symbol, [named(symbol), plain(": "), typed(type)], describe(schema, effort));
  }
}

/**
 * One predicate kind's branch in the schema: its operators and its other properties.
 *
 * @param schema - The published document.
 * @param kind - A member of the predicate's `kind` enum.
 * @returns The branch's `then`, or `undefined` for a kind with no branch (`always`).
 */
function predicateBranch(schema: JsonSchema, kind: string): JsonSchema | undefined {
  const predicate = locate(schema, PREDICATE_FIELD);
  const branches = Array.isArray(predicate.allOf) ? (predicate.allOf as JsonSchema[]) : [];

  return branches.find((branch) => {
    const condition = (branch.if as { properties?: { kind?: { const?: unknown } } } | undefined)
      ?.properties?.kind?.const;
    return condition === kind;
  })?.then as JsonSchema | undefined;
}

/**
 * The predicate kinds the schema lists and the grammar can spell.
 *
 * @param schema - The published document.
 * @returns Each kind, with its method table when it reads the ticket.
 */
function predicateKinds(
  schema: JsonSchema,
): { readonly kind: string; readonly methods?: Readonly<Record<string, string>> }[] {
  const methods = PREDICATE_METHODS as Readonly<Record<string, Readonly<Record<string, string>>>>;

  return spelledValues(schema, locate(schema, `${PREDICATE_FIELD}/properties/kind`)).map(
    (kind) => ({ kind: String(kind), methods: methods[String(kind)] }),
  );
}

/**
 * What a predicate-valued key offers: one form per kind the grammar spells.
 *
 * @param schema - The published document.
 * @returns `() => true` for `always` (the printer's own spelling), and `(i) => i.<kind>.` for
 *   every kind that reads the ticket.
 */
function predicateForms(schema: JsonSchema): CodeCompletion[] {
  return predicateKinds(schema).flatMap(({ kind, methods }): CodeCompletion[] => {
    if (methods !== undefined) {
      return [
        { label: `(${PREDICATE_PARAMETER}) => ${PREDICATE_PARAMETER}.${kind}.`, kind: "snippet" },
      ];
    }
    return kind === "always"
      ? [{ label: printPredicate({ kind: "always" }), kind: "snippet" }]
      : [];
  });
}

/**
 * The predicate subjects and methods, each method with its card.
 *
 * A method is offered when the schema lists its operator and the grammar spells it, so an
 * operator added to either alone is not offered as text the parser would refuse.
 *
 * @param draft - The table being built.
 */
function addPredicates(draft: TableDraft): void {
  const { schema } = draft;
  const predicate = locate(schema, PREDICATE_FIELD);
  const result = typeName(PREDICATE_FIELD.slice(PREDICATE_FIELD.lastIndexOf("/") + 1));

  for (const { kind, methods } of predicateKinds(schema)) {
    const branch = predicateBranch(schema, kind);
    const properties = (branch?.properties ?? {}) as Readonly<Record<string, JsonSchema>>;
    if (methods === undefined || properties.op === undefined) continue;

    const required = new Set(Array.isArray(branch?.required) ? (branch.required as string[]) : []);
    const parameters = Object.entries(properties)
      .filter(([name]) => name !== "op")
      .flatMap(([name, node], index): SignaturePart[] => [
        plain(`${index === 0 ? "" : ", "}${name}${required.has(name) ? "" : "?"}: `),
        typed(spellType(schema, node) ?? "unknown"),
      ]);

    draft.offer("predicate.subjects", { label: kind, kind: "property" });

    for (const op of spelledValues(schema, properties.op)) {
      const method = methods[String(op)];
      if (method === undefined) continue;

      const symbol = `predicate.${kind}.${method}`;
      draft.offer(`predicate.${kind}`, { label: method, kind: "method", symbol });
      draft.declare(
        symbol,
        [named(`${kind}.${method}`), plain("("), ...parameters, plain("): "), typed(result)],
        describe(schema, predicate),
      );
    }
  }
}

/**
 * The trigger conditions the schema declares, with the method each is written as.
 *
 * @param schema - The published document.
 * @returns One entry per `TRIGGER_CONDITION_METHODS` row whose condition the schema has.
 */
function conditions(
  schema: JsonSchema,
): { readonly subject: string; readonly method: string; readonly node: JsonSchema }[] {
  const declared = locate(schema, TRIGGER_CONDITIONS_FIELD);

  return TRIGGER_CONDITION_METHODS.filter(([condition]) => Object.hasOwn(declared, condition)).map(
    ([condition, subject, method]) => ({
      subject,
      method,
      node: locate(schema, `${TRIGGER_CONDITIONS_FIELD}/${condition}`),
    }),
  );
}

/**
 * What the trigger's `when` offers: one form per condition.
 *
 * @param schema - The published document.
 * @returns `(i) => i.<subject>.` per condition.
 */
function conditionForms(schema: JsonSchema): CodeCompletion[] {
  return conditions(schema).map(({ subject }) => ({
    label: `(${PREDICATE_PARAMETER}) => ${PREDICATE_PARAMETER}.${subject}.`,
    kind: "snippet",
  }));
}

/**
 * The trigger's condition subjects and methods, each method with its card.
 *
 * @param draft - The table being built.
 */
function addConditions(draft: TableDraft): void {
  const { schema } = draft;

  for (const { subject, method, node } of conditions(schema)) {
    const type = spellType(schema, node);
    const parameter = type?.endsWith("[]") ? "values" : "value";
    const symbol = `condition.${subject}.${method}`;

    draft.offer("condition.subjects", { label: subject, kind: "property" });
    draft.offer(`condition.${subject}`, { label: method, kind: "method", symbol });
    draft.declare(
      symbol,
      [
        named(`${subject}.${method}`),
        plain(`(${parameter}: `),
        typed(type ?? "unknown"),
        plain(")"),
      ],
      describe(schema, node),
    );
  }
}
