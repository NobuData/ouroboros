"use client";

import { useCallback, useEffect, useState } from "react";

import type { WorkflowDefinition, WorkflowStageType } from "@/app/api/workflows";

import { saveNote } from "./autosave";
import {
  type Deletion,
  type EdgeFields,
  stageTemplate,
  withConnection,
  withConnectionFields,
  withInsertedStage,
  withoutItems,
} from "./canvas/edit";
import { type CanvasSelection, type EdgeRef, stageEntry, withStage } from "./canvas/graph";
import { edgeProblem } from "./canvas/rules";
import { StudioCanvas } from "./canvas/studio-canvas";
import { ConfirmDelete } from "./confirm-delete";
import { DryRunSheet } from "./dry-run-sheet";
import { type History, canRedo, canUndo, record, redo, startHistory, undo } from "./history";
import { type ConfigRecord, MEMBER_REASON } from "./inspector/inspector";
import { InspectorPanel } from "./inspector/inspector-panel";
import { useStudioSession } from "./studio-session-context";
import type { InspectorReadings } from "./view";

/** What the editor takes. */
export interface StudioEditorProps {
  /** The workflow's id — what the canvas remembers its viewport under. */
  readonly workflowId: string;
  /** The document the editor opens on (`app/workflows/view.ts`'s `canvasDefinition`). Read once. */
  readonly definition: WorkflowDefinition;
  /** The inspector's reads, or `null` when they were not made. */
  readonly inspector: InspectorReadings | null;
  /** Whether the reader may change the workflow. */
  readonly mayAdminister: boolean;
  /**
   * Told the draft each time it changes — and once with the document it opens on. The session's autosave
   * (S.6, [#152](https://github.com/NobuData/ouroboros/issues/152)) is told the same, through its own seam.
   */
  readonly onDraftChange?: (draft: WorkflowDefinition) => void;
}

/**
 * The canvas and the inspector, holding one draft between them (S.4,
 * [#150](https://github.com/NobuData/ouroboros/issues/150); editing S.5,
 * [#151](https://github.com/NobuData/ouroboros/issues/151); saving and dry runs S.6,
 * [#152](https://github.com/NobuData/ouroboros/issues/152)).
 *
 * The **draft** lives here, as a bounded **history** of documents (`history.ts`): every edit —
 * a move, an added, inserted or connected stage or an auto-layout on the canvas; an **Apply**, a
 * **Connect** or an edge's new kind in the inspector; a confirmed delete from either — records a new
 * document, and **Undo** and **Redo** step through them. Each edit is a pure function over the
 * document (`canvas/edit.ts`, `canvas/graph.ts`), so undoing one needs no inverse: the previous
 * document is shown again, and the canvas reconciles its nodes against it.
 *
 * **Deletes are confirmed** (`confirm-delete.tsx`): the canvas's Delete key and the inspector's two
 * Delete buttons all ask here, and nothing is removed until the reader agrees.
 *
 * **Inside the studio's session** (`studio-session.tsx`) every new draft is handed to autosave, the
 * canvas's toolbar prints where the save stands, a dry run's path is painted on the canvas and its step
 * sheet takes the inspector's track, and a finding or a step can ask the canvas to select a stage.
 * Rendered on its own — as its suites render it — it edits in memory and says so.
 *
 * It renders its parts as siblings rather than inside a wrapper, so the canvas and the inspector take
 * the studio grid's tracks (`workflows.css`); the dialog is portalled out of the grid.
 *
 * @param props See {@link StudioEditorProps}.
 * @returns The canvas, the inspector or the dry run's sheet, and the delete confirmation.
 */
export function StudioEditor({ workflowId, definition, inspector, mayAdminister, onDraftChange }: StudioEditorProps) {
  const session = useStudioSession();
  const [history, setHistory] = useState<History<WorkflowDefinition>>(() => startHistory(definition));
  const [selection, setSelection] = useState<CanvasSelection>(null);
  const [pendingDelete, setPendingDelete] = useState<Deletion | null>(null);

  const draft = history.present;
  const sessionDraftChange = session?.onDraftChange;

  useEffect(() => {
    onDraftChange?.(draft);
    sessionDraftChange?.(draft);
  }, [draft, onDraftChange, sessionDraftChange]);
  const selectedId = selection?.kind === "node" ? selection.id : null;
  const entry = selectedId === null ? null : stageEntry(draft, selectedId);
  const catalog = inspector?.catalog.ok === true ? inspector.catalog.value : null;

  /**
   * Record an edit that is a function of the draft in force, so two edits in one event build on each
   * other rather than on the render's draft.
   *
   * @param change The edit — the draft in, the new draft out (or the same draft for no change).
   */
  const change = useCallback((next: (current: WorkflowDefinition) => WorkflowDefinition) => {
    setHistory((current) => record(current, next(current.present)));
  }, []);

  const commit = useCallback((next: WorkflowDefinition) => change(() => next), [change]);

  const apply = useCallback(
    (id: string, config: ConfigRecord) =>
      change((current) => {
        const stored = stageEntry(current, id);
        return stored === null ? current : withStage(current, id, { title: stored.title, description: stored.description, config });
      }),
    [change],
  );

  const connect = useCallback(
    (from: string, to: string) =>
      change((current) =>
        edgeProblem(current, { from, to, kind: "default" }) === null
          ? withConnection(current, { from, to }, { kind: "default", label: null })
          : current,
      ),
    [change],
  );

  const applyEdge = useCallback(
    (ref: EdgeRef, fields: EdgeFields) => change((current) => withConnectionFields(current, ref, fields)),
    [change],
  );

  const insert = useCallback(
    (ref: EdgeRef, type: WorkflowStageType) =>
      change((current) => withInsertedStage(current, ref, stageTemplate(type))?.definition ?? current),
    [change],
  );

  const confirmDelete = () => {
    if (pendingDelete === null) return;

    const deletion = pendingDelete;
    change((current) => withoutItems(current, deletion));
    setPendingDelete(null);
    setSelection(null);
  };

  return (
    <>
      <StudioCanvas
        catalog={catalog}
        definition={draft}
        focus={session?.focus ?? null}
        highlight={session?.highlight ?? null}
        history={{
          canUndo: canUndo(history),
          canRedo: canRedo(history),
          onUndo: () => setHistory(undo),
          onRedo: () => setHistory(redo),
        }}
        onDefinitionChange={commit}
        onDeleteRequest={setPendingDelete}
        onSelectionChange={setSelection}
        readOnlyReason={mayAdminister ? undefined : MEMBER_REASON}
        saveNote={session === null ? undefined : saveNote(session.save)}
        workflowId={workflowId}
      />
      {session?.dryRun ? (
        <DryRunSheet
          onClose={session.closeDryRun}
          onFocus={session.focusStage}
          onSelect={session.selectStage}
          result={session.dryRun.result}
          walked={session.dryRun.walked}
        />
      ) : (
        <InspectorPanel
          definition={draft}
          entry={entry}
          mayAdminister={mayAdminister}
          onApply={apply}
          onApplyEdge={applyEdge}
          onConnect={connect}
          onDelete={(id) => setPendingDelete({ stages: [id], edges: [] })}
          onDeleteEdge={(ref) => setPendingDelete({ stages: [], edges: [ref] })}
          onInsert={insert}
          readings={inspector}
          selection={selection}
        />
      )}
      <ConfirmDelete
        definition={draft}
        deletion={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}
