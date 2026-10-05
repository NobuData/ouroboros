"use client";

import { useEffect, useId, useRef, useState } from "react";

import { DASHBOARD_PATH } from "@/app/paths";
import { signOutOfSession } from "@/app/shell/actions";
import { switchWorkspace } from "@/app/shell/switch-workspace";
import { Button, Eyebrow } from "@/app/ui";

import { restoreWorkspace } from "./lifecycle-actions";
import {
  COUNTDOWN_LABEL,
  COUNTDOWN_TICK_MS,
  ELSEWHERE_TITLE,
  FROZEN_FACTS,
  FROZEN_TITLE,
  NON_OWNER_NOTE,
  OWNER_NOTE,
  RECOVERY_EYEBROW,
  RESTORE_FAILED,
  RESTORE_LABEL,
  RESTORING_LABEL,
  SIGN_OUT_LABEL,
  recoveryCountdown,
  recoveryLead,
  recoveryTitle,
  switchLabel,
} from "./recovery";

import "./lifecycle.css";

/** Another workspace the reader belongs to. */
export interface OtherWorkspace {
  /** The organization's id — what a switch names. */
  readonly id: string;
  /** Its display name. */
  readonly name: string;
}

/** What {@link RecoveryScreen} takes. */
export interface RecoveryScreenProps {
  /** The frozen workspace's display name. */
  readonly workspaceName: string;
  /** When the recovery window closes — ISO-8601 — or `null` when the service did not say. */
  readonly purgeAfter: string | null;
  /** Whether this reader is an owner, who may restore. */
  readonly restorable: boolean;
  /** The reader's other workspaces — the ways out that are not signing out. */
  readonly others?: readonly OtherWorkspace[];
  /** The clock. Tests pass their own. */
  readonly now?: () => number;
  /** How to leave once restored or switched. Defaults to a full navigation. */
  readonly leave?: (path: string) => void;
}

/**
 * The pending-delete lockout screen
 * (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)) — the one screen a workspace
 * in its recovery window has.
 *
 * It says which workspace, that it is scheduled for deletion and until when, **how long is left**
 * — a live countdown — and what is frozen meanwhile. An **owner** gets **Restore**; anybody else
 * is told who can act, rather than being left at a dead end. Both are given the ways out that
 * already exist: their other workspaces, and signing out.
 *
 * Drawn outside the app shell — the shell's own polls are among what is frozen.
 *
 * @param props See {@link RecoveryScreenProps}.
 * @returns The screen.
 */
export function RecoveryScreen({
  workspaceName,
  purgeAfter,
  restorable,
  others = [],
  now = () => Date.now(),
  leave = (path) => window.location.assign(path),
}: RecoveryScreenProps) {
  const titleId = useId();
  const [time, setTime] = useState(() => now());
  const [busy, setBusy] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  // A latch beside the state: two presses inside one frame both read `busy` as null.
  const sent = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setTime(now()), COUNTDOWN_TICK_MS);

    return () => clearInterval(timer);
  }, [now]);

  /**
   * Run one action behind the latch, saying its refusal on the screen.
   *
   * @param key What is running, for the button that shows it.
   * @param action The action; it answers with the sentence to show, or `null` when it landed.
   */
  async function run(key: string, action: () => Promise<string | null>): Promise<void> {
    if (sent.current) return;

    sent.current = true;
    setBusy(key);
    setRefusal(null);

    try {
      const refused = await action();

      if (refused === null) leave(DASHBOARD_PATH);
      else setRefusal(refused);
    } finally {
      sent.current = false;
      setBusy(null);
    }
  }

  /** Restore the workspace. */
  function restore(): void {
    void run("restore", async () => {
      const outcome = await restoreWorkspace();

      return outcome.ok ? null : outcome.reason || RESTORE_FAILED;
    });
  }

  return (
    <main aria-labelledby={titleId} className="lifecycle-recovery">
      <div className="lifecycle-recovery__card">
        <Eyebrow>{RECOVERY_EYEBROW}</Eyebrow>
        <h1 className="lifecycle-recovery__title" id={titleId}>
          {recoveryTitle(workspaceName)}
        </h1>
        <p className="lifecycle-recovery__lead">{recoveryLead(purgeAfter)}</p>

        <p
          aria-label={COUNTDOWN_LABEL}
          className="lifecycle-recovery__countdown"
          role="timer"
        >
          {recoveryCountdown(purgeAfter, time)}
        </p>

        <section className="lifecycle-recovery__section">
          <h2 className="lifecycle-recovery__heading">{FROZEN_TITLE}</h2>
          <ul className="lifecycle-recovery__facts">
            {FROZEN_FACTS.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </section>

        <p className="lifecycle-recovery__note" role="note">
          {restorable ? OWNER_NOTE : NON_OWNER_NOTE}
        </p>

        {restorable && (
          <div className="lifecycle-recovery__actions">
            <Button
              onClick={restore}
              reason={busy !== null ? RESTORING_LABEL : undefined}
              tone="primary"
            >
              {busy === "restore" ? RESTORING_LABEL : RESTORE_LABEL}
            </Button>
          </div>
        )}

        {refusal !== null && (
          <p className="lifecycle-recovery__refusal" role="alert">
            {refusal}
          </p>
        )}

        <section className="lifecycle-recovery__section">
          <h2 className="lifecycle-recovery__heading">{ELSEWHERE_TITLE}</h2>
          <div className="lifecycle-recovery__actions">
            {others.map((other) => (
              <Button
                key={other.id}
                onClick={() => void run(other.id, () => switchWorkspace(other.id))}
                reason={busy !== null ? RESTORING_LABEL : undefined}
                size="sm"
              >
                {switchLabel(other.name)}
              </Button>
            ))}
            <form action={signOutOfSession}>
              <Button size="sm" tone="ghost" type="submit">
                {SIGN_OUT_LABEL}
              </Button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
