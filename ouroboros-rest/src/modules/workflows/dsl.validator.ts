/**
 * The workflow DSL validator — this service's answer to *may this document be saved, and
 * may it be published?* ([#133](https://github.com/NobuData/ouroboros/issues/133)).
 *
 * One entry point, {@link validateWorkflowDocument}, and four stages behind it in a fixed
 * order:
 *
 *   1. **The document is an object**, and `dsl_version` names a language this build
 *      implements. Both short-circuit: a JSON array is not a workflow, and a document
 *      written in a later DSL is not one this build can honestly report rule violations
 *      about — the rules it would report against are not the rules it was written to.
 *   2. **The schema stage** — the frame, then each node and each edge, then each node's
 *      type-dependent config and each edge's condition. The pieces are applied separately so
 *      that a mistake in one node does not hide a different one in the next.
 *   3. **The structural stage** — `dsl.structure.ts`, and only over a document stage 2
 *      accepted, for the reason that file gives.
 *   4. **The reference stage** — `dsl.references.ts`, decision **P7**'s warnings.
 *
 * The order is the contract. `ouroboros-engine`'s `validate.py` runs the same four stages in
 * the same order, and `schemas/workflow-dsl/fixtures/expected.json` records the verdict both
 * must produce for every fixture — including *which* diagnostics a document that fails an
 * early stage does and does not get. Two validators that reported the same rules in a
 * different order would still be two validators a client could tell apart.
 */

import type { z } from "zod";

import type { DslDiagnostic, DslVerdict } from "./dsl.errors";
import { DslErrorCode, pointer, sortDiagnostics } from "./dsl.errors";
import type { DiagnosticAnchor } from "./dsl.issues";
import { diagnosticsFromZodIssues } from "./dsl.issues";
import type { DslCatalogue } from "./dsl.references";
import { checkReferences } from "./dsl.references";
import type {
  FlowConfig,
  InfraConfig,
  LlmConfig,
  NodeShape,
  Predicate,
  TermConfig,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
} from "./dsl.schema";
import {
  EdgeSchema,
  NODE_CONFIG_SCHEMAS,
  NodeShapeSchema,
  PREDICATE_SCHEMAS,
  SUPPORTED_DSL_VERSIONS,
  TERM_OPTION_SCHEMAS,
  WorkflowRootSchema,
} from "./dsl.schema";
import { checkStructure } from "./dsl.structure";

/** What {@link validateWorkflowDocument} is allowed to know beyond the document itself. */
export interface DslValidationOptions {
  /** The names that exist, for decision **P7**'s warnings. Omit it and none are reported. */
  catalogue?: DslCatalogue;
}

/** A verdict, with the typed document when there is one. */
export interface DslValidation extends DslVerdict {
  /**
   * The document, parsed into the shapes the rest of the service programs against.
   *
   * Present exactly when `valid` is true: a document with an error has a node whose config
   * did not parse, and there is no honest typed value for it.
   */
  document?: WorkflowDocument;
}

/** A stage's product: what it parsed, and what went wrong doing so. */
interface Parsed<T> {
  value?: T;
  errors: DslDiagnostic[];
}

/**
 * Dispatch a tagged object on its tag and validate it against that tag's schema.
 *
 * The hand-written half of the two-stage design `dsl.schema.ts` explains: zod and pydantic
 * anchor a discriminated union's failures at different places, and the anchor is half of
 * what the two validators have to agree on. Doing the dispatch by hand makes both sides
 * report the tag's own failures at the tag, and everything else inside the one variant that
 * was selected.
 *
 * @param value - The object to dispatch, already known to be an object.
 * @param tag - The property that names the variant — `type`, `kind` or `action`.
 * @param schemas - The variant schemas, keyed by tag value.
 * @param base - Where `value` lives in the document, as pointer segments.
 * @param anchor - The node or edge every resulting diagnostic belongs to.
 * @returns The parsed variant, or the diagnostics that stopped it.
 */
function dispatch<T>(
  value: Record<string, unknown>,
  tag: string,
  schemas: Record<string, z.ZodType>,
  base: (string | number)[],
  anchor: DiagnosticAnchor,
): Parsed<T> {
  const selector = value[tag];

  if (selector === undefined) {
    return {
      errors: [
        {
          code: DslErrorCode.SCHEMA_REQUIRED,
          path: pointer(...base, tag),
          ...anchor,
          message: "This property is required.",
        },
      ],
    };
  }

  if (typeof selector !== "string" || !Object.prototype.hasOwnProperty.call(schemas, selector)) {
    return {
      errors: [
        {
          code: DslErrorCode.SCHEMA_ENUM,
          path: pointer(...base, tag),
          ...anchor,
          message: `Expected one of ${Object.keys(schemas)
            .map((key) => JSON.stringify(key))
            .join(", ")}.`,
        },
      ],
    };
  }

  const parsed = schemas[selector].safeParse(value);
  if (!parsed.success) {
    return { errors: diagnosticsFromZodIssues(parsed.error.issues, base, value, anchor) };
  }
  return { value: parsed.data as T, errors: [] };
}

