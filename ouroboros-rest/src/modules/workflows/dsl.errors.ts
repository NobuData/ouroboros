/**
 * The workflow DSL's diagnostic vocabulary — every code this service can report about a
 * workflow document, and the shape it reports them in.
 *
 * P.2 ([#133](https://github.com/NobuData/ouroboros/issues/133)). Two validators read one
 * schema — zod here, pydantic in `ouroboros-engine` — and the thing they have to agree on
 * is not their prose but their *verdict*: whether the document is valid, and, when it is
 * not, which rule broke and where. That pair is what this file names, what
 * `schemas/workflow-dsl/fixtures/expected.json` records, and what the parity suites on
 * both sides assert against that recording.
 *
 * Three decisions about the shape:
 *
 *   * **Every diagnostic is anchored.** `path` is an RFC 6901 JSON Pointer into the
 *     document, and `node` / `edge` carry the graph anchor when there is one, so the canvas
 *     can select the offending stage rather than showing a banner. The issue's second
 *     acceptance criterion — *never a bare "invalid document"* — is this field being
 *     mandatory. The two codes that can only mean "the document as a whole"
 *     ({@link DslErrorCode.DOCUMENT_NO_TRIGGER} and its two siblings) anchor at `/nodes`,
 *     which is still a place a reader can look.
 *   * **`message` is presentation, not contract.** Each validator renders its own prose in
 *     its own idiom; what the parity suites compare is `code`, `path` and the anchors. A
 *     contract over English sentences would be a contract nobody could translate.
 *   * **Errors and warnings are different lists, not a severity field.** Decision **P7**:
 *     an unknown skill or model reference must not fail a save, and a caller that has to
 *     filter by severity to find that out is a caller that will forget to.
 */

/**
 * Every code this validator emits.
 *
 * Grouped by the half of the document they are about: `document.*` for the root, `schema.*`
 * for a value that does not match the published JSON Schema, `config.*` for the conditional
 * rules inside a node's config, `node.*` and `edge.*` for the structural rules that run
 * after the schema, and `reference.*` for the decision-P7 warnings.
 */
export const DslErrorCode = {
  /** The document is not a JSON object at all. */
  DOCUMENT_MALFORMED: "document.malformed",
  /** `dsl_version` names a language this build does not implement. */
  DOCUMENT_DSL_VERSION_UNSUPPORTED: "document.dsl_version_unsupported",
  /** No node has `type: "trigger"`, so nothing can start a run. */
  DOCUMENT_NO_TRIGGER: "document.no_trigger",
  /** More than one node has `type: "trigger"`. Reported on the second and each one after. */
  DOCUMENT_MULTIPLE_TRIGGERS: "document.multiple_triggers",
  /** No node has `type: "term"`, so no path through the graph ends. */
  DOCUMENT_NO_TERMINAL: "document.no_terminal",

  /** A property the schema requires is absent. */
  SCHEMA_REQUIRED: "schema.required",
  /** A value is of the wrong JSON type. */
  SCHEMA_TYPE: "schema.type",
  /** A value is outside a closed vocabulary. */
  SCHEMA_ENUM: "schema.enum",
  /** A number is outside its bounds. */
  SCHEMA_RANGE: "schema.range",
  /** A string or array is shorter or longer than the schema allows. */
  SCHEMA_LENGTH: "schema.length",
  /** A string does not match its pattern. */
  SCHEMA_PATTERN: "schema.pattern",
  /** A property the schema does not declare. Every object in the DSL is closed. */
  SCHEMA_UNKNOWN_PROPERTY: "schema.unknown_property",

  /** `mode: "skill"` without a `skill` to load. */
  CONFIG_SKILL_REQUIRED: "config.skill_required",
  /** A `skill` in `mode: "prompt"`, which would never be loaded. */
  CONFIG_SKILL_NOT_ALLOWED: "config.skill_not_allowed",
  /** `routing` names neither a task to inherit nor a model to pin. */
  CONFIG_ROUTING_MISSING: "config.routing_missing",
  /** `routing` names both, and the inspector's radios are exclusive. */
  CONFIG_ROUTING_AMBIGUOUS: "config.routing_ambiguous",

  /** Two nodes share an `id`. Reported on the second and each one after. */
  NODE_DUPLICATE_ID: "node.duplicate_id",
  /** No path of edges reaches this node from the trigger. */
  NODE_UNREACHABLE: "node.unreachable",

  /** `from` is not the id of any node in the document. */
  EDGE_UNKNOWN_FROM: "edge.unknown_from",
  /** `to` is not the id of any node in the document. */
  EDGE_UNKNOWN_TO: "edge.unknown_to",
  /** A second edge joins a pair of nodes already joined. */
  EDGE_DUPLICATE: "edge.duplicate",
  /** `from` and `to` are the same node. */
  EDGE_SELF_REFERENCE: "edge.self_reference",
  /** An edge arrives at the trigger, which is where a run starts and nothing returns to. */
  EDGE_INTO_TRIGGER: "edge.into_trigger",
  /** An edge leaves a terminal, which is where a run ends. */
  EDGE_OUT_OF_TERMINAL: "edge.out_of_terminal",
  /** A `branch` edge carries no `condition`, so nothing decides whether it is taken. */
  EDGE_BRANCH_WITHOUT_CONDITION: "edge.branch_without_condition",
  /** A `default` edge carries a `condition`, which is never consulted. */
  EDGE_UNEXPECTED_CONDITION: "edge.unexpected_condition",
  /** A `loop` edge points at a node that cannot reach its own source. */
  EDGE_LOOP_NOT_UPSTREAM: "edge.loop_not_upstream",
} as const;

