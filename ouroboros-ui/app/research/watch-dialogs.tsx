"use client";

import { type FormEvent, useId, useState, useTransition } from "react";

import type { RegressionWatchItem } from "@/app/api/research";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, TextAreaField, TextField } from "@/app/ui";

import {
  CANCEL,
  CAPTURE_FAILED,
  CAPTURE_LABEL,
  CAPTURE_NOTE,
  CAPTURE_RELEASE_HELP,
  CAPTURE_RELEASE_LABEL,
  CAPTURE_REPOSITORY_HELP,
  CAPTURE_REPOSITORY_LABEL,
  CAPTURE_SUBMIT,
  CAPTURING,
  CLOSE,
  DISMISSING,
  DISMISS_FAILED,
  DISMISS_LABEL,
  DISMISS_NOTE,
  DISMISS_READ_ONLY,
  DISMISS_REASON_LABEL,
  DISMISS_REASON_MAX,
  DISMISS_SUBMIT,
  DISMISS_TITLE,
  RELEASE_PATTERN,
  REPOSITORY_PATTERN,
  captureSummary,
  dismissName,
  watchTitle,
} from "./side";
import { captureBaselines, dismissWatchItem } from "./side-actions";

/**
 * The regression watch's two writes (CN.3, [#629](https://github.com/NobuData/ouroboros/issues/629)):
 * dismissing an item, which asks for the reason the audit log keeps, and capturing a release's
 * baselines, which is how a workspace with none gets its first. Both are an administrator's;
 * the service decides, and its refusal is printed in its own words.
 */

/** What the dismiss control takes. */
export interface DismissItemProps {
  /** The item. */
  readonly item: RegressionWatchItem;
  /** Whether the reader may dismiss. */
  readonly mayAdminister: boolean;
  /** Called once the item is dismissed, so the card drops the row. */
  readonly onDismissed: (itemId: string) => void;
}

/**
 * A row's **dismiss** and its reason dialog.
 *
 * @param props See {@link DismissItemProps}.
 * @returns The control.
 */
export function DismissItem({ item, mayAdminister, onDismissed }: DismissItemProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const noteId = useId();
  const reasonId = useId();

  /** Close the dialog, forgetting what was typed. */
  function close(): void {
    setOpen(false);
    setReason("");
    setFailure(null);
  }

  /**
   * Dismiss the item with the typed reason.
   *
   * @param event The submit.
   */
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const why = reason.trim();

    if (pending || why.length === 0) return;

    setFailure(null);

    startTransition(async () => {
      const outcome = await dismissWatchItem(item.id, why);

      if (!outcome.ok) {
        setFailure(outcome.refusal.message.length === 0 ? DISMISS_FAILED : outcome.refusal.message);
        return;
      }

      close();
      onDismissed(outcome.value);
    });
  }

  return (
    <>
      <Button
        aria-label={dismissName(item)}
        onClick={() => setOpen(true)}
        reason={mayAdminister ? undefined : DISMISS_READ_ONLY}
        size="sm"
        tone="ghost"
        type="button"
      >
        {DISMISS_LABEL}
      </Button>

      <ShellOverlay describedBy={noteId} label={DISMISS_TITLE} onClose={close} open={open}>
        <form className="research__enable" onSubmit={submit}>
          <h2 className="shell-overlay__title">{DISMISS_TITLE}</h2>
          <p className="research__enable-note" id={noteId}>
            <strong>{watchTitle(item)}</strong> — {DISMISS_NOTE}
          </p>

          <TextAreaField
            id={reasonId}
            label={DISMISS_REASON_LABEL}
            maxLength={DISMISS_REASON_MAX}
            onChange={(event) => setReason(event.currentTarget.value)}
            required
            rows={3}
            value={reason}
          />

          {failure !== null && (
            <p className="research__refusal" role="alert">
              {failure}
            </p>
          )}

          <div className="research__enable-actions">
            <Button onClick={close} tone="ghost" type="button">
              {CANCEL}
            </Button>
            <Button
              reason={pending ? DISMISSING : reason.trim().length === 0 ? DISMISS_REASON_LABEL : undefined}
              tone="primary"
              type="submit"
            >
              {pending ? DISMISSING : DISMISS_SUBMIT}
            </Button>
          </div>
        </form>
      </ShellOverlay>
    </>
  );
}

/** What the capture control takes. */
export interface CaptureBaselineProps {
  /** Called once a capture answered, so the card re-reads. */
  readonly onCaptured: () => void;
}

/**
 * The empty state's **Capture a baseline** and its dialog. Mounted for administrators only —
 * everyone else reads why not.
 *
 * @param props See {@link CaptureBaselineProps}.
 * @returns The control.
 */
export function CaptureBaseline({ onCaptured }: CaptureBaselineProps) {
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const noteId = useId();
  const repositoryId = useId();
  const releaseId = useId();

  /** Close the dialog; a capture that stored something re-reads the card. */
  function close(): void {
    setOpen(false);
    setFailure(null);

    if (summary !== null) {
      setSummary(null);
      onCaptured();
    }
  }

  /**
   * Capture the named release's baselines.
   *
   * @param event The submit.
   */
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (pending) return;

    const data = new FormData(event.currentTarget);
    const text = (name: string): string => {
      const value = data.get(name);

      return typeof value === "string" ? value.trim() : "";
    };

    setFailure(null);

    startTransition(async () => {
      const outcome = await captureBaselines(text("repository"), text("releaseTag"));

      if (!outcome.ok) {
        setFailure(outcome.refusal.message.length === 0 ? CAPTURE_FAILED : outcome.refusal.message);
        return;
      }

      setSummary(captureSummary(outcome.value.captured.length, outcome.value.skipped));
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" tone="primary" type="button">
        {CAPTURE_LABEL}
      </Button>

      <ShellOverlay describedBy={noteId} label={CAPTURE_LABEL} onClose={close} open={open}>
        <h2 className="shell-overlay__title">{CAPTURE_LABEL}</h2>

        {summary !== null ? (
          <div className="research__enable">
            <p className="research__enable-note" id={noteId} role="status">
              {summary}
            </p>
            <div className="research__enable-actions">
              <Button onClick={close} tone="primary" type="button">
                {CLOSE}
              </Button>
            </div>
          </div>
        ) : (
          <form className="research__enable" onSubmit={submit}>
            <p className="research__enable-note" id={noteId}>
              {CAPTURE_NOTE}
            </p>

            <TextField
              hint={CAPTURE_REPOSITORY_HELP}
              id={repositoryId}
              label={CAPTURE_REPOSITORY_LABEL}
              mono
              name="repository"
              pattern={REPOSITORY_PATTERN}
              required
            />
            <TextField
              hint={CAPTURE_RELEASE_HELP}
              id={releaseId}
              label={CAPTURE_RELEASE_LABEL}
              mono
              name="releaseTag"
              pattern={RELEASE_PATTERN}
              required
            />

            {failure !== null && (
              <p className="research__refusal" role="alert">
                {failure}
              </p>
            )}

            <div className="research__enable-actions">
              <Button onClick={close} tone="ghost" type="button">
                {CANCEL}
              </Button>
              <Button reason={pending ? CAPTURING : undefined} tone="primary" type="submit">
                {pending ? CAPTURING : CAPTURE_SUBMIT}
              </Button>
            </div>
          </form>
        )}
      </ShellOverlay>
    </>
  );
}
