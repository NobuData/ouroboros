"use client";

import { useId, useState } from "react";

import type { AnalysisSuggestion } from "@/app/api/analyzer";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, TextAreaField } from "@/app/ui";

import { useAnalyzer } from "./analyzer-store";
import {
  DISMISS_GUARANTEE,
  DISMISS_LABEL,
  DISMISS_TITLE,
  MAX_REASON_LENGTH,
  REASON_HINT,
  REASON_LABEL,
  reasonOf,
  reasonProblem,
} from "./suggestions-view";

/**
 * The confirmation behind **Dismiss** (BW.3,
 * [#518](https://github.com/NobuData/ouroboros/issues/518)) — a dismissal is permanent, so it is
 * said to be before it is made: *this suggestion won't be suggested again*, even when a later
 * analysis finds the same pattern. A reason may be left and none is required.
 *
 * Confirming resolves the row **at once** (the store's optimistic dismissal) and closes the
 * dialog; if the service refuses, the row is put back open with the reason on it.
 *
 * An `alertdialog`, described by the guarantee: what cannot be undone is read out when it opens.
 *
 * @param props.suggestion The suggestion whose **Dismiss** was pressed, or `null`.
 * @param props.onClose Called when the reader backs out.
 * @param props.onResolved Called with the suggestion's id once it has been dismissed.
 * @returns The dialog while a suggestion is given; nothing otherwise.
 */
export function DismissDialog({
  suggestion,
  onClose,
  onResolved,
}: Readonly<{
  suggestion: AnalysisSuggestion | null;
  onClose: () => void;
  onResolved: (id: string) => void;
}>) {
  const guaranteeId = useId();

  return (
    <ShellOverlay
      describedBy={guaranteeId}
      label={DISMISS_TITLE}
      onClose={onClose}
      open={suggestion !== null}
      role="alertdialog"
    >
      {suggestion !== null && (
        <DismissForm
          guaranteeId={guaranteeId}
          key={suggestion.id}
          onClose={onClose}
          onResolved={onResolved}
          suggestion={suggestion}
        />
      )}
    </ShellOverlay>
  );
}

/**
 * The dialog's form, for one suggestion.
 *
 * @param props.suggestion The suggestion.
 * @param props.guaranteeId The id the persistence guarantee answers to.
 * @param props.onClose Called to back out.
 * @param props.onResolved Called once the dismissal has been made.
 * @returns The form.
 */
function DismissForm({
  suggestion,
  guaranteeId,
  onClose,
  onResolved,
}: Readonly<{
  suggestion: AnalysisSuggestion;
  guaranteeId: string;
  onClose: () => void;
  onResolved: (id: string) => void;
}>) {
  const { dismiss } = useAnalyzer();
  const fieldId = useId();
  const [typed, setTyped] = useState("");
  const problem = reasonProblem(typed);

  /**
   * Dismiss the suggestion with what was typed.
   *
   * @param event The form's submit.
   */
  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (problem !== undefined) return;

    dismiss(suggestion.id, reasonOf(typed));
    onResolved(suggestion.id);
  }

  return (
    <form className="analyzer-dismiss" noValidate onSubmit={submit}>
      <div>
        <h2 className="shell-overlay__title">{DISMISS_TITLE}</h2>
        <p className="analyzer-dismiss__subject">{suggestion.title}</p>
      </div>
      <p className="analyzer-dismiss__guarantee" id={guaranteeId}>
        {DISMISS_GUARANTEE}
      </p>
      <TextAreaField
        error={problem}
        hint={REASON_HINT}
        id={fieldId}
        label={REASON_LABEL}
        maxLength={MAX_REASON_LENGTH}
        onChange={(event) => setTyped(event.target.value)}
        rows={3}
        value={typed}
      />
      <div className="analyzer-dismiss__actions">
        <Button onClick={onClose} tone="ghost">
          Cancel
        </Button>
        <Button reason={problem} tone="danger" type="submit">
          {DISMISS_LABEL}
        </Button>
      </div>
    </form>
  );
}
