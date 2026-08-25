"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button, TextField } from "@/app/ui";
import { rotateCredential } from "./key-actions";
import {
  type SecretMode,
  CANCEL_LABEL,
  DONE_LABEL,
  SECRET_REQUIRED,
  SECRET_VALIDATING,
  TRY_AGAIN,
  secretKept,
  secretLabel,
  secretNote,
  secretSubmit,
  secretSwapped,
  secretTitle,
} from "./keys";

/**
 * The rotate — and first-save — dialog
 * ([#229](https://github.com/NobuData/ouroboros/issues/229)), whose whole job is to render a
 * state machine honestly.
 *
 * When a rotation fails validation the reader needs three things at once: that it did not
 * work, that **the old key is still active**, and that nothing is broken. A generic error
 * toast communicates none of them, and the reader's rational response to one — retry, or
 * panic and re-enter the old key — is worse than doing nothing. So this dialog draws its
 * states as states:
 *
 * - **entering** — the field and the rail's promise (*the existing key stays in use until
 *   the new one is accepted*).
 * - **validating** — a spinner and the line that says the key is being checked with the
 *   provider.
 * - **succeeded** — the new masked suffix, from the service's own answer.
 * - **failed** — the provider's reason *and*, standing beside it, that the existing key is
 *   still active. The way back is **Try again**, into the field, not a reload.
 *
 * The same dialog stores a first key on a connection whose adapter declares the credential
 * optional — the vLLM card's **Save** — because storing one and replacing one are the same
 * verify-then-write, with nothing to retire in the first case.
 *
 * On a success the card's masked suffix is stale until the route re-reads, so closing a
 * succeeded dialog refreshes it. A close from any other state changes nothing and refreshes
 * nothing.
 */

/** The dialog's own state. */
type Phase =
  | { readonly kind: "entering"; readonly note: string | null }
  | { readonly kind: "validating" }
  | { readonly kind: "succeeded"; readonly mask: string | null }
  | { readonly kind: "failed"; readonly reason: string };

/** What the dialog is told. */
export interface SecretDialogProps {
  /** The connection. */
  readonly connectionId: string;
  /** The card's heading. */
  readonly displayName: string;
  /** Rotate a stored key, or save a first one. */
  readonly mode: SecretMode;
  /** Close the dialog. Called with whether the card should re-read first. */
  readonly onClose: (didSwap: boolean) => void;
}

/**
 * The secret dialog.
 *
 * @param props See {@link SecretDialogProps}.
 * @returns The dialog in whichever of its four states it is in.
 */
export function SecretDialog({ connectionId, displayName, mode, onClose }: SecretDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [phase, setPhase] = useState<Phase>({ kind: "entering", note: null });

  /**
   * Submit the new key.
   *
   * @param event The submit.
   */
  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (pending) return;

    const secret = String(new FormData(event.currentTarget).get("secret") ?? "");

    if (secret === "") {
      setPhase({ kind: "entering", note: SECRET_REQUIRED });
      return;
    }

    setPhase({ kind: "validating" });

    startTransition(async () => {
      const outcome = await rotateCredential(connectionId, secret);

      setPhase(
        outcome.ok
          ? { kind: "succeeded", mask: outcome.mask }
          : { kind: "failed", reason: outcome.reason },
      );
    });
  }

  /** Close, re-reading the card only when a swap actually happened. */
  function close(): void {
    const didSwap = phase.kind === "succeeded";
    if (didSwap) router.refresh();
    onClose(didSwap);
  }

  return (
    <div className="providers-keys__dialog">
      <h2 className="shell-overlay__title">{secretTitle(mode, displayName)}</h2>

      {phase.kind === "succeeded" ? (
        <>
          <p className="providers-keys__note providers-keys__note--ok" role="status">
            {secretSwapped(mode, phase.mask)}
          </p>
          <div className="providers-keys__actions">
            <Button onClick={close} tone="primary" type="button">
              {DONE_LABEL}
            </Button>
          </div>
        </>
      ) : phase.kind === "failed" ? (
        <>
          <p className="providers-keys__note providers-keys__note--err" role="alert">
            {phase.reason}
          </p>
          {/* The one sentence this ticket exists for — stated, standing beside the reason. */}
          <p className="providers-keys__standing">{secretKept(mode)}</p>
          <div className="providers-keys__actions">
            <Button onClick={() => setPhase({ kind: "entering", note: null })} type="button">
              {TRY_AGAIN}
            </Button>
            <Button onClick={close} tone="ghost" type="button">
              {CANCEL_LABEL}
            </Button>
          </div>
        </>
      ) : (
        <form className="providers-keys__form" onSubmit={submit}>
          <p className="shell-overlay__note">{secretNote(mode)}</p>
          <TextField
            autoComplete="off"
            autoFocus
            error={phase.kind === "entering" ? (phase.note ?? undefined) : undefined}
            id={`secret-${connectionId}`}
            label={secretLabel(mode)}
            mono
            name="secret"
            type="password"
          />
          {phase.kind === "validating" && (
            <p className="providers-keys__note" role="status">
              <span aria-hidden="true" className="providers-keys__spinner" />
              {SECRET_VALIDATING}
            </p>
          )}
          <div className="providers-keys__actions">
            <Button
              reason={phase.kind === "validating" ? SECRET_VALIDATING : undefined}
              tone="primary"
              type="submit"
            >
              {secretSubmit(mode)}
            </Button>
            <Button onClick={close} tone="ghost" type="button">
              {CANCEL_LABEL}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
