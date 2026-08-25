"use client";

import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";

import { Button, TextField, cx } from "@/app/ui";
import { ShellOverlay } from "@/app/shell/overlay";
import { useSecondsNow } from "@/app/shell/clock";

import { REVEAL, ROTATE, SAVE_KEY, type SecretRow } from "./cards";
import { revealCredential } from "./key-actions";
import {
  type RevealOutcome,
  type SecretMode,
  type StepUpMethod,
  COPIED,
  COPY,
  COPY_FAILED,
  MASK_NOW,
  REVEAL_RECORDED,
  STEP_UP_TITLE,
  expiryOf,
  masksIn,
  remainingSeconds,
  secretTitle,
} from "./keys";
import { SecretDialog } from "./secret-dialog";
import { StepUpDialog } from "./step-up-dialog";

/**
 * The key row's live controls ([#229](https://github.com/NobuData/ouroboros/issues/229)) —
 * **Reveal** and **Rotate** on a stored key, **Save** on an empty optional one — with the
 * masked field and the step-up and rotate dialogs behind them.
 *
 * The card (`provider-card.tsx`) is a Server Component; this is the one client island in its
 * key row, drawn only when the connection has a secret row. It owns two things: the reveal
 * state machine, and which dialog is open.
 *
 * ### Reveal is deliberately inconvenient, and each friction reads as intentional
 *
 * `masked → step-up → shown → masked`. A click asks the service; without a recent
 * re-authentication the answer is a challenge, drawn as {@link StepUpDialog} rather than an
 * error. A shown value carries a **countdown**, an **audited-notice**, and a **copy** button
 * that claims nothing about the clipboard — and it masks itself the instant the countdown
 * reaches zero **or** the reader navigates away. The mask-again is not politeness: a
 * credential left on a screen is the exfiltration surface decision P4 exists to deny.
 *
 * ### Why the countdown is the shell clock and not a timer of its own
 *
 * `app/shell/clock.ts` is one interval for the page; a `setInterval` per revealed row would
 * be one per row, each drifting. The row reads the shared second and derives its own
 * remaining time from the service's `expiresAt`, so the number is the service's instruction
 * rather than the browser's guess.
 *
 * ### Navigate-away is the pathname, and unmount is the backstop
 *
 * `usePathname()` re-renders this island on every client-side navigation, so a change from
 * the path the value was revealed on masks it. A hard navigation unmounts the card, which
 * clears the value with it — the same guarantee from the other side.
 */

/** Which dialog, if any, is open over the row. */
type Dialog =
  | { readonly kind: "none" }
  | {
      readonly kind: "step-up";
      readonly methods: readonly StepUpMethod[];
      readonly maxAgeSeconds: number;
    }
  | { readonly kind: "secret"; readonly mode: SecretMode };

/** The revealed value, while it is shown. */
interface Shown {
  readonly value: string;
  /** The instant to mask at, in whole seconds since the epoch. */
  readonly expiresAt: number;
  /** The path it was revealed on — a change masks it. */
  readonly path: string;
}

/** What the row is told. */
export interface KeyRowProps {
  /** The connection. */
  readonly connectionId: string;
  /** The card's heading — what the dialogs name. */
  readonly displayName: string;
  /** The masked row, as decided: label, mask (or null for an empty optional key), placeholder. */
  readonly secret: SecretRow;
  /** Whether this reader may act. A member sees the masked field and no buttons at all. */
  readonly mayAdminister: boolean;
}

/**
 * The key row.
 *
 * @param props See {@link KeyRowProps}.
 * @returns The masked field with its actions — or, while a value is revealed, the value with
 *   its countdown, copy and audited-notice.
 */
