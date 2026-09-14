"use client";

import { type ReactNode, useId, useState } from "react";

import type { WorkflowDefinition, WorkflowStageType } from "@/app/api/workflows";
import { Button, Card, EmptyState } from "@/app/ui";
import type { EdgeFields } from "@/app/workflows/canvas/edit";
import {
  type CanvasSelection,
  type Connection,
  type EdgeRef,
  type StageEntry,
  isStageKind,
  readConnections,
  readStages,
} from "@/app/workflows/canvas/graph";
import { stageRole } from "@/app/workflows/canvas/treatment";
import { STAGE_GLYPHS } from "@/app/workflows/canvas/view";
import type { InspectorReadings } from "@/app/workflows/view";

import { ConnectRow } from "./connect-row";
import { EdgeInspector } from "./edge-inspector";
import {
  APPLIED_NOTE,
  APPLY_LABEL,
  CATALOG_UNREAD,
  CLEAN_REASON,
  type ConfigRecord,
  DELETE_LABEL,
  DIRTY_NOTE,
  INSPECTOR_LABEL,
  INVALID_REASON,
  type JsonSchema,
  MEMBER_REASON,
  NOTHING_SELECTED_TITLE,
  TRIGGER_NOTE,
  TYPE_UNKNOWN,
  budgetText,
  catalogType,
  draftErrors,
  emptyNote,
  fieldLabel,
  isConfigDirty,
  knownNames,
  paletteVariables,
  referenceWarnings,
} from "./inspector";
import { LlmForm } from "./llm-form";
import { FlowForm, GeneratedForm, TermForm } from "./stage-forms";

import "./inspector.css";

/** What the inspector takes. */
export interface InspectorPanelProps {
  /** What is selected on the canvas. */
  readonly selection: CanvasSelection;
  /** The selected stage's fields, read from the draft, or `null` when no single stage is selected. */
  readonly entry: StageEntry | null;
  /** The draft — what the variable palette's *earlier stages* are read from. */
  readonly definition: WorkflowDefinition;
  /** The catalog, routes and aliases, or `null` when they were not read. */
  readonly readings: InspectorReadings | null;
  /** Whether the reader may change the workflow. */
  readonly mayAdminister: boolean;
  /** Told a stage's new config — **Apply**. */
  readonly onApply: (id: string, config: ConfigRecord) => void;
  /** Told a stage is to be removed — **Delete stage**. */
  readonly onDelete: (id: string) => void;
  /** Told a connection to draw from a stage — **Connect** (S.5, #151). */
  readonly onConnect: (from: string, to: string) => void;
  /** Told an edge's new kind, label and condition — the edge panel's **Apply**. */
  readonly onApplyEdge: (ref: EdgeRef, fields: EdgeFields) => void;
  /** Told an edge is to be removed — **Delete edge**. */
  readonly onDeleteEdge: (ref: EdgeRef) => void;
  /** Told a stage type to insert into an edge — **Insert stage ▾**. */
  readonly onInsert: (ref: EdgeRef, type: WorkflowStageType) => void;
}

/**
 * The selected edge, as the draft holds it now.
 *
 * Read from the draft rather than from the selection, because the selection is the canvas's report of
 * the edge when it was selected, and an **Apply** since then has changed it.
 *
 * @param definition The draft.
 * @param selection The canvas's selection.
 * @returns The edge, or `null` when no single edge is selected or the draft no longer holds it.
 */
function selectedConnection(definition: WorkflowDefinition, selection: CanvasSelection): Connection | null {
  if (selection?.kind !== "edge") return null;

  const { from, to } = selection.connection;
  return readConnections(definition, readStages(definition)).find((edge) => edge.from === from && edge.to === to) ?? null;
}

/**
 * Mockup 04's `.inspector` — the sticky panel beside the canvas where a stage is configured (S.4,
 * [#150](https://github.com/NobuData/ouroboros/issues/150)), and since S.5
 * ([#151](https://github.com/NobuData/ouroboros/issues/151)) where an edge is.
 *
 * The panel is keyed by the selected stage or edge, so moving the selection opens a fresh draft of
 * what is selected and an unapplied edit of the last one is dropped rather than carried over to
 * something it was not written for. A stage's form is chosen by the node's type and drawn from the
 * catalog's schema for it; `app/workflows/inspector/inspector.ts` holds every decision. An edge's
 * panel is `edge-inspector.tsx`.
 *
 * @param props See {@link InspectorPanelProps}.
 * @returns The panel.
 */
