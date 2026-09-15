"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";

import type { WorkflowDefinition, WorkflowDetail } from "@/app/api/workflows";

import type { DraftConflict } from "./autosave";
import { dryRunWorkflow, publishWorkflow, saveDraft } from "./draft-actions";
import { DRY_RUN_CONFLICT_MESSAGE, DRY_RUN_UNSAVED_MESSAGE, type TicketOption, dryRunFailure, highlightOf } from "./dry-run";
import { DryRunDialog } from "./dry-run-dialog";
import {
  PUBLISH_CONFLICT_MESSAGE,
  type PublishFailure,
  UNSAVED_MESSAGE,
  changeNoteBody,
  publishFailure,
  publishedToast,
} from "./publish";
import { PublishDialog } from "./publish-dialog";
import { ReloadDialog } from "./reload-dialog";
import { type FocusRequest, type ShownDryRun, StudioSessionContext, type StudioSessionValue } from "./studio-session-context";
import { useAutosave } from "./use-autosave";
import { canvasDefinition, publishLabel } from "./view";

/** Which dialog is open. */
type Dialog = "publish" | "dryRun" | null;

/** What the session takes. */
export interface StudioSessionProps {
  /** The workflow, as the page read it. Read once: the session is keyed by the workflow's id. */
  readonly workflow: WorkflowDetail;
  /** Whether the reader may save and publish. */
  readonly mayAdminister: boolean;
  /** When the page was read, ISO 8601. */
  readonly now: string;
  /**
   * What **Reload the draft** does. Defaults to reloading the page, which is the one way to be sure the
   * canvas, the inspector, the history and the etag all start again from the stored draft.
   */
  readonly reload?: () => void;
  /** The page. */
  readonly children: ReactNode;
}

/** Reload the page. */
function reloadPage(): void {
  window.location.reload();
}

/**
 * One open workflow's draft, publish and dry-run flows — S.6
 * ([#152](https://github.com/NobuData/ouroboros/issues/152)).
 *
 * The page head, the editor and the three dialogs are far apart in the tree and share one set of facts:
 * the draft the editor holds, the etag it was saved under, the version in force, the dry run on the
 * canvas. This provider holds them (`studio-session-context.ts` is what its readers import), and renders
 * nothing of its own but the dialogs.
 *
 * - **Autosave** (`use-autosave.ts`) is fed every edit through `onDraftChange`. A `409` opens the reload
 *   dialog; nothing is overwritten, and autosave stays stopped until the page is reloaded.
 * - **Publish** writes what is waiting first, so the version is the picture on the screen, then asks the
 *   gate. A refusal with findings stays in the dialog; a success moves the head's version and leaves a toast.
 * - **Dry run** writes what is waiting first, for the same reason, then asks the engine to walk the stored
 *   draft. The answer is painted until the draft changes — any edit, an undo included, clears it.
 *
 * @param props See {@link StudioSessionProps}.
 * @returns The page, with the session around it and the dialogs beside it.
 */