/** One of {@link DslErrorCode}'s values. */
export type DslErrorCode = (typeof DslErrorCode)[keyof typeof DslErrorCode];

/**
 * The codes the **schema stage** can report — everything the published JSON Schema also says.
 *
 * Every other code belongs to the structural stage, which JSON Schema deliberately does not
 * express: it describes values, and *every node is reachable from the trigger* is not a
 * property of a value. The split is a named constant rather than a prefix test because it is
 * what `dsl.conformance.spec.ts` compares ajv against, and because a document that is
 * schema-clean and structurally broken is *expected* to be ajv-valid — an assertion that got
 * this boundary wrong would pass for the wrong reason. `dsl.errors.spec.ts` asserts that this
 * set and the structural codes partition {@link DslErrorCode}, so a code added to neither is
 * a red check rather than a silent reclassification.
 */
export const SCHEMA_STAGE_CODES: ReadonlySet<string> = new Set<string>([
  DslErrorCode.DOCUMENT_MALFORMED,
  DslErrorCode.DOCUMENT_DSL_VERSION_UNSUPPORTED,
  DslErrorCode.SCHEMA_REQUIRED,
  DslErrorCode.SCHEMA_TYPE,
  DslErrorCode.SCHEMA_ENUM,
  DslErrorCode.SCHEMA_RANGE,
  DslErrorCode.SCHEMA_LENGTH,
  DslErrorCode.SCHEMA_PATTERN,
  DslErrorCode.SCHEMA_UNKNOWN_PROPERTY,
  DslErrorCode.CONFIG_SKILL_REQUIRED,
  DslErrorCode.CONFIG_SKILL_NOT_ALLOWED,
  DslErrorCode.CONFIG_ROUTING_MISSING,
  DslErrorCode.CONFIG_ROUTING_AMBIGUOUS,
]);

/** The codes the **structural stage** can report — the rules JSON Schema cannot express. */
export const STRUCTURAL_STAGE_CODES: ReadonlySet<string> = new Set<string>([
  DslErrorCode.DOCUMENT_NO_TRIGGER,
  DslErrorCode.DOCUMENT_MULTIPLE_TRIGGERS,
  DslErrorCode.DOCUMENT_NO_TERMINAL,
  DslErrorCode.NODE_DUPLICATE_ID,
  DslErrorCode.NODE_UNREACHABLE,
  DslErrorCode.EDGE_UNKNOWN_FROM,
  DslErrorCode.EDGE_UNKNOWN_TO,
  DslErrorCode.EDGE_DUPLICATE,
  DslErrorCode.EDGE_SELF_REFERENCE,
  DslErrorCode.EDGE_INTO_TRIGGER,
  DslErrorCode.EDGE_OUT_OF_TERMINAL,
  DslErrorCode.EDGE_BRANCH_WITHOUT_CONDITION,
  DslErrorCode.EDGE_UNEXPECTED_CONDITION,
  DslErrorCode.EDGE_LOOP_NOT_UPSTREAM,
]);

/**
 * Every code this validator emits as a *warning* — decision **P7**, in full.
 *
 * A skill, a model or a task route the caller's catalogue does not list is reported and the
 * document still saves. The model registry (mockups 06/21) and the skills catalogue (mockup
 * 14) do not exist, so today the only caller that can supply a catalogue is a test; a caller
 * that supplies none gets no warnings of this kind, which is the honest answer to *is this
 * reference known?* when nothing knows.
 */
