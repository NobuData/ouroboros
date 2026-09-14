"use client";

import { useId, useState } from "react";

import type { WorkflowDefinition, WorkflowStageType } from "@/app/api/workflows";
import { Button, SelectField, TextField } from "@/app/ui";
import type { EdgeFields } from "@/app/workflows/canvas/edit";
import { type Connection, EDGE_KINDS, type EdgeRef, isEdgeKind, readStages } from "@/app/workflows/canvas/graph";
import { insertProblem } from "@/app/workflows/canvas/rules";
import { StageMenu } from "@/app/workflows/canvas/stage-menu";
import { insertMenuLabel } from "@/app/workflows/canvas/view";
import type { InspectorReadings } from "@/app/workflows/view";

import { ErrorLine } from "./controls";
import { type EdgeDraft, conditionSchema, edgeDraft, edgeErrors, edgeFields, isEdgeDirty } from "./edge";
import {
  APPLIED_NOTE,
  APPLY_LABEL,
  CLEAN_REASON,
  CONDITION_LABEL,
  CONDITION_UNREAD,
  DEFAULT_EDGE_NOTE,
  DELETE_EDGE_LABEL,
  DIRTY_NOTE,
  EDGE_GLYPH,
  EDGE_KIND_WORDS,
  EDGE_LABEL_HINT,
  EDGE_LABEL_LABEL,
  EDGE_TYPE_LABEL,
  INSERT_HINT,
  INSERT_STAGE_LABEL,
  INVALID_REASON,
  KIND_LABEL,
  MEMBER_REASON,
  edgeTitle,
} from "./inspector";
import { PredicateFields } from "./stage-forms";

/** What the edge panel takes. */
export interface EdgeInspectorProps {
  /** The edge, as the draft holds it now. */
  readonly connection: Connection;
  /** The draft. */
  readonly definition: WorkflowDefinition;
  /** The catalog, routes and aliases, or `null` when they were not read. */
  readonly readings: InspectorReadings | null;
  /** Whether the reader may change the workflow. */
  readonly mayAdminister: boolean;
  /** Told the edge's new kind, label and condition — **Apply**. */
  readonly onApplyEdge: (ref: EdgeRef, fields: EdgeFields) => void;
  /** Told the edge is to be removed — **Delete edge**. */
  readonly onDeleteEdge: (ref: EdgeRef) => void;
  /** Told a stage type to insert into the edge — **Insert stage ▾**. */
  readonly onInsert: (ref: EdgeRef, type: WorkflowStageType) => void;
}

/**
 * One edge's panel (S.5, [#151](https://github.com/NobuData/ouroboros/issues/151)): its kind, its
 * label and its condition, the stage menu that inserts into it, and the footer.
 *
 * Built as a stage's panel is — a draft here, **Apply** into the document — so an edge reads like the
 * rest of the inspector. The condition is P8's structured predicate, drawn by the same builder a flow
 * node's predicate is (`stage-forms.tsx`'s `PredicateFields`) from the grammar the catalog serves, and
 * shown for a branch (where it is required) and a loop (where it is optional); a default edge says it
 * has none. Every DSL rule the draft would break is said under the field that breaks it, and keeps
 * **Apply** inert (`edge.ts`).
 *
 * @param props See {@link EdgeInspectorProps}.
 * @returns The panel's contents.
 */