export function StudioSession({ workflow, mayAdminister, now: readAt, reload = reloadPage, children }: StudioSessionProps) {
  const router = useRouter();
  const [opening] = useState(() => canvasDefinition(workflow));
  const draftRef = useRef(opening);
  const nonce = useRef(0);

  const [draft, setDraft] = useState(opening);
  const [currentVersion, setCurrentVersion] = useState(workflow.currentVersion);
  const [published, setPublished] = useState<WorkflowDefinition | null>(workflow.version?.definition ?? null);
  const [draftUpdatedAt, setDraftUpdatedAt] = useState(workflow.draft.updatedAt);
  const [now, setNow] = useState(readAt);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [conflict, setConflict] = useState<{ readonly found: DraftConflict; readonly at: string } | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [dryRun, setDryRun] = useState<ShownDryRun | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const { status, schedule, flush } = useAutosave({
    workflowId: workflow.id,
    etag: workflow.draft.etag,
    stored: opening,
    enabled: mayAdminister,
    save: saveDraft,
    onSaved: (saved) => {
      setDraftUpdatedAt(saved.updatedAt);
      if (saved.updatedAt !== null) setNow(saved.updatedAt);
    },
    onConflict: (found) => {
      setConflict({ found, at: new Date().toISOString() });
      setConflictOpen(true);
    },
  });

  const onDraftChange = useCallback(
    (next: WorkflowDefinition) => {
      draftRef.current = next;
      setDraft(next);
      schedule(next);
      // A walk describes the draft it walked; the moment the graph is another, the overlay would be a lie.
      setDryRun((shown) => (shown !== null && shown.walked !== next ? null : shown));
    },
    [schedule],
  );

  const focusStage = useCallback((id: string) => {
    nonce.current += 1;
    setFocus({ id, nonce: nonce.current });
  }, []);

  const selectStage = useCallback(
    (id: string) => {
      setDialog(null);
      setDryRun(null);
      focusStage(id);
    },
    [focusStage],
  );

  const publish = useCallback(
    async (note: string): Promise<PublishFailure | null> => {
      const saved = await flush();
      if (saved === "conflict") return { message: PUBLISH_CONFLICT_MESSAGE, findings: [] };
      if (saved === "failed") return { message: UNSAVED_MESSAGE, findings: [] };

      const outcome = await publishWorkflow(workflow.id, changeNoteBody(note));
      if (!outcome.ok) return publishFailure(outcome.refusal);

      setCurrentVersion(outcome.value.version);
      setPublished(outcome.value.definition);
      setToast(publishedToast(outcome.value.version));
      setDialog(null);
      // The rail's captions count stages of the version in force, which just moved.
      router.refresh();
      return null;
    },
    [flush, router, workflow.id],
  );

  const runDryRun = useCallback(
    async (option: TicketOption): Promise<string | null> => {
      const saved = await flush();
      if (saved === "conflict") return DRY_RUN_CONFLICT_MESSAGE;
      if (saved === "failed") return DRY_RUN_UNSAVED_MESSAGE;

      const walked = draftRef.current;
      const outcome = await dryRunWorkflow(workflow.id, option.id);
      if (!outcome.ok) return dryRunFailure(outcome.refusal);

      // An edit made while the engine was walking is an edit to a draft the answer does not describe.
      setDryRun(draftRef.current === walked ? { result: outcome.value, walked } : null);
      setDialog(null);
      return null;
    },
    [flush, workflow.id],
  );

  const value = useMemo<StudioSessionValue>(
    () => ({
      workflowId: workflow.id,
      mayAdminister,
      draft,
      published,
      currentVersion,
      draftUpdatedAt,
      now,
      save: status,
      dryRun,
      highlight: dryRun === null ? null : highlightOf(dryRun.result),
      focus,
      toast,
      onDraftChange,
      openPublish: () => setDialog("publish"),
      openDryRun: () => setDialog("dryRun"),
      closeDryRun: () => setDryRun(null),
      focusStage,
      selectStage,
      dismissToast: () => setToast(null),
    }),
    [
      workflow.id,
      mayAdminister,
      draft,
      published,
      currentVersion,
      draftUpdatedAt,
      now,
      status,
      dryRun,
      focus,
      toast,
      onDraftChange,
      focusStage,
      selectStage,
    ],
  );

  return (
    <StudioSessionContext.Provider value={value}>
      {children}

      {dialog === "publish" && (
        <PublishDialog
          definition={draft}
          label={publishLabel(currentVersion)}
          onClose={() => setDialog(null)}
          onPublish={publish}
          onSelect={selectStage}
        />
      )}
      {dialog === "dryRun" && <DryRunDialog onClose={() => setDialog(null)} onRun={runDryRun} />}
      <ReloadDialog
        at={new Date(conflict?.at ?? now)}
        conflict={conflictOpen ? (conflict?.found ?? null) : null}
        onKeep={() => setConflictOpen(false)}
        onReload={reload}
      />
    </StudioSessionContext.Provider>
  );
}
