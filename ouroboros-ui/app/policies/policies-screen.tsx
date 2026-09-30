"use client";

import { type FormEvent, useId, useRef, useState } from "react";

import type { DryRunPolicy } from "@/app/api/policies";
import { SettingsFrame } from "@/app/settings/settings-frame";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, Card, cx } from "@/app/ui";

import { setDryRun } from "./policy-actions";
import {
  DRY_RUN_SUMMARY,
  DRY_RUN_TITLE,
  type FlipConfirmation,
  POLICIES_SUBLINE,
  POLICIES_TITLE,
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
 * Settings → Policies (BA.3, [#382](https://github.com/NobuData/ouroboros/issues/382)) — the
 * dry-run row and its flip.
 *
 * **The flip is a real decision**, so it is never one press: it opens a confirmation that states
 * the consequences in plain terms, and only the confirmation sends. A reader below admin sees the
 * policy and why they may not change it; the service refuses them on a direct call too.
 *
 * @param props The workspace's name, the policy as read, whether this reader may flip it, and the
 *   action to flip it with (the Server Action unless a test passes one).
 * @returns The page.
 */
export function PoliciesScreen({
  workspaceName,
  policy: initial,
  mayAdminister,
  onFlip = setDryRun,
}: Readonly<{
  workspaceName: string;
  policy: DryRunPolicy;
  mayAdminister: boolean;
  onFlip?: (dryRun: boolean) => Promise<PolicyFlipResult>;
}>) {
  const [policy, setPolicy] = useState(initial);
  const [confirming, setConfirming] = useState<FlipConfirmation | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const attribution = attributionLine(policy);

  return (
    <SettingsFrame
      actions={null}
      active="policies"
      subline={POLICIES_SUBLINE}
      title={POLICIES_TITLE}
      workspaceName={workspaceName}
    >
      <Card as="section" aria-label={DRY_RUN_TITLE}>
        <div className="policies__row">
          <div className="policies__text">
            <h2 className="policies__name">{DRY_RUN_TITLE}</h2>
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
          <Button
            aria-haspopup="dialog"
            onClick={() => {
              setOutcome(null);
              setConfirming(flipConfirmation(policy));
            }}
            reason={mayAdminister ? undefined : POLICY_READ_ONLY}
            tone={policy.dryRun ? "danger" : "primary"}
          >
            {flipLabel(policy)}
          </Button>
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
      </Card>

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
    </SettingsFrame>
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