/**
 * The graph anchor a node carries before it has been validated.
 *
 * A node whose skeleton did not parse still has to be selectable on the canvas, and the
 * canvas keys nodes by the id the document gave them — including when that id is the thing
 * that is wrong. So the anchor is read verbatim when it is a string at all, and left off
 * when the property is missing or of another type, where there is nothing honest to say.
 *
 * @param candidate - A node, straight from the document.
 * @returns The anchor, or an empty one.
 */
function readNodeAnchor(candidate: unknown): DiagnosticAnchor {
  if (candidate === null || typeof candidate !== "object") return {};
  const id = (candidate as Record<string, unknown>).id;
  return typeof id === "string" ? { node: id } : {};
}

/**
 * The graph anchor an edge carries before it has been validated.
 *
 * Both endpoints or neither: an edge is identified by its pair, and half of one would tell
 * the canvas to highlight something it cannot find.
 *
 * @param candidate - An edge, straight from the document.
 * @returns The anchor, or an empty one.
 */
function readEdgeAnchor(candidate: unknown): DiagnosticAnchor {
  if (candidate === null || typeof candidate !== "object") return {};
  const { from, to } = candidate as Record<string, unknown>;
  return typeof from === "string" && typeof to === "string" ? { edge: { from, to } } : {};
}

/**
 * Validate one predicate — a flow node's, or a branch or loop edge's condition.
 *
 * @param value - The predicate object.
 * @param base - Where it lives in the document, as pointer segments.
 * @param anchor - The node or edge it belongs to.
 * @returns The typed predicate, or the diagnostics that stopped it.
 */
function parsePredicate(
  value: Record<string, unknown>,
  base: (string | number)[],
  anchor: DiagnosticAnchor,
): Parsed<Predicate> {
  return dispatch<Predicate>(value, "kind", PREDICATE_SCHEMAS, base, anchor);
}

/**
 * Validate one node's type-dependent config.
 *
 * `flow` and `term` are dispatched a second time — a flow's predicate on its `kind`, a
 * terminal's options on its `action` — which is why this is not simply one `safeParse`.
 *
 * @param shape - The node's skeleton, already parsed.
 * @param index - Its position in `nodes`, for the pointer.
 * @returns The typed node, or the diagnostics that stopped it.
 */
function parseNode(shape: NodeShape, index: number): Parsed<WorkflowNode> {
  const base: (string | number)[] = ["nodes", index, "config"];
  const anchor: DiagnosticAnchor = { node: shape.id };
  const common = {
    id: shape.id,
    title: shape.title,
    position: shape.position,
    ...(shape.description === undefined ? {} : { description: shape.description }),
  };

  const parsed = NODE_CONFIG_SCHEMAS[shape.type].safeParse(shape.config);
  if (!parsed.success) {
    return { errors: diagnosticsFromZodIssues(parsed.error.issues, base, shape.config, anchor) };
  }

  switch (shape.type) {
    case "trigger":
      return { value: { ...common, type: "trigger", config: {} }, errors: [] };

    case "infra":
      return {
        value: { ...common, type: "infra", config: parsed.data as InfraConfig },
        errors: [],
      };

    case "llm": {
      const config = parsed.data as LlmConfig;
      const errors: DslDiagnostic[] = [];

      if (config.mode === "skill" && config.skill === undefined) {
        errors.push({
          code: DslErrorCode.CONFIG_SKILL_REQUIRED,
          path: pointer(...base, "skill"),
          ...anchor,
          message: "A stage in skill mode needs the skill to load before its prompt.",
        });
      }
      if (config.mode === "prompt" && config.skill !== undefined) {
        errors.push({
          code: DslErrorCode.CONFIG_SKILL_NOT_ALLOWED,
          path: pointer(...base, "skill"),
          ...anchor,
          message: "A stage in direct-prompt mode loads no skill, so this one would be ignored.",
        });
      }

      const { inherit_task: inheritTask, pinned_model: pinnedModel } = config.routing;
      if (inheritTask === undefined && pinnedModel === undefined) {
        errors.push({
          code: DslErrorCode.CONFIG_ROUTING_MISSING,
          path: pointer(...base, "routing"),
          ...anchor,
          message: "Routing must either inherit the route for a task or pin a model.",
        });
      }
      if (inheritTask !== undefined && pinnedModel !== undefined) {
        errors.push({
          code: DslErrorCode.CONFIG_ROUTING_AMBIGUOUS,
          path: pointer(...base, "routing"),
          ...anchor,
          message:
            "Routing inherits a task's route or pins a model, never both — " +
            "the inspector's two radios are exclusive.",
        });
      }

      if (errors.length > 0) return { errors };
      return { value: { ...common, type: "llm", config }, errors: [] };
    }

    case "flow": {
      const shapeConfig = parsed.data as {
        kind: "decision" | "gate";
        predicate: Record<string, unknown>;
      };
      const predicate = parsePredicate(shapeConfig.predicate, [...base, "predicate"], anchor);
      if (!predicate.value) return { errors: predicate.errors };
      const config: FlowConfig = { kind: shapeConfig.kind, predicate: predicate.value };
      return { value: { ...common, type: "flow", config }, errors: [] };
    }

    case "term": {
      const shapeConfig = parsed.data as {
        action: keyof typeof TERM_OPTION_SCHEMAS;
        options: Record<string, unknown>;
      };
      const options = TERM_OPTION_SCHEMAS[shapeConfig.action].safeParse(shapeConfig.options);
      if (!options.success) {
        return {
          errors: diagnosticsFromZodIssues(
            options.error.issues,
            [...base, "options"],
            shapeConfig.options,
            anchor,
          ),
        };
      }
      const config = { action: shapeConfig.action, options: options.data } as TermConfig;
      return { value: { ...common, type: "term", config }, errors: [] };
    }
  }
}

