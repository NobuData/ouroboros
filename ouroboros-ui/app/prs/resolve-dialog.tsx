"use client";

import { type FormEvent, useId, useState } from "react";

import { ShellOverlay } from "@/app/shell/overlay";
import { Button, TextAreaField, Toggle } from "@/app/ui";

import { MAX_THREAD_REPLY_LENGTH, type ThreadResolveRequest } from "./outcomes";
import type { TextDialogOutcome } from "./text-dialog";
import { RESOLVE_LABEL, RESOLVE_SENDING } from "./thread";

/** The dialog's title. */
export const RESOLVE_TITLE = "Reply and resolve";

/** What the dialog says a resolution does. */
export const RESOLVE_CONSEQUENCE =
  "Resolving is recorded once: the entry, the resolution and the reply cannot be rewritten " +
  "afterwards. What was said, and who said it, stays as it is.";

/** The reply field's label. */
export const REPLY_LABEL = "Reply";

/** What the reply field says beneath it. */
export const REPLY_HINT =
  "Optional. Shown beneath the entry as written — “Addressed in attempt 4 — sampling decoupled from telemetry drain.”";

/** The mirror switch's accessible name. */
export const MIRROR_LABEL = "Post the reply on the PR";

/** What is said beside the mirror switch. */
export const MIRROR_NOTE =
  "Also post the reply as a comment on the PR, with your name, so a reviewer on the host sees it.";

/** Why the mirror switch waits while there is no reply. */
export const MIRROR_NEEDS_REPLY = "Write a reply to post it on the PR.";

/** The dialog's cancel. */
export const RESOLVE_CANCEL = "Keep it open";

/** The entry a dialog is opened for. */
export interface ResolveSubject {
  /** Who said it — `cursor/composer-2`. */
  readonly author: string;
  /** What was said. */
  readonly body: string;
}

/** What the dialog is told. */
export interface ResolveDialogProps {
  /** The entry being resolved, or `null` while the dialog is closed. */
  readonly entry: ResolveSubject | null;
  /** Close it — Escape, the backdrop, the cancel, or a resolution that landed. */
  readonly onClose: () => void;
  /** Send the resolution. A refusal comes back as a value and is drawn in the dialog. */
  readonly onConfirm: (request: ThreadResolveRequest) => Promise<TextDialogOutcome>;
}

/**
 * *Reply & resolve*'s dialog ([#368](https://github.com/NobuData/ouroboros/issues/368)).
 *
 * The reply is optional — an entry may simply be dealt with — and is sent trimmed, once. The
 * mirror switch is inert, with the reason, while there is no reply to post; clearing the reply
 * clears the mirror with it, so nothing is ever asked of the host with nothing to say.
 *
 * The modal contract — focus in, Tab kept inside, Escape and a press outside close, focus back to
 * the button that opened it — is the shell overlay's.
 *
 * @param props See {@link ResolveDialogProps}.
 * @returns The dialog while an entry is given, nothing otherwise.
 */
export function ResolveDialog({ entry, onClose, onConfirm }: ResolveDialogProps) {
  const fieldId = useId();
  const mirrorNoteId = useId();
  const [text, setText] = useState("");
  const [mirror, setMirror] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const trimmed = text.trim();
  const mirrored = mirror && trimmed !== "";

  /** Close, leaving nothing behind for the next opening. */
  function close(): void {
    setText("");
    setMirror(false);
    setRefusal(null);
    onClose();
  }

  /**
   * Send the resolution — once.
   *
   * @param event The form's submission.
   */
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setRefusal(null);
    void onConfirm(
      trimmed === "" ? { mirror: false } : { reply: trimmed, mirror: mirrored },
    ).then((outcome) => {
      setBusy(false);
      if (outcome.ok) {
        close();
        return;
      }
      setRefusal(outcome.reason);
    });
  }

  return (
    <ShellOverlay label={RESOLVE_TITLE} onClose={close} open={entry !== null} role="dialog">
      <form className="prv-dialog" noValidate onSubmit={submit}>
        <h2 className="shell-overlay__title">{RESOLVE_TITLE}</h2>

        <div className="prv-dialog__lead">
          <p className="prv-dialog__note prv-resolve__author">{entry?.author}</p>
          <p className="prv-dialog__claim">{entry?.body}</p>
          <p className="prv-dialog__note">{RESOLVE_CONSEQUENCE}</p>
        </div>

        <TextAreaField
          hint={REPLY_HINT}
          id={fieldId}
          label={REPLY_LABEL}
          maxLength={MAX_THREAD_REPLY_LENGTH}
          onChange={(event) => setText(event.currentTarget.value)}
          rows={4}
          value={text}
        />

        <div className="prv-resolve__mirror">
          <Toggle
            checked={mirrored}
            describedBy={mirrorNoteId}
            label={MIRROR_LABEL}
            onClick={() => setMirror((current) => !current)}
            reason={trimmed === "" ? MIRROR_NEEDS_REPLY : undefined}
          />
          <span className="prv-resolve__mirror-note" id={mirrorNoteId}>
            {MIRROR_NOTE}
          </span>
        </div>

        {refusal !== null && (
          <p className="prv-dialog__error" role="alert">
            {refusal}
          </p>
        )}

        <div className="prv-dialog__actions">
          <Button reason={busy ? RESOLVE_SENDING : undefined} tone="primary" type="submit">
            {busy ? RESOLVE_SENDING : RESOLVE_LABEL}
          </Button>
          <Button onClick={close} tone="ghost" type="button">
            {RESOLVE_CANCEL}
          </Button>
        </div>
      </form>
    </ShellOverlay>
  );
}
