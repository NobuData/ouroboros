"use client";

import { useState, useTransition } from "react";

import type { SlackConnection, SlackVerification } from "@/app/api/chatops";
import { Button, cx } from "@/app/ui";

import { verifyConnection } from "./chatops-actions";
import {
  FACT_SEPARATOR,
  HEALTH_LABEL,
  type HealthFact,
  REINSTALL_LABEL,
  VERIFYING_LABEL,
  VERIFY_FAILED,
  VERIFY_LABEL,
  brokenNote,
  healthFacts,
  refusalText,
  refused,
  repairFor,
  revokedReason,
  verificationNote,
} from "./view";

/** What the strip takes. */
export interface HealthStripProps {
  /** The connection — one that exists: connected, revoked or failing. */
  readonly connection: SlackConnection;
  /** Whether this reader may verify and re-install — an owner or an admin. */
  readonly mayAdminister: boolean;
  /** The instant the page was read, which *verified 2m ago* is measured from. */
  readonly now: Date;
  /** Called with a verification's answer, so the page draws the connection as it now stands. */
  readonly onVerified: (verification: SlackVerification) => void;
}

/** The class each tone takes — literal, so the style suite can see every one. */
const TONE_CLASS: Readonly<Record<HealthFact["tone"], string | null>> = {
  plain: null,
  ok: "chatops__fact--ok",
  warn: "chatops__fact--warn",
  err: "chatops__fact--err",
};

/**
 * The connection health strip (CA.1, [#541](https://github.com/NobuData/ouroboros/issues/541)) —
 * `acme-robotics · app v2.4 · scopes ✓ · active · verified 2m ago`, under the head whenever a
 * connection exists.
 *
 * **This is where somebody finds out.** When Slack revokes the app or a scope is missing, the
 * strip says so in words — the status and the platform's own reason, the missing scopes by name
 * — rather than leaving it to be discovered by a build failure that never reached a channel.
 * Hue is added to the words, never used in their place.
 *
 * **A broken connection comes with its repair.** *Re-install* is a plain link to the install
 * route, the same full-page navigation the Settings integrations tile makes, for an owner or an
 * admin; everyone else is told who can. *Verify now* asks Slack on the spot and redraws the
 * strip from the answer; its refusal is printed beside it.
 *
 * @param props See {@link HealthStripProps}.
 * @returns The strip.
 */
export function HealthStrip({ connection, mayAdminister, now, onVerified }: HealthStripProps) {
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const facts = healthFacts(connection, now);
  const note = brokenNote(connection);
  const repair = repairFor(connection, mayAdminister);
  const reason = revokedReason(connection);

  /** Ask Slack whether the token still works, and hand the answer up. */
  function verify(): void {
    if (pending) return;

    setFailure(null);

    startTransition(async () => {
      try {
        const outcome = await verifyConnection();

        if (refused(outcome)) {
          setFailure(refusalText(outcome.error, VERIFY_FAILED));
          return;
        }

        setFailure(verificationNote(outcome.result));
        onVerified(outcome);
      } catch {
        setFailure(VERIFY_FAILED);
      }
    });
  }

  return (
    <section aria-label={HEALTH_LABEL} className="chatops__health">
      <div className="chatops__health-row">
        <ul className="chatops__facts">
          {facts.map((fact, index) => (
            <li className={cx("chatops__fact", TONE_CLASS[fact.tone])} key={fact.key}>
              {index > 0 && (
                <span aria-hidden="true" className="chatops__fact-sep">
                  {FACT_SEPARATOR}
                </span>
              )}
              <span>{fact.text}</span>
            </li>
          ))}
        </ul>
        {mayAdminister && (
          <Button onClick={verify} reason={pending ? VERIFYING_LABEL : undefined} size="sm" tone="ghost">
            {pending ? VERIFYING_LABEL : VERIFY_LABEL}
          </Button>
        )}
      </div>

      {reason !== null && <p className="chatops__health-reason">{reason}</p>}

      {note !== null && (
        <div className="chatops__health-broken">
          <p className="chatops__health-note">
            {note}
            {repair?.kind === "note" && <> {repair.text}</>}
          </p>
          {repair?.kind === "reinstall" && (
            <Button href={repair.href} size="sm" tone="primary">
              {REINSTALL_LABEL}
            </Button>
          )}
        </div>
      )}

      {failure !== null && (
        <p className="chatops__refusal" role="alert">
          {failure}
        </p>
      )}
    </section>
  );
}
