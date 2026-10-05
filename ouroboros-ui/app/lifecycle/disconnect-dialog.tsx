"use client";

import { type FormEvent, useId, useRef, useState } from "react";

import type { DisconnectPreview } from "@/app/api/settings-lifecycle";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button } from "@/app/ui";

import {
  CANCEL,
  DISCONNECTED_LEAD,
  DISCONNECTED_TITLE,
  DISCONNECTING,
  DISCONNECT_CONFIRM,
  DISCONNECT_DIALOG_TITLE,
  DISCONNECT_LEAD,
  DISCONNECT_NEEDS_PREVIEW,
  DONE,
  PREVIEW_LOADING,
  type PreviewState,
  disconnectSummary,
  nameMatches,
  previewUnavailable,
  typeNameReason,
} from "./danger";
import type { LifecycleOutcome } from "./outcome";
import { TypedName } from "./typed-name";

import "./danger.css";

/** What {@link DisconnectDialog} takes. */
export interface DisconnectDialogProps {
  /** Whether it is showing. */
  readonly open: boolean;
  /** The workspace's name — what the reader types to confirm. */
  readonly workspaceName: string;
  /** The consequences as of now, read when the dialog opened. */
  readonly preview: PreviewState;
  /** Disconnect GitHub. */
  readonly onDisconnect: () => Promise<LifecycleOutcome<DisconnectPreview>>;
  /** Called once the disconnect has run — the workspace is now paused. */
  readonly onDisconnected: () => void;
  /** Close — before the disconnect, or after reading its summary. */
  readonly onClose: () => void;
}

/**
 * The **Disconnect GitHub App** dialog
 * (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)): preview → typed confirm →
 * result.
 *
 * The preview is the service's, computed against live state when the dialog opened — the pull
 * requests that remain, the runs that stop, the sync that ends, the token that is deleted —
 * and it is the confirmation's content: with no preview there is nothing to confirm, so the
 * button stays inert and says why. The reader then types the workspace's name, and the result
 * summary is drawn from **the answer's** counts, which are what was true when the disconnect
 * ran rather than when the dialog opened.
 *
 * @param props See {@link DisconnectDialogProps}.
 * @returns The dialog.
 */
export function DisconnectDialog({
  open,
  workspaceName,
  preview,
  onDisconnect,
  onDisconnected,
  onClose,
}: DisconnectDialogProps) {
  const described = useId();
  const nameId = useId();
  const [typed, setTyped] = useState("");
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [result, setResult] = useState<DisconnectPreview | null>(null);
  // A latch beside the state: two presses inside one frame both read `sending` as false.
  const sent = useRef(false);

  const reason =
    preview.status !== "ready"
      ? DISCONNECT_NEEDS_PREVIEW
      : !nameMatches(typed, workspaceName)
        ? typeNameReason(workspaceName)
        : sending
          ? DISCONNECTING
          : undefined;

  /** Close, forgetting the typed name and the last attempt. */
  function close(): void {
    setTyped("");
    setRefusal(null);
    setResult(null);
    onClose();
  }

  /**
   * Send the disconnect, once.
   *
   * @param event The submit.
   */
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (reason !== undefined || sent.current) return;

    sent.current = true;
    setSending(true);
    setRefusal(null);

    try {
      const outcome = await onDisconnect();

      if (outcome.ok) {
        setResult(outcome.value);
        onDisconnected();
      } else {
        setRefusal(outcome.reason);
      }
    } finally {
      sent.current = false;
      setSending(false);
    }
  }

  if (result !== null) {
    return (
      <ShellOverlay describedBy={described} label={DISCONNECTED_TITLE} onClose={close} open={open}>
        <div className="danger-zone__dialog">
          <h2 className="danger-zone__title">{DISCONNECTED_TITLE}</h2>
          <div id={described}>
            <p className="danger-zone__lead">{DISCONNECTED_LEAD}</p>
          </div>
          <ul className="danger-zone__facts">
            {disconnectSummary(result).map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
          <div className="danger-zone__actions">
            <Button onClick={close} tone="primary">
              {DONE}
            </Button>
          </div>
        </div>
      </ShellOverlay>
    );
  }

  return (
    <ShellOverlay
      describedBy={described}
      label={DISCONNECT_DIALOG_TITLE}
      onClose={close}
      open={open}
      role="alertdialog"
    >
      <form className="danger-zone__dialog" onSubmit={(event) => void submit(event)}>
        <h2 className="danger-zone__title">{DISCONNECT_DIALOG_TITLE}</h2>
        <div className="danger-zone__warning" id={described}>
          {preview.status === "ready" ? (
            <>
              <p className="danger-zone__lead">{DISCONNECT_LEAD}</p>
              <ul className="danger-zone__facts">
                {preview.preview.consequences.map((consequence) => (
                  <li key={consequence}>{consequence}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="danger-zone__lead" role="status">
              {preview.status === "loading" ? PREVIEW_LOADING : previewUnavailable(preview.reason)}
            </p>
          )}
        </div>
        <TypedName id={nameId} onChange={setTyped} value={typed} workspaceName={workspaceName} />
        {refusal !== null && (
          <p className="danger-zone__error" role="alert">
            {refusal}
          </p>
        )}
        <div className="danger-zone__actions">
          <Button onClick={close}>{CANCEL}</Button>
          <Button reason={reason} tone="danger" type="submit">
            {sending ? DISCONNECTING : DISCONNECT_CONFIRM}
          </Button>
        </div>
      </form>
    </ShellOverlay>
  );
}
