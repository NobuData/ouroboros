"use client";

import { useId, useRef, useState, type FormEvent } from "react";

import type { PullRequestHead } from "@/app/api/pull-requests";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button } from "@/app/ui";

import type { ReturnOutcome } from "./outcomes";
import {
  RETURN_CANCEL,
  RETURN_GATES_LABEL,
  RETURN_KEEPS,
  RETURN_NEEDS_GATE,
  RETURN_SENDING,
  type RedGate,
  returnConfirmLabel,
  returnCosts,
  returnTitle,
} from "./view";

/** What the dialog is told. */
export interface ReturnDialogProps {
  /** Whether it is open. */
  readonly open: boolean;
  /** Close it — Escape, the backdrop, the cancel, or a queued return. */
  readonly onClose: () => void;
  /** The PR's head — its number and its loop are named in the consequences. */
  readonly head: PullRequestHead;
  /** The latest revision's red gates, in the gates card's order. */
  readonly gates: readonly RedGate[];
  /**
   * Send the return with the gates selected. The service re-reads the gates, so a refusal comes
   * back here as a value and the dialog stays open to say so.
   */
  readonly onConfirm: (gates: readonly string[]) => Promise<ReturnOutcome>;
}

/**
 * *Return to loop*'s danger dialog ([#363](https://github.com/NobuData/ouroboros/issues/363)).
 *
 * **A decision surface, not a confirmation.** Returning a PR discards nothing but costs time and
 * tokens, and what the agent receives is the evidence of the gates chosen here (#361) — so the
 * dialog lists every red gate with its evidence line, all selected to begin with, and the reader
 * takes out what the loop should not be steered by. The button says how many gates it sends and
 * stays inert, with the reason, while none is selected.
 *
 * **Announced as a danger action.** The panel is an `alertdialog` whose description is what the
 * return costs and keeps; focus opens on the first gate, Tab is trapped in the panel and Escape
 * closes it (`ShellOverlay`). A refusal from the service is drawn here rather than swallowed.
 *
 * @param props See {@link ReturnDialogProps}.
 * @returns The dialog while open, nothing otherwise.
 */
export function ReturnDialog({ open, onClose, head, gates, onConfirm }: ReturnDialogProps) {
  const consequences = useId();
  const first = useRef<HTMLInputElement>(null);
  // What the reader took out, rather than what is in: a gate that turns red while the dialog is
  // open arrives selected, as every gate does when it opens.
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const selected = gates.filter((gate) => !excluded.has(gate.key)).map((gate) => gate.key);
  const reason = sending
    ? RETURN_SENDING
    : selected.length === 0
      ? RETURN_NEEDS_GATE
      : undefined;

  /** Close, leaving no selection behind for the next opening. */
  function close(): void {
    setExcluded(new Set());
    setRefusal(null);
    onClose();
  }

  /**
   * Put a gate in the selection, or take it out.
   *
   * @param key The gate.
   * @param include Whether it is sent.
   */
  function choose(key: string, include: boolean): void {
    setExcluded((current) => {
      const next = new Set(current);
      if (include) next.delete(key);
      else next.add(key);

      return next;
    });
  }

  /**
   * Send the return — once, and only with something selected.
   *
   * @param event The form's submission.
   */
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (selected.length === 0 || sending) return;

    setSending(true);
    setRefusal(null);
    void onConfirm(selected).then((outcome) => {
      setSending(false);
      if (outcome.ok) {
        close();
        return;
      }
      setRefusal(outcome.reason);
    });
  }

  return (
    <ShellOverlay
      describedBy={consequences}
      initialFocus={first}
      label={returnTitle(head.number)}
      onClose={close}
      open={open}
      role="alertdialog"
    >
      <form className="prv-return" noValidate onSubmit={submit}>
        <h2 className="shell-overlay__title">{returnTitle(head.number)}</h2>
        <div className="prv-return__consequences" id={consequences}>
          <p className="prv-return__text">{returnCosts(head)}</p>
          <p className="prv-return__text">{RETURN_KEEPS}</p>
        </div>

        <fieldset className="prv-return__gates">
          <legend className="prv-return__legend">{RETURN_GATES_LABEL}</legend>
          {gates.map((gate, index) => (
            <label className="prv-return__gate" key={gate.key}>
              <input
                checked={!excluded.has(gate.key)}
                className="prv-return__checkbox"
                onChange={(event) => choose(gate.key, event.currentTarget.checked)}
                ref={index === 0 ? first : undefined}
                type="checkbox"
              />
              <span className="prv-return__name">{gate.label}</span>
              <span className="prv-return__evidence">{gate.evidence}</span>
            </label>
          ))}
        </fieldset>

        {refusal !== null && (
          <p className="prv-return__error" role="alert">
            {refusal}
          </p>
        )}

        <div className="prv-return__actions">
          <Button reason={reason} tone="danger" type="submit">
            {sending ? RETURN_SENDING : returnConfirmLabel(selected.length)}
          </Button>
          <Button onClick={close} tone="ghost" type="button">
            {RETURN_CANCEL}
          </Button>
        </div>
      </form>
    </ShellOverlay>
  );
}
