"use client";

import { useId, useRef, useState } from "react";

import type { WorkspaceLifecycle } from "@/app/api/settings-lifecycle";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button } from "@/app/ui";

import {
  CANCEL,
  PAUSE_BANNER_NOTE,
  PAUSE_CONFIRM,
  PAUSE_DIALOG_TITLE,
  PAUSE_SEMANTICS,
  PAUSING,
  PREVIEW_LOADING,
  type PreviewState,
  inFlightSentence,
  inFlightUnavailable,
} from "./danger";
import type { LifecycleOutcome } from "./outcome";

import "./danger.css";

/** What {@link PauseDialog} takes. */
export interface PauseDialogProps {
  /** Whether it is showing. */
  readonly open: boolean;
  /** The live state, read when the dialog opened — where the in-flight count comes from. */
  readonly preview: PreviewState;
  /** Pause the workspace. */
  readonly onPause: () => Promise<LifecycleOutcome<WorkspaceLifecycle>>;
  /** Called with the lifecycle once it is paused. */
  readonly onPaused: (lifecycle: WorkspaceLifecycle) => void;
  /** Close without pausing. */
  readonly onClose: () => void;
}

/**
 * The **Pause all loops** confirmation
 * (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)).
 *
 * It says what pausing means in mockup 17's own words — *queued issues stay queued; running
 * loops finish their stage* — and how many runs are in flight **now**, so the confirmation
 * carries information rather than only a second click. The count informs and does not gate: if
 * it cannot be read the dialog says so and the pause is still the reader's to confirm.
 *
 * A refusal stays in the dialog with the service's sentence.
 *
 * @param props See {@link PauseDialogProps}.
 * @returns The dialog.
 */
export function PauseDialog({ open, preview, onPause, onPaused, onClose }: PauseDialogProps) {
  const described = useId();
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  // A latch beside the state: two presses inside one frame both read `sending` as false.
  const sent = useRef(false);

  /** Close, forgetting what the last attempt said. */
  function close(): void {
    setRefusal(null);
    onClose();
  }

  /** Send the pause, once. */
  async function confirm(): Promise<void> {
    if (sent.current) return;

    sent.current = true;
    setSending(true);
    setRefusal(null);

    try {
      const result = await onPause();

      if (result.ok) onPaused(result.value);
      else setRefusal(result.reason);
    } finally {
      sent.current = false;
      setSending(false);
    }
  }

  return (
    <ShellOverlay
      describedBy={described}
      label={PAUSE_DIALOG_TITLE}
      onClose={close}
      open={open}
      role="alertdialog"
    >
      <div className="danger-zone__dialog">
        <h2 className="danger-zone__title">{PAUSE_DIALOG_TITLE}</h2>
        <div className="danger-zone__warning" id={described}>
          <p className="danger-zone__lead">{PAUSE_SEMANTICS}</p>
        </div>
        <p className="danger-zone__lead" role="status">
          {preview.status === "loading"
            ? PREVIEW_LOADING
            : preview.status === "ready"
              ? inFlightSentence(preview.preview.activeRuns)
              : inFlightUnavailable(preview.reason)}
        </p>
        <p className="danger-zone__note">{PAUSE_BANNER_NOTE}</p>
        {refusal !== null && (
          <p className="danger-zone__error" role="alert">
            {refusal}
          </p>
        )}
        <div className="danger-zone__actions">
          <Button onClick={close}>{CANCEL}</Button>
          <Button
            onClick={() => void confirm()}
            reason={sending ? PAUSING : undefined}
            tone="danger"
          >
            {sending ? PAUSING : PAUSE_CONFIRM}
          </Button>
        </div>
      </div>
    </ShellOverlay>
  );
}
