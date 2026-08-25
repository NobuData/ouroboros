"use client";

import { useState, useTransition } from "react";

import { Button, TextField } from "@/app/ui";
import { reauthenticate, revealCredential } from "./key-actions";
import {
  type RevealOutcome,
  type StepUpMethod,
  PASSWORD_REQUIRED,
  STEP_UP_CHECKING,
  STEP_UP_CONFIRM,
  STEP_UP_FAILED,
  STEP_UP_NO_METHOD,
  STEP_UP_PASSWORD,
  STEP_UP_SIGN_IN,
  STEP_UP_SIGN_IN_NOTE,
  STEP_UP_TITLE,
  stepUpNote,
} from "./keys";

/**
 * The step-up challenge ([#229](https://github.com/NobuData/ouroboros/issues/229)) — the
 * friction the reveal earns, made to read as intentional rather than broken.
 *
 * Reveal puts a live credential on a real screen, so AD.2
 * ([#223](https://github.com/NobuData/ouroboros/issues/223)) makes a live session
 * insufficient: the reader re-authenticates immediately before the value is returned. This
 * dialog is the visible half of that. It offers the two methods the service accepts and no
 * third, because a provider re-confirm is a redirect and a new session — the `session`
 * method with extra steps:
 *
 * - **A password**, confirmed through the service — the method for an account that has one.
 * - **A fresh sign-in**, which creates a session inside the window and is the only method a
 *   GitHub-only account has. It is a sign-out with this page as the return-to, so the reader
 *   lands back where they were.
 *
 * ### It does not own the reveal
 *
 * The dialog collects a password and hands it to {@link revealCredential}; the *result* goes
 * back to the key row through {@link StepUpDialogProps.onResult}, because a success is a
 * value to show in place and a fresh challenge is this dialog staying open. What the dialog
 * decides for itself is only its own note — a wrong password says {@link STEP_UP_FAILED} and
 * nothing more specific, because the service answers a wrong password exactly as an absent
 * one and this page cannot honestly say more.
 */

/** What the dialog is told. */
export interface StepUpDialogProps {
  /** The connection to reveal. */
  readonly connectionId: string;
  /** The card's heading, for the dialog's one sentence about why. */
  readonly displayName: string;
  /** The methods the challenge named, filtered to the ones this page can offer. */
  readonly methods: readonly StepUpMethod[];
  /** The window the service confirmed for, in seconds. */
  readonly maxAgeSeconds: number;
  /**
   * What a fresh attempt produced — a success to show, or a plain refusal to surface. A
   * further step-up keeps the dialog open and is handled here rather than escaping.
   */
  readonly onResult: (outcome: RevealOutcome) => void;
}

/**
 * The step-up form.
 *
 * @param props See {@link StepUpDialogProps}.
 * @returns The password form when the account has one, the sign-in path always, or the
 *   sign-in path alone when the challenge named no method this page can offer.
 */
export function StepUpDialog({
  connectionId,
  displayName,
  methods,
  maxAgeSeconds,
  onResult,
}: StepUpDialogProps) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  const mayUsePassword = methods.includes("password");

  /**
   * Confirm with a password.
   *
   * @param event The submit.
   */
  function confirm(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (pending) return;

    const password = String(new FormData(event.currentTarget).get("password") ?? "");

    if (password === "") {
      setNote(PASSWORD_REQUIRED);
      return;
    }

    setNote(null);

    startTransition(async () => {
      const outcome = await revealCredential(connectionId, password);

      // A further step-up means the password did not confirm it: stay open, say so, and
      // let the reader try again or sign in. Anything else — a success, a plain refusal —
      // is the key row's to act on.
      if (!outcome.ok && outcome.kind === "step-up") {
        setNote(STEP_UP_FAILED);
        return;
      }

      onResult(outcome);
    });
  }

  return (
    <div className="providers-keys__dialog">
      <h2 className="shell-overlay__title">{STEP_UP_TITLE}</h2>
      <p className="shell-overlay__note">{stepUpNote(displayName, maxAgeSeconds)}</p>

      {methods.length === 0 && <p className="shell-overlay__note">{STEP_UP_NO_METHOD}</p>}

      {mayUsePassword && (
        <form className="providers-keys__form" onSubmit={confirm}>
          <TextField
            autoComplete="current-password"
            autoFocus
            error={note ?? undefined}
            id={`step-up-${connectionId}`}
            label={STEP_UP_PASSWORD}
            name="password"
            type="password"
          />
          <Button block tone="primary" type="submit">
            {pending ? STEP_UP_CHECKING : STEP_UP_CONFIRM}
          </Button>
        </form>
      )}

      {!mayUsePassword && note !== null && (
        <p className="providers-keys__note providers-keys__note--err" role="alert">
          {note}
        </p>
      )}

      <form action={reauthenticate} className="providers-keys__reauth">
        <p className="shell-overlay__note">{STEP_UP_SIGN_IN_NOTE}</p>
        <Button block tone={mayUsePassword ? "ghost" : "primary"} type="submit">
          {STEP_UP_SIGN_IN}
        </Button>
      </form>
    </div>
  );
}