export function EdgeInspector({
  connection,
  definition,
  readings,
  mayAdminister,
  onApplyEdge,
  onDeleteEdge,
  onInsert,
}: EdgeInspectorProps) {
  const idPrefix = useId();
  const [draft, setDraft] = useState<EdgeDraft>(() => edgeDraft(connection));
  const [applied, setApplied] = useState(false);
  const [inserting, setInserting] = useState(false);

  const ref: EdgeRef = { from: connection.from, to: connection.to };
  const catalog = readings?.catalog.ok === true ? readings.catalog.value : null;
  const condition = conditionSchema(catalog);
  const titles = new Map(readStages(definition).map((stage) => [stage.id, stage.title]));
  const fromTitle = titles.get(ref.from) ?? ref.from;
  const toTitle = titles.get(ref.to) ?? ref.to;

  const errors = edgeErrors(definition, ref, draft, condition);
  const dirty = isEdgeDirty(draft, connection);
  const readOnlyReason = mayAdminister ? undefined : MEMBER_REASON;
  const applyReason =
    readOnlyReason ?? (Object.keys(errors).length > 0 ? INVALID_REASON : dirty ? undefined : CLEAN_REASON);
  const titleId = `${idPrefix}-title`;

  const edit = (next: EdgeDraft) => {
    setDraft(next);
    setApplied(false);
  };

  const apply = () => {
    onApplyEdge(ref, edgeFields(draft));
    setApplied(true);
  };

  return (
    <>
      <header className="studio-inspector__head">
        <p className="studio-inspector__type">
          <span aria-hidden="true">{EDGE_GLYPH} </span>
          {EDGE_TYPE_LABEL}
        </p>
        <h2 className="studio-inspector__title" id={titleId}>
          {edgeTitle(fromTitle, toTitle)}
        </h2>
      </header>

      {/* A disabled fieldset disables every native control in it — the read-only reader's panel. */}
      <fieldset aria-labelledby={titleId} className="studio-inspector__form" disabled={!mayAdminister}>
        <SelectField
          error={errors.kind}
          id={`${idPrefix}-kind`}
          label={KIND_LABEL}
          onChange={(event) => {
            const kind = event.target.value;
            if (isEdgeKind(kind)) edit({ ...draft, kind });
          }}
          value={draft.kind}
        >
          {EDGE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {EDGE_KIND_WORDS[kind]}
            </option>
          ))}
        </SelectField>

        <TextField
          error={errors.label}
          hint={EDGE_LABEL_HINT}
          id={`${idPrefix}-label`}
          label={EDGE_LABEL_LABEL}
          mono
          onChange={(event) => edit({ ...draft, label: event.target.value })}
          value={draft.label}
        />

        {draft.kind === "default" ? (
          <p className="studio-inspector__note">{DEFAULT_EDGE_NOTE}</p>
        ) : condition === null ? (
          <>
            <p className="studio-inspector__note">{CONDITION_UNREAD}</p>
            <ErrorLine id={`${idPrefix}-condition-error`} message={errors["condition.kind"]} />
          </>
        ) : (
          <PredicateFields
            errors={errors}
            field="condition"
            idPrefix={idPrefix}
            legend={CONDITION_LABEL}
            onChange={(next) => edit({ ...draft, condition: next })}
            optional={draft.kind === "loop"}
            predicate={draft.condition}
            root={condition.root}
            schema={condition.schema}
          />
        )}
      </fieldset>

      {catalog !== null && (
        <div className="studio-inspector__block">
          <StageMenu
            label={INSERT_STAGE_LABEL}
            menuLabel={insertMenuLabel(fromTitle, toTitle)}
            onOpenChange={setInserting}
            onPick={(type) => onInsert(ref, type)}
            open={inserting}
            placement="inline"
            problemFor={(type) => insertProblem(definition, type)}
            reason={readOnlyReason}
            tone="ghost"
            types={catalog.nodeTypes}
          />
          <p className="studio-inspector__note">{INSERT_HINT}</p>
        </div>
      )}

      <footer className="studio-inspector__foot">
        <Button onClick={() => onDeleteEdge(ref)} reason={readOnlyReason} tone="ghost">
          {DELETE_EDGE_LABEL}
        </Button>
        <p className="studio-inspector__status" role="status">
          {dirty ? DIRTY_NOTE : applied ? APPLIED_NOTE : ""}
        </p>
        <Button onClick={apply} reason={applyReason} tone="primary">
          {APPLY_LABEL}
        </Button>
      </footer>
    </>
  );
}
