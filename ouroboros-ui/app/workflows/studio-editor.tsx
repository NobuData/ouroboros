"use client";

import { useCallback, useState } from "react";

import type { WorkflowDefinition } from "@/app/api/workflows";

import { type CanvasSelection, stageEntry, withStage, withoutStage } from "./canvas/graph";
import { StudioCanvas } from "./canvas/studio-canvas";
import type { ConfigRecord } from "./inspector/inspector";
import { InspectorPanel } from "./inspector/inspector-panel";
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
}

/**
 * The canvas and the inspector, holding one draft between them (S.4,
 * [#150](https://github.com/NobuData/ouroboros/issues/150)).
 *
 * S.2 left the canvas holding its own document with two callbacks as the seam; this is the client
 * component those callbacks were for. The **draft** lives here: a move on the canvas writes
 * positions into it, an **Apply** in the inspector writes a stage's config into it, and
 * **Delete stage** removes the stage and its edges from it. The canvas is handed the draft back
 * and reconciles its nodes against it, which is how an applied config reaches the node's chips.
 *
 * **Nothing here saves.** The draft is this page's until S.6's autosave
 * ([#152](https://github.com/NobuData/ouroboros/issues/152)) writes it, and both the canvas and the
 * inspector say so.
 *
 * It renders its two parts as siblings rather than inside a wrapper, so they take the studio
 * grid's canvas and inspector tracks (`workflows.css`).
 *
 * @param props See {@link StudioEditorProps}.
 * @returns The canvas and the inspector.
 */
export function StudioEditor({ workflowId, definition, inspector, mayAdminister }: StudioEditorProps) {
  const [draft, setDraft] = useState(definition);
  const [selection, setSelection] = useState<CanvasSelection>(null);

  const selectedId = selection?.kind === "node" ? selection.id : null;
  const entry = selectedId === null ? null : stageEntry(draft, selectedId);

  const apply = useCallback((id: string, config: ConfigRecord) => {
    setDraft((current) => {
      const stored = stageEntry(current, id);
      return stored === null
        ? current
        : withStage(current, id, { title: stored.title, description: stored.description, config });
    });
  }, []);

  const remove = useCallback((id: string) => {
    setDraft((current) => withoutStage(current, id));
    setSelection(null);
  }, []);

  return (
    <>
      <StudioCanvas
        definition={draft}
        onDefinitionChange={setDraft}
        onSelectionChange={setSelection}
        workflowId={workflowId}
      />
      <InspectorPanel
        definition={draft}
        entry={entry}
        mayAdminister={mayAdminister}
        onApply={apply}
        onDelete={remove}
        readings={inspector}
        selection={selection}
      />
    </>
  );
}
