"use client";

import { type FormEvent, useId, useRef, useState } from "react";

import { STEP_UP_REQUIRED_CODE } from "@/app/api/errors";
import type { WorkspaceLifecycle } from "@/app/api/settings-lifecycle";
import { PASSWORD_REQUIRED, STEP_UP_FAILED, STEP_UP_PASSWORD } from "@/app/providers/keys";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, TextField } from "@/app/ui";

import {
  CANCEL,
  DELETE_CONFIRM,
  DELETE_LEAD,
  DELETING,
  NAME_MISMATCH,
  STEP_UP_NOTE,
  deleteConsequences,
  deleteDialogTitle,
  nameMatches,
  typeNameReason,
} from "./danger";
import type { LifecycleOutcome } from "./outcome";
import { TypedName } from "./typed-name";

import "./danger.css";

/** What {@link DeleteDialog} takes. */
export interface DeleteDialogProps {
  /** Whether it is showing. */
  readonly open: boolean;
  /** The workspace's name — what the reader types, exactly, to confirm. */
  readonly workspaceName: string;
  /** How long the recovery window is, in days. */
  readonly recoveryWindowDays: number;
  /**
   * Delete the workspace.
   *
   * @param confirmName The name as typed.
   * @param password The step-up, once the service has asked for one.
   */
  readonly onDelete: (
    confirmName: string,
    password?: string,
  ) => Promise<LifecycleOutcome<WorkspaceLifecycle>>;
  /** Called once the workspace is pending deletion. */
  readonly onDeleted: (lifecycle: WorkspaceLifecycle) => void;
  /** Close without deleting. */
  readonly onClose: () => void;
}

/**
 * The **Delete workspace** dialog — owner only
 * (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)).
 *
 * Three gates, each of which tells the reader something:
 *
 * 1. **The consequence list** — what is frozen, who is signed out, how long the workspace can be
 *    restored and what happens when that window closes.
 * 2. **The workspace's name, typed exactly.** Byte for byte, as the service compares it; the
 *    button says why it is inert until the name matches, and a name the service still refuses
 *    (the workspace was renamed underneath the page) is reported under the field.
 * 3. **Step-up authentication**, on #229's pattern (`app/providers/step-up-dialog.tsx`): the
 *    delete is sent, and when the service answers `step_up_required` — the session is older
 *    than it accepts for this — the dialog asks for the password and sends again with it. A
 *    password that does not confirm says *that did not confirm it* and nothing more specific.
 *
 * **The password is never held.** The field is uncontrolled: its value is read from the form in
 * the submit, handed to the one call, and the field is emptied — it is in no state, no prop and
 * no log.
 *
 * @param props See {@link DeleteDialogProps}.
 * @returns The dialog.
 */
export function DeleteDialog({
  open,
  workspaceName,
  recoveryWindowDays,
  onDelete,
  onDeleted,
  onClose,
}: DeleteDialogProps) {
  const described = useId();
  const nameId = useId();
  const passwordId = useId();
  const password = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState("");
  const [stepUp, setStepUp] = useState(false);
  const [sending, setSending] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);
  const [refusal, setRefusal] = useState<string | null>(null);
  // A latch beside the state: two presses inside one frame both read `sending` as false.
  const sent = useRef(false);

  const reason = !nameMatches(typed, workspaceName)
    ? typeNameReason(workspaceName)
    : sending
      ? DELETING
      : undefined;

  /** Close, forgetting everything the reader typed and everything the last attempt said. */
  function close(): void {
    setTyped("");
    setStepUp(false);
    setNameError(undefined);
    setPasswordError(undefined);
    setRefusal(null);
    onClose();
  }

  /**
   * Send the delete, once — with the password when the service has asked for the step-up.
   *
   * @param event The submit.
   */
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (reason !== undefined || sent.current) return;

    const secret = stepUp ? (password.current?.value ?? "") : undefined;

    if (secret === "") {
      setPasswordError(PASSWORD_REQUIRED);
      return;
    }

    sent.current = true;
    setSending(true);
    setNameError(undefined);
    setPasswordError(undefined);
    setRefusal(null);

    try {
      const outcome = await onDelete(typed, secret);

      if (outcome.ok) {
        onDeleted(outcome.value);
      } else if (outcome.code === STEP_UP_REQUIRED_CODE) {
        // Asked for the first time, it is a question; asked again, the password did not answer it.
        if (stepUp) setPasswordError(STEP_UP_FAILED);
        setStepUp(true);
      } else if (outcome.code === NAME_MISMATCH) {
        setNameError(outcome.reason);
      } else {
        setRefusal(outcome.reason);
      }
    } finally {
      // Whatever happened, the password has been used and is not kept in the page.
      if (password.current !== null) password.current.value = "";
      sent.current = false;
      setSending(false);
    }
  }

  const title = deleteDialogTitle(workspaceName);

  return (
    <ShellOverlay describedBy={described} label={title} onClose={close} open={open} role="alertdialog">
      <form className="danger-zone__dialog" onSubmit={(event) => void submit(event)}>
        <h2 className="danger-zone__title">{title}</h2>
        <div className="danger-zone__warning" id={described}>
          <p className="danger-zone__lead">{DELETE_LEAD}</p>
          <ul className="danger-zone__facts">
            {deleteConsequences(recoveryWindowDays).map((consequence) => (
              <li key={consequence}>{consequence}</li>
            ))}
          </ul>
        </div>
        <TypedName
          error={nameError}
          id={nameId}
          onChange={(value) => {
            setTyped(value);
            setNameError(undefined);
          }}
          value={typed}
          workspaceName={workspaceName}
        />
        {stepUp && (
          <>
            <p className="danger-zone__note" role="status">
              {STEP_UP_NOTE}
            </p>
            <TextField
              autoComplete="current-password"
              error={passwordError}
              id={passwordId}
              label={STEP_UP_PASSWORD}
              name="password"
              ref={password}
              type="password"
            />
          </>
        )}
        {refusal !== null && (
          <p className="danger-zone__error" role="alert">
            {refusal}
          </p>
        )}
        <div className="danger-zone__actions">
          <Button onClick={close}>{CANCEL}</Button>
          <Button reason={reason} tone="danger" type="submit">
            {sending ? DELETING : DELETE_CONFIRM}
          </Button>
        </div>
      </form>
    </ShellOverlay>
  );
}
