"use client";

import { type FormEvent, useId, useState } from "react";

import type { WorkflowDefinition } from "@/app/api/workflows";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, TextAreaField } from "@/app/ui";

import { FindingList } from "./finding-list";
import {
  CHANGE_NOTE_HINT,
  CHANGE_NOTE_LABEL,
  PUBLISHING,
  PUBLISH_CANCEL,
  PUBLISH_NOTE,
  type PublishFailure,
  changeNoteProblem,
} from "./publish";

import "./workflows.css";

/** What the dialog takes. */
export interface PublishDialogProps {
  /** The action's label — *Publish v15* — which is also the dialog's title. */
  readonly label: string;
  /** The draft being published, for anchoring findings. */
  readonly definition: WorkflowDefinition;
  /** Publish with this note; resolves to the refusal to show, or `null` once it took. */
  readonly onPublish: (note: string) => Promise<PublishFailure | null>;
  /** Told the stage a finding is about. */
  readonly onSelect: (stageId: string) => void;
  /** Close without publishing. */
  readonly onClose: () => void;
}

/**
 * **Publish v15** — S.6 ([#152](https://github.com/NobuData/ouroboros/issues/152)).
 *
 * A change note, then the gate. A refusal stays in the dialog: the sentence, and for a definition a
 * validator refused, every finding as a control that closes the dialog and selects the stage it is about.
 * A success closes it; the session moves the head and leaves the toast.
 *
 * Mounted only while open, so every opening starts from an empty note and no stale refusal.
 *
 * @param props See {@link PublishDialogProps}.
 * @returns The dialog.
 */
export function PublishDialog({ label, definition, onPublish, onSelect, onClose }: PublishDialogProps) {
  const fields = useId();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<PublishFailure | null>(null);

  const problem = changeNoteProblem(note);

  /**
   * Publish.
   *
   * @param event The submit.
   */
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending || problem !== undefined) return;

    setPending(true);
    setFailure(null);
    try {
      setFailure(await onPublish(note));
    } finally {
      setPending(false);
    }
  }

  return (
    <ShellOverlay label={label} onClose={onClose} open>
      <h2 className="shell-overlay__title">{label}</h2>
      <p className="shell-overlay__note">{PUBLISH_NOTE}</p>

      <form className="studio-dialog" onSubmit={(event) => void submit(event)}>
        <TextAreaField
          error={problem}
          hint={CHANGE_NOTE_HINT}
          id={`${fields}-note`}
          label={CHANGE_NOTE_LABEL}
          name="changeNote"
          onChange={(event) => {
            setNote(event.currentTarget.value);
          }}
          rows={3}
          value={note}
        />

        {failure !== null && (
          <p className="studio-dialog__failure" role="alert">
            {failure.message}
          </p>
        )}
        {failure !== null && failure.findings.length > 0 && (
          <FindingList definition={definition} findings={failure.findings} onSelect={onSelect} />
        )}

        {pending && (
          <p className="studio-dialog__state" role="status">
            {PUBLISHING}
          </p>
        )}

        <div className="studio-dialog__actions">
          <Button reason={pending ? PUBLISHING : problem} tone="primary" type="submit">
            {label}
          </Button>
          <Button onClick={onClose} tone="ghost" type="button">
            {PUBLISH_CANCEL}
          </Button>
        </div>
      </form>
    </ShellOverlay>
  );
}