/**
 * Validate one edge and its condition.
 *
 * @param value - The edge, straight from the document.
 * @param index - Its position in `edges`, for the pointer.
 * @returns The typed edge, or the diagnostics that stopped it.
 */
function parseEdge(value: unknown, index: number): Parsed<WorkflowEdge> {
  const shape = EdgeSchema.safeParse(value);
  if (!shape.success) {
    return {
      errors: diagnosticsFromZodIssues(
        shape.error.issues,
        ["edges", index],
        value,
        readEdgeAnchor(value),
      ),
    };
  }

  const anchor: DiagnosticAnchor = { edge: { from: shape.data.from, to: shape.data.to } };
  const edge: WorkflowEdge = {
    from: shape.data.from,
    to: shape.data.to,
    kind: shape.data.kind,
    ...(shape.data.label === undefined ? {} : { label: shape.data.label }),
  };

  if (shape.data.condition !== undefined) {
    const condition = parsePredicate(shape.data.condition, ["edges", index, "condition"], anchor);
    if (!condition.value) return { errors: condition.errors };
    edge.condition = condition.value;
  }

  return { value: edge, errors: [] };
}

/**
 * Validate a workflow definition.
 *
 * @param input - The document, as it arrived — parsed JSON, not a string, and not trusted to
 *   be anything in particular.
 * @param options - What the caller knows beyond the document; see {@link DslCatalogue}.
 * @returns The verdict, with diagnostics in document order and the typed document when the
 *   document is valid.
 */
export function validateWorkflowDocument(
  input: unknown,
  options: DslValidationOptions = {},
): DslValidation {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return {
      valid: false,
      errors: [
        {
          code: DslErrorCode.DOCUMENT_MALFORMED,
          path: "",
          message: "A workflow definition is a JSON object.",
        },
      ],
      warnings: [],
    };
  }

  const record = input as Record<string, unknown>;
  const version = record.dsl_version;
  if (
    typeof version === "string" &&
    !(SUPPORTED_DSL_VERSIONS as readonly string[]).includes(version)
  ) {
    return {
      valid: false,
      errors: [
        {
          code: DslErrorCode.DOCUMENT_DSL_VERSION_UNSUPPORTED,
          path: pointer("dsl_version"),
          message:
            `This build implements ${SUPPORTED_DSL_VERSIONS.join(", ")} of the workflow ` +
            `language, and the document is written in ${version}.`,
        },
      ],
      warnings: [],
    };
  }

  const root = WorkflowRootSchema.safeParse(input);
  if (!root.success) {
    return {
      valid: false,
      errors: sortDiagnostics(diagnosticsFromZodIssues(root.error.issues, [], input)),
      warnings: [],
    };
  }

  const errors: DslDiagnostic[] = [];
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];

  root.data.nodes.forEach((candidate, index) => {
    const shape = NodeShapeSchema.safeParse(candidate);
    if (!shape.success) {
      errors.push(
        ...diagnosticsFromZodIssues(
          shape.error.issues,
          ["nodes", index],
          candidate,
          readNodeAnchor(candidate),
        ),
      );
      return;
    }
    const node = parseNode(shape.data, index);
    if (node.value) nodes.push(node.value);
    errors.push(...node.errors);
  });

  root.data.edges.forEach((candidate, index) => {
    const edge = parseEdge(candidate, index);
    if (edge.value) edges.push(edge.value);
    errors.push(...edge.errors);
  });

  if (errors.length > 0) {
    return { valid: false, errors: sortDiagnostics(errors), warnings: [] };
  }

  const document: WorkflowDocument = {
    dsl_version: root.data.dsl_version,
    trigger: root.data.trigger,
    nodes,
    edges,
  };

  const structural = checkStructure(document);
  if (structural.length > 0) {
    return { valid: false, errors: sortDiagnostics(structural), warnings: [] };
  }

  return {
    valid: true,
    errors: [],
    warnings: sortDiagnostics(checkReferences(document, options.catalogue)),
    document,
  };
}
