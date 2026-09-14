"use client";

import { type ReactNode, useId, useState } from "react";

import { Button, Card, EmptyState } from "@/app/ui";
import { type CanvasSelection, type StageEntry, isStageKind } from "@/app/workflows/canvas/graph";
import { stageRole } from "@/app/workflows/canvas/treatment";
import { STAGE_GLYPHS } from "@/app/workflows/canvas/view";
import type { InspectorReadings } from "@/app/workflows/view";
import type { WorkflowDefinition } from "@/app/api/workflows";

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
}

/**
 * Mockup 04's `.inspector` — the sticky panel beside the canvas where a stage is configured (S.4,
 * [#150](https://github.com/NobuData/ouroboros/issues/150)).
 *
 * The panel is keyed by the selected stage, so moving the selection opens a fresh draft of that
 * stage's config and an unapplied edit of the last one is dropped rather than carried over to a
 * stage it was not written for. The form under the header is chosen by the node's type and drawn
 * from the catalog's schema for it; `app/workflows/inspector/inspector.ts` holds every decision.
 *
 * @param props See {@link InspectorPanelProps}.
 * @returns The panel.
 */
export function InspectorPanel(props: InspectorPanelProps) {
  const { entry, selection } = props;

  return (
    <Card aria-label={INSPECTOR_LABEL} as="aside" className="studio-inspector">
      {entry === null ? (
        <EmptyState note={emptyNote(selection)} title={NOTHING_SELECTED_TITLE} />
      ) : (
        <StageInspector {...props} entry={entry} key={entry.id} />
      )}
    </Card>
  );
}

/**
 * One stage's panel: its header, its form, and the footer.
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
