"use client";

import { type FormEvent, useId, useRef, useState } from "react";

import type { DryRunPolicy } from "@/app/api/policies";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, cx } from "@/app/ui";

import { setDryRun } from "./policy-actions";
import {
  DRY_RUN_SUMMARY,
  DRY_RUN_TITLE,
  type FlipConfirmation,
  POLICY_CANCEL,
  POLICY_READ_ONLY,
  POLICY_SENDING,
  type PolicyFlipResult,
  attributionLine,
  flipConfirmation,
  flipLabel,
  policyStatus,
} from "./view";

import "./policies.css";

/**
 * The dry-run policy's row and its flip (BA.3,
 * [#382](https://github.com/NobuData/ouroboros/issues/382)) — mounted in the settings hub's
 * **Policies** section.
 *
 * It was a page of its own, *Settings → Policies*, until BS.1
 * ([#491](https://github.com/NobuData/ouroboros/issues/491)) built the hub: the section is an
 * anchor of that page now, and this is the one policy control that exists to put in it. The
 * rest of mockup 17's Autonomy policies card is BS.4's
 * ([#494](https://github.com/NobuData/ouroboros/issues/494)).
 *
 * **The flip is a real decision**, so it is never one press: it opens a confirmation that states
 * the consequences in plain terms, and only the confirmation sends. That is also what kind of
 * control it is under the hub's save model (decision S7): an **immediate action behind a
 * confirmation**, not a field — it never joins the page's unsaved changes, and **Save changes**
 * never sends it.
 *
 * **A reader below admin sees the policy, not a switched-off button.** Where it stands, when it
 * last changed and why they may not change it are all text; the hub's read-only rule is that
 * nothing on the page looks broken. The service refuses them on a direct call too.
 *
 * @param props The policy as read, whether this reader may flip it, and the action to flip it
 *   with (the Server Action unless a test passes one).
 * @returns The row, and its confirmation while one is open.
 */
export function DryRunRow({
  policy: initial,
  mayAdminister,
  onFlip = setDryRun,
}: Readonly<{
  policy: DryRunPolicy;
  mayAdminister: boolean;
  onFlip?: (dryRun: boolean) => Promise<PolicyFlipResult>;
}>) {
  const [policy, setPolicy] = useState(initial);
  const [confirming, setConfirming] = useState<FlipConfirmation | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const attribution = attributionLine(policy);

  return (
    <div aria-label={DRY_RUN_TITLE} className="policies" role="group">
      <div className="policies__row">
        <div className="policies__text">
          <h3 className="policies__name">{DRY_RUN_TITLE}</h3>
          <p className="policies__summary">{DRY_RUN_SUMMARY}</p>
          <p
            className={cx(
              "policies__status",
              policy.dryRun ? "policies__status--on" : "policies__status--off",
            )}
            role="status"
          >
            {policyStatus(policy)}
          </p>
          {attribution !== null && <p className="policies__attribution">{attribution}</p>}
        </div>
        {mayAdminister && (
          <Button
            aria-haspopup="dialog"
            onClick={() => {
              setOutcome(null);
              setConfirming(flipConfirmation(policy));
            }}
            // Never the accent fill: the page's one primary action is **Save changes**.
            tone={policy.dryRun ? "danger" : "default"}
          >
            {flipLabel(policy)}
          </Button>
        )}
      </div>
      {!mayAdminister && (
        <p className="policies__readonly" role="note">
          {POLICY_READ_ONLY}
        </p>
      )}
      {outcome !== null && (
        <p className="policies__outcome" role="status">
          {outcome}
        </p>
      )}

      <FlipDialog
        confirmation={confirming}
        onClose={() => {
          setConfirming(null);
        }}
        onConfirm={async (dryRun) => {
          const result = await onFlip(dryRun);

          if (result.ok) {
            setPolicy(result.policy);
            setOutcome(policyStatus(result.policy));
          }

          return result;
        }}
      />
    </div>
  );
}

/**
 * The confirmation — the consequences, then the one button that sends.
 *
 * @param props What it states (or `null` while closed), how to close it, and what confirming does.
 * @returns The dialog.
 */
function FlipDialog({
  confirmation,
  onClose,
  onConfirm,
}: Readonly<{
  confirmation: FlipConfirmation | null;
  onClose: () => void;
  onConfirm: (dryRun: boolean) => Promise<PolicyFlipResult>;
}>) {
  const described = useId();
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  // A latch as well as the state: two presses inside one frame both read `sending` as false.
  const sent = useRef(false);

  /** Close, leaving no refusal behind for the next opening. */
  function close(): void {
    setRefusal(null);
    onClose();
  }

  /**
   * Send the flip — once.
   *
   * @param event The form's submission.
   */
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (confirmation === null || sent.current) return;

    sent.current = true;
    setSending(true);
    setRefusal(null);
    void onConfirm(confirmation.dryRun).then((result) => {
      sent.current = false;
      setSending(false);
      if (result.ok) {
        close();
        return;
      }
      setRefusal(result.reason);
    });
  }

  return (
    <ShellOverlay
      describedBy={described}
      label={confirmation?.title ?? ""}
      onClose={close}
      open={confirmation !== null}
      role="alertdialog"
    >
      {confirmation !== null && (
        <form className="policies-confirm" noValidate onSubmit={submit}>
          <h2 className="shell-overlay__title">{confirmation.title}</h2>

          <ul
            className={cx(
              "policies-confirm__consequences",
              confirmation.loosens && "policies-confirm__consequences--loosens",
            )}
            id={described}
          >
            {confirmation.consequences.map((consequence) => (
              <li className="policies-confirm__consequence" key={consequence}>
                {consequence}
              </li>
            ))}
          </ul>

          {refusal !== null && (
            <p className="policies-confirm__error" role="alert">
              {refusal}
            </p>
          )}

          <div className="policies-confirm__actions">
            <Button
              reason={sending ? POLICY_SENDING : undefined}
              tone={confirmation.loosens ? "danger" : "primary"}
              type="submit"
            >
              {sending ? POLICY_SENDING : confirmation.confirm}
            </Button>
            <Button onClick={close} tone="ghost" type="button">
              {POLICY_CANCEL}
            </Button>
          </div>
        </form>
      )}
    </ShellOverlay>
  );
}
