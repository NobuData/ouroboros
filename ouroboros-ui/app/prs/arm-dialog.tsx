"use client";

import { type FormEvent, useId, useRef, useState } from "react";

import { ShellOverlay } from "@/app/shell/overlay";
import { Button } from "@/app/ui";

import {
  ARM_CANCEL,
  ARM_CONFIRM,
  ARM_SENDING,
  type ConfirmationView,
  IRREVERSIBLE,
  MERGE_CONFIRM,
  MERGE_SENDING,
  TERMS_MOVED,
} from "./merge-plan";
import { RECHECK_TERMS } from "./merge-terms";
import type { TextDialogOutcome } from "./text-dialog";

/** What the dialog is told. */
export interface ArmDialogProps {
  /** What it states, read when it opened — or `null` while it is closed. */
  readonly terms: ConfirmationView | null;
  /** Whether the PR moved under it since — a new head, a changed plan, a gate no longer green. */
  readonly moved: boolean;
  /** Close it — Escape, the backdrop, the cancel, or a confirmation that landed. */
  readonly onClose: () => void;
  /**
   * Arm, or merge, as the terms state. The service checks again, so a refusal comes back here as
   * a value and the dialog stays open to say so.
   */
  readonly onConfirm: (terms: ConfirmationView) => Promise<TextDialogOutcome>;
}

/**
 * The Merge plan card's confirmation ([#369](https://github.com/NobuData/ouroboros/issues/369)) —
 * for *Merge when all gates green*, and for *Merge now*.
 *
 * **It states the exact terms, not "are you sure?".** Arming authorises an irreversible merge at
 * a moment nobody will be watching, so the dialog names the revision, each gate the merge is
 * waiting on and where that gate stands, the re-check made at merge time, what the merge does
 * afterwards, and who it is made as. What it states is what it sends: the revision is the one
 * read when it opened.
 *
 * **It goes inert when the PR moves under it.** A new head, a changed plan or a gate that is no
 * longer green means the reader would be agreeing to something other than what is on screen, so
 * the button waits and the dialog says to look again.
 *
 * **Announced as a danger action.** The panel is an `alertdialog` described by its terms; focus
 * opens on the panel rather than on a button, so Enter on arrival confirms nothing. Tab is trapped
 * in the panel and Escape closes it (`ShellOverlay`). A refusal from the service is drawn here, in
 * its own words.
 *
 * @param props See {@link ArmDialogProps}.
 * @returns The dialog while open, nothing otherwise.
 */
export function ArmDialog({ terms, moved, onClose, onConfirm }: ArmDialogProps) {
  const described = useId();
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  // A latch as well as the state: two presses inside one frame both read `sending` as false.
  const sent = useRef(false);

  const merging = terms?.kind === "merge";
  const busy = merging ? MERGE_SENDING : ARM_SENDING;
  const reason = sending ? busy : moved ? TERMS_MOVED : undefined;

  /** Close, leaving no refusal behind for the next opening. */
  function close(): void {
    setRefusal(null);
    onClose();
  }

  /**
   * Send the confirmation — once, and only for the terms on screen.
   *
   * @param event The form's submission.
   */
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (terms === null || moved || sent.current) return;

    sent.current = true;
    setSending(true);
    setRefusal(null);
    void onConfirm(terms).then((outcome) => {
      sent.current = false;
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
      describedBy={described}
      label={terms?.title ?? ""}
      onClose={close}
      open={terms !== null}
      role="alertdialog"
    >
      {terms !== null && (
        <form className="prv-arm" noValidate onSubmit={submit}>
          <h2 className="shell-overlay__title">{terms.title}</h2>

          <div className="prv-arm__terms" id={described}>
            <p className="prv-arm__text">{terms.terms}</p>
            {!merging && <p className="prv-arm__text">{RECHECK_TERMS}</p>}
            <p className="prv-arm__text">{IRREVERSIBLE}</p>
          </div>

          {terms.waiting.length > 0 && (
            <ul aria-label="Gates this merge waits on" className="prv-arm__gates">
              {terms.waiting.map((gate) => (
                <li className="prv-arm__gate" key={gate.key}>
                  <span className="prv-arm__name">{gate.line}</span>
                  <span className="prv-arm__note">{gate.note}</span>
                </li>
              ))}
            </ul>
          )}

          <dl className="prv-arm__facts">
            <div className="prv-arm__fact">
              <dt className="prv-arm__key">Against</dt>
              <dd className="prv-arm__value">{terms.revision}</dd>
            </div>
            <div className="prv-arm__fact">
              <dt className="prv-arm__key">Strategy</dt>
              <dd className="prv-arm__value">{terms.strategy}</dd>
            </div>
            {terms.actions.length > 0 && (
              <div className="prv-arm__fact">
                <dt className="prv-arm__key">Then</dt>
                <dd className="prv-arm__value">{terms.actions.join(" · ")}</dd>
              </div>
            )}
          </dl>

          <p className="prv-arm__identity">{terms.identity}</p>

          {moved && (
            <p className="prv-arm__error" role="alert">
              {TERMS_MOVED}
            </p>
          )}

          {refusal !== null && (
            <p className="prv-arm__error" role="alert">
              {refusal}
            </p>
          )}

          <div className="prv-arm__actions">
            <Button reason={reason} tone="danger" type="submit">
              {sending ? busy : merging ? MERGE_CONFIRM : ARM_CONFIRM}
            </Button>
            <Button onClick={close} tone="ghost" type="button">
              {ARM_CANCEL}
            </Button>
          </div>
        </form>
      )}
    </ShellOverlay>
  );
}
