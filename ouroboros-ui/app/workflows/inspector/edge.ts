/**
 * The edge panel's decisions (S.5, [#151](https://github.com/NobuData/ouroboros/issues/151)): what an
 * edge's draft is, what it would write, and what stops it.
 *
 * An edge is edited as a stage is — a draft in the panel, **Apply** into the document — and carries
 * three fields: its **kind**, its **label** and, for a branch or a loop, its **condition** in P8's
 * structured shape. The rules that bind them are the DSL's (§ 6 and § 7): a branch must carry a
 * condition, a default edge carries none, a loop must return upstream, and an edge may not become a
 * duplicate of another. Each is judged here as the reader edits, by `canvas/rules.ts`, and reported
 * under the field that breaks it in the words `canvas/view.ts` gives every rule — so an illegal edge
 * is refused *at the field*, before Apply, rather than at publish.
 *
 * **Framework-free and pure**, as `inspector.ts` is.
 */

import type { WorkflowDefinition, WorkflowStageCatalog } from "@/app/api/workflows";
import type { EdgeFields } from "@/app/workflows/canvas/edit";
import type { Connection, EdgeKind, EdgeRef } from "@/app/workflows/canvas/graph";
import { edgeProblem } from "@/app/workflows/canvas/rules";
import { RULE_REASONS } from "@/app/workflows/canvas/view";

import {
  type ConfigRecord,
  type FieldMessages,
  type JsonSchema,
  catalogType,
  isConfigDirty,
  predicateErrors,
  propertySchema,
  tooLong,
} from "./inspector";

/** The longest label an edge may print (`v1.json`, `edge.label`'s `maxLength`). */
export const EDGE_LABEL_MAX = 40;

/** An edge as its panel edits it. */
export interface EdgeDraft {
  /** Its kind. */
  readonly kind: EdgeKind;
  /** Its label, as typed — `""` for none. */
  readonly label: string;
  /**
   * Its condition, or `undefined` for none. Kept while the kind is `default` — which carries none —
   * so switching a branch to default and back does not throw away the predicate built for it.
   */
  readonly condition: ConfigRecord | undefined;
}

/**
 * The draft an edge's panel opens with.
 *
 * @param connection The edge, as the canvas read it.
 * @returns The draft.
 */
export function edgeDraft(connection: Connection): EdgeDraft {
  return { kind: connection.kind, label: connection.label ?? "", condition: connection.condition ?? undefined };
}

/**
 * What a draft writes into the document.
 *
 * @param draft The draft.
 * @returns The edge's fields: a label only when one is typed, and a condition only on a branch or a
 *   loop that has one.
 */
export function edgeFields(draft: EdgeDraft): EdgeFields {
  const label = draft.label.trim();

  return {
    kind: draft.kind,
    label: label === "" ? null : label,
    ...(draft.kind === "default" || draft.condition === undefined ? {} : { condition: draft.condition }),
  };
}

/** A predicate's schema, and the document its references resolve against. */
export interface ConditionSchema {
  readonly schema: JsonSchema;
  readonly root: JsonSchema;
}

/**
 * The schema an edge's condition is built from.
 *
 * The DSL has one predicate grammar for a flow node's `predicate` and an edge's `condition` (§ 5),
 * and the catalog serves it inside the flow node's config schema — so that is where it is read,
 * rather than from a second copy.
 *
 * @param catalog The catalog, or `null` when it could not be read.
 * @returns The predicate's schema, or `null` when the catalog does not carry one.
 */
export function conditionSchema(catalog: WorkflowStageCatalog | null): ConditionSchema | null {
  const flow = catalogType(catalog, "flow");
  if (flow === null) return null;

  const root = flow.configSchema as JsonSchema;
  const schema = propertySchema(root, "predicate", root);

  return Object.keys(schema).length === 0 ? null : { schema, root };
}

/**
 * What stops a draft from being applied.
 *
 * @param definition The draft document.
 * @param ref The edge being edited.
 * @param draft The panel's draft.
 * @param condition The predicate's schema, or `null` when it could not be read — the condition's own
 *   fields are then not checked, because nothing is known about them.
 * @returns Messages keyed `kind` (a rule the edge would break), `label`, `condition.kind` and
 *   `condition.values`; empty when the draft may be applied.
 */
export function edgeErrors(
  definition: WorkflowDefinition,
  ref: EdgeRef,
  draft: EdgeDraft,
  condition: ConditionSchema | null,
): FieldMessages {
  const errors: Record<string, string> = {};
  const fields = edgeFields(draft);

  if (draft.label.trim().length > EDGE_LABEL_MAX) errors.label = tooLong(EDGE_LABEL_MAX);

  const problem = edgeProblem(definition, { ...ref, kind: fields.kind, condition: fields.condition }, ref);
  if (problem === "edge.branch_without_condition") errors["condition.kind"] = RULE_REASONS[problem];
  else if (problem !== null) errors.kind = RULE_REASONS[problem];

  if (fields.condition !== undefined && condition !== null) {
    predicateErrors(fields.condition, condition.schema, condition.root, "condition", errors);
  }

  return errors;
}

/**
 * Whether a draft would change the edge — the footer's *unapplied changes*.
 *
 * @param draft The draft.
 * @param connection The edge as the document holds it.
 * @returns `true` when applying would write something different.
 */
export function isEdgeDirty(draft: EdgeDraft, connection: Connection): boolean {
  return isConfigDirty(fieldsRecord(edgeFields(draft)), fieldsRecord(edgeFields(edgeDraft(connection))));
}

/**
 * An edge's fields as a plain record, for comparing two of them.
 *
 * @param fields The fields.
 * @returns The same three values, keyed by name.
 */
function fieldsRecord(fields: EdgeFields): ConfigRecord {
  return { kind: fields.kind, label: fields.label, condition: fields.condition };
}