export const DslWarningCode = {
  /** The named skill is not in the catalogue the caller supplied. */
  REFERENCE_UNKNOWN_SKILL: "reference.unknown_skill",
  /** The pinned model is not in the catalogue the caller supplied. */
  REFERENCE_UNKNOWN_MODEL: "reference.unknown_model",
  /** The inherited task route is not in the catalogue the caller supplied. */
  REFERENCE_UNKNOWN_TASK: "reference.unknown_task",
} as const;

/** One of {@link DslWarningCode}'s values. */
export type DslWarningCode = (typeof DslWarningCode)[keyof typeof DslWarningCode];

/** The graph anchor for a diagnostic about an edge. */
export interface DslEdgeAnchor {
  /** The edge's `from`, verbatim — including when it names no node. */
  from: string;
  /** The edge's `to`, verbatim — including when it names no node. */
  to: string;
}

/** One thing wrong with a document, and where. */
export interface DslDiagnostic {
  /** Which rule broke. One of {@link DslErrorCode} or {@link DslWarningCode}. */
  code: DslErrorCode | DslWarningCode;
  /** An RFC 6901 JSON Pointer to the offending value. `""` is the document itself. */
  path: string;
  /** The id of the node this anchors to, when it anchors to one. */
  node?: string;
  /** The endpoints of the edge this anchors to, when it anchors to one. */
  edge?: DslEdgeAnchor;
  /** What a person should read. Rendered here; never part of the parity contract. */
  message: string;
}

/** What {@link validateWorkflowDocument} answers. */
export interface DslVerdict {
  /** Whether the document may be saved and published — `errors` being empty. */
  valid: boolean;
  /** Every rule that broke, in document order. */
  errors: DslDiagnostic[];
  /** Every decision-P7 reference that is not in the caller's catalogue, in document order. */
  warnings: DslDiagnostic[];
}

/**
 * Escape one path segment for an RFC 6901 JSON Pointer.
 *
 * `~` first and `/` second, which is the order the RFC requires: doing it the other way
 * round would turn a literal `/` into `~1` and then into `~01`.
 *
 * @param segment - A property name or an array index.
 * @returns The segment with `~` and `/` escaped.
 */
function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Build an RFC 6901 JSON Pointer from path segments.
 *
 * @param segments - Property names and array indices, outermost first.
 * @returns The pointer — `""` for the document root, `/nodes/0/config` for a node's config.
 */
export function pointer(...segments: (string | number)[]): string {
  return segments.map((s) => `/${escapePointerSegment(String(s))}`).join("");
}

/**
 * Compare two JSON Pointers the way a reader reads the document.
 *
 * Segment by segment, with two all-digit segments compared as numbers, so `/nodes/2` sorts
 * before `/nodes/10` rather than after it. A pointer that is a prefix of another sorts
 * first, so a diagnostic about a node precedes the ones about its config. A digit segment
 * facing a name sorts first — a case the DSL's own shape cannot produce, since a given
 * position in a pointer is always an index or always a property name, and fixed here only so
 * that the two implementations are the same function rather than two functions that agree on
 * the inputs anyone has tried.
 *
 * The engine's `_pointer_key` is this comparison written as a Python sort key; the parity
 * fixtures record one order and both validators have to produce it.
 *
 * @param a - The first pointer.
 * @param b - The second pointer.
 * @returns A negative number, zero, or a positive number, as `Array.prototype.sort` wants.
 */
function comparePointers(a: string, b: string): number {
  const left = a.split("/");
  const right = b.split("/");
  const shared = Math.min(left.length, right.length);

  for (let i = 0; i < shared; i += 1) {
    const l = left[i];
    const r = right[i];
    if (l === r) continue;
    const lNumeric = /^\d+$/.test(l);
    const rNumeric = /^\d+$/.test(r);
    if (lNumeric && rNumeric) return Number(l) - Number(r);
    if (lNumeric !== rNumeric) return lNumeric ? -1 : 1;
    return l < r ? -1 : 1;
  }

  return left.length - right.length;
}

/**
 * Put diagnostics in the one order both validators must agree on.
 *
 * Document order by `path`, then by `code` for two diagnostics anchored at the same value —
 * a total order, because a parity suite that compared unordered lists would pass on two
 * validators that disagree about which of two rules they report first, and an engineer
 * reading the two outputs side by side would not.
 *
 * Sorts a copy: the caller's array is left alone.
 *
 * @param diagnostics - The diagnostics to order.
 * @returns A new array in document order.
 */
export function sortDiagnostics(diagnostics: DslDiagnostic[]): DslDiagnostic[] {
  return [...diagnostics].sort((a, b) => {
    const byPath = comparePointers(a.path, b.path);
    if (byPath !== 0) return byPath;
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  });
}