export function KeyRow({ connectionId, displayName, secret, mayAdminister }: KeyRowProps) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useState<Shown | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });

  const fieldId = `provider-${connectionId}-key`;
  const empty = secret.mask === null;

  // The shell's shared second; seeded with the expiry so a server render that never has a
  // revealed value still matches on hydration.
  const now = useSecondsNow(shown?.expiresAt ?? 0);
  const remaining = shown === null ? 0 : remainingSeconds(shown.expiresAt, now);

  // Mask on expiry and on navigating away — the two the criteria name — by adjusting state
  // during render rather than in an effect: the clock ticking and the pathname changing are
  // both renders, and React re-renders this component with the value cleared before it ever
  // commits the shown one to the DOM. The guard turns false the moment `shown` is null, so
  // this cannot loop. (React's documented "adjust state while rendering" pattern; a credential
  // must leave state the instant it is masked, so the value is not kept and derived away.)
  if (shown !== null && (remaining === 0 || shown.path !== pathname)) {
    setShown(null);
    setCopied(null);
  }

  /** Act on a reveal's outcome, wherever it came from. */
  function apply(outcome: RevealOutcome): void {
    if (outcome.ok) {
      setShown({ value: outcome.value, expiresAt: expiryOf(outcome.expiresAt), path: pathname });
      setNote(null);
      setCopied(null);
      setDialog({ kind: "none" });
      return;
    }

    if (outcome.kind === "step-up") {
      setDialog({ kind: "step-up", methods: outcome.methods, maxAgeSeconds: outcome.maxAgeSeconds });
      return;
    }

    setNote(outcome.reason);
    setDialog({ kind: "none" });
  }

  /** Reveal — the first attempt, leaning on a recent session. */
  function reveal(): void {
    if (pending) return;
    setNote(null);

    startTransition(async () => {
      apply(await revealCredential(connectionId));
    });
  }

  /** Mask a shown value now, before the countdown does. */
  function maskNow(): void {
    setShown(null);
    setCopied(null);
  }

  /** Copy the shown value, making no promise about how long the clipboard keeps it. */
  function copy(): void {
    if (shown === null) return;

    void navigator.clipboard
      ?.writeText(shown.value)
      .then(() => setCopied(COPIED))
      .catch(() => setCopied(COPY_FAILED));
  }

  return (
    <div className="providers-card__key-row">
      {shown === null ? (
        <TextField
          className="providers-card__key"
          id={fieldId}
          label={<span className="sr-only">{secret.label}</span>}
          mono
          placeholder={secret.placeholder ?? undefined}
          readOnly
          value={secret.mask ?? ""}
        />
      ) : (
        <div className="providers-card__revealed">
          <TextField
            className="providers-card__key"
            id={fieldId}
            label={<span className="sr-only">{secret.label}</span>}
            mono
            readOnly
            value={shown.value}
          />
          <p className="providers-card__reveal-meta">
            <span aria-live="off" className="providers-card__countdown">
              {masksIn(remaining)}
            </span>
            <span className="providers-card__audited">{REVEAL_RECORDED}</span>
          </p>
          {copied !== null && (
            <p
              className={cx(
                "providers-keys__note",
                copied === COPY_FAILED && "providers-keys__note--err",
              )}
              role="status"
            >
              {copied}
            </p>
          )}
        </div>
      )}

      {mayAdminister && (
        <div className="providers-card__key-actions">
          {shown === null ? (
            <>
              {!empty && (
                <Button onClick={reveal} reason={pending ? REVEAL : undefined} size="sm">
                  {REVEAL}
                </Button>
              )}
              <Button
                onClick={() => setDialog({ kind: "secret", mode: empty ? "save" : "rotate" })}
                size="sm"
              >
                {empty ? SAVE_KEY : ROTATE}
              </Button>
            </>
          ) : (
            <>
              <Button onClick={copy} size="sm">
                {COPY}
              </Button>
              <Button onClick={maskNow} size="sm" tone="ghost">
                {MASK_NOW}
              </Button>
            </>
          )}
        </div>
      )}

      {note !== null && (
        <p className="providers-keys__note providers-keys__note--err" role="alert">
          {note}
        </p>
      )}

      <ShellOverlay
        label={dialog.kind === "secret" ? secretTitle(dialog.mode, displayName) : STEP_UP_TITLE}
        onClose={() => setDialog({ kind: "none" })}
        open={dialog.kind !== "none"}
      >
        {dialog.kind === "step-up" && (
          <StepUpDialog
            connectionId={connectionId}
            displayName={displayName}
            maxAgeSeconds={dialog.maxAgeSeconds}
            methods={dialog.methods}
            onResult={apply}
          />
        )}
        {dialog.kind === "secret" && (
          <SecretDialog
            connectionId={connectionId}
            displayName={displayName}
            mode={dialog.mode}
            onClose={() => setDialog({ kind: "none" })}
          />
        )}
      </ShellOverlay>
    </div>
  );
}