export function InspectorPanel(props: InspectorPanelProps) {
  const { entry, selection, definition } = props;
  const connection = entry === null ? selectedConnection(definition, selection) : null;
  let body: ReactNode;

  if (entry !== null) {
    body = <StageInspector {...props} entry={entry} key={entry.id} />;
  } else if (connection !== null) {
    body = (
      <EdgeInspector
        connection={connection}
        definition={definition}
        key={`${connection.from}→${connection.to}`}
        mayAdminister={props.mayAdminister}
        onApplyEdge={props.onApplyEdge}
        onDeleteEdge={props.onDeleteEdge}
        onInsert={props.onInsert}
        readings={props.readings}
      />
    );
  } else {
    body = <EmptyState note={emptyNote(selection)} title={NOTHING_SELECTED_TITLE} />;
  }

  return (
    <Card aria-label={INSPECTOR_LABEL} as="aside" className="studio-inspector">
      {body}
    </Card>
  );
}

/**
 * One stage's panel: its header, its form, its connections, and the footer.
 *
 * @param props See {@link InspectorPanelProps}, with the entry present.
 * @returns The panel's contents.
 */
function StageInspector({
  entry,
  definition,
  readings,
  mayAdminister,
  onApply,
  onDelete,
  onConnect,
}: InspectorPanelProps & { readonly entry: StageEntry }) {
  const idPrefix = useId();
  const [config, setConfig] = useState<ConfigRecord>(entry.config);
  const [budget, setBudget] = useState(() => budgetText(entry.config));
  const [applied, setApplied] = useState(false);

  const catalog = readings?.catalog.ok === true ? readings.catalog.value : null;
  const type = catalogType(catalog, entry.type);
  const schema = type === null ? null : (type.configSchema as JsonSchema);
  const known = knownNames(catalog, readings?.aliases ?? null);

  const errors = draftErrors(entry.type, config, schema, budget);
  const warnings = referenceWarnings(entry.type, config, known);
  const dirty = isConfigDirty(config, entry.config);
  const readOnlyReason = mayAdminister ? undefined : MEMBER_REASON;
  const applyReason =
    readOnlyReason ?? (Object.keys(errors).length > 0 ? INVALID_REASON : dirty ? undefined : CLEAN_REASON);

  const edit = (next: ConfigRecord) => {
    setConfig(next);
    setApplied(false);
  };

  const apply = () => {
    onApply(entry.id, config);
    setApplied(true);
  };

  const glyph = type?.glyph ?? (isStageKind(entry.type) ? STAGE_GLYPHS[entry.type] : "□");
  const role = isStageKind(entry.type)
    ? stageRole({ id: entry.id, kind: entry.type, config })
    : (type?.label ?? fieldLabel(entry.type));
  const titleId = `${idPrefix}-title`;

  let form: ReactNode;
  if (entry.type === "trigger") {
    form = <p className="studio-inspector__note">{TRIGGER_NOTE}</p>;
  } else if (catalog === null) {
    const reason = readings !== null && !readings.catalog.ok ? ` ${readings.catalog.reason}` : "";
    form = <p className="studio-inspector__note">{`${CATALOG_UNREAD}${reason}`}</p>;
  } else if (schema === null) {
    form = <p className="studio-inspector__note">{TYPE_UNKNOWN}</p>;
  } else {
    const common = { idPrefix, config, onChange: edit, schema, errors, readOnlyReason };
    switch (entry.type) {
      case "llm":
        form = (
          <LlmForm
            {...common}
            budget={budget}
            known={known}
            onBudget={setBudget}
            routes={readings?.routes ?? null}
            stageId={entry.id}
            variables={paletteVariables(definition, entry.id)}
            warnings={warnings}
          />
        );
        break;
      case "flow":
        form = <FlowForm {...common} />;
        break;
      case "term":
        form = <TermForm {...common} />;
        break;
      default:
        form = <GeneratedForm {...common} />;
    }
  }

  return (
    <>
      <header className="studio-inspector__head">
        <p className="studio-inspector__type">
          <span aria-hidden="true">{glyph} </span>
          {role}
        </p>
        <h2 className="studio-inspector__title" id={titleId}>
          {entry.title === "" ? entry.id : entry.title}
        </h2>
        {entry.description !== "" && <p className="studio-inspector__description">{entry.description}</p>}
      </header>

      {/* A disabled fieldset disables every native control in it — the read-only reader's panel. */}
      <fieldset aria-labelledby={titleId} className="studio-inspector__form" disabled={!mayAdminister}>
        {form}
      </fieldset>

      {/* Nothing leaves a terminal (§ 7), so a terminal's panel offers no connection to draw. */}
      {entry.type !== "term" && (
        <ConnectRow
          definition={definition}
          from={entry.id}
          onConnect={(to) => onConnect(entry.id, to)}
          readOnlyReason={readOnlyReason}
        />
      )}

      <footer className="studio-inspector__foot">
        <Button onClick={() => onDelete(entry.id)} reason={readOnlyReason} tone="ghost">
          {DELETE_LABEL}
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
