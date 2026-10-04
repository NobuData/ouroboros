"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { type Proceed, setLeaveGuard } from "@/app/shell/leave-guard";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button } from "@/app/ui";

import { LEAVE_CANCEL, LEAVE_CONFIRM, LEAVE_TITLE, leaveBody, leavingPath } from "./leave";
import { useSettingsSave } from "./save-provider";

import "./settings.css";

/**
 * The guard on leaving the settings page with unsaved changes
 * (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491), decision **S7**).
 *
 * `app/settings/leave.ts` decides what counts as leaving and what to ask; this listens for the
 * departures and draws the question. It is armed only while something is unsaved, so a clean
 * page — and every page of a reader who may not edit — is not listened to at all.
 *
 * ### Three roads out, three listeners
 *
 * - **The tab itself** — a reload, a close, a link to another site. `beforeunload` is the only
 *   thing that can hold those, and the browser words the prompt itself.
 * - **A link inside the application** — the sidebar, a tab of this section, a link in a card.
 *   Heard on `window` in the capture phase, ahead of the router's own click handling, and
 *   stopped there: the question is asked, and the router is given the destination only on
 *   *discard and leave*. A modified click, a fragment of this page and another origin are left
 *   alone — `leavingPath` says why.
 * - **A departure the shell makes without a link** — the command palette, a workspace switch,
 *   signing out. Those ask through `app/shell/leave-guard.ts`, where this registers.
 *
 * Back and forward are not held: a traversal has already happened by the time a page can hear
 * it, and undoing one from under the router would cost more than it saves.
 *
 * @returns The question, while a departure is waiting on it.
 */
export function SettingsLeaveGuard() {
  const router = useRouter();
  const save = useSettingsSave();
  const described = useId();

  /** The departure waiting for an answer, or `null`. */
  const [waiting, setWaiting] = useState<{ readonly proceed: Proceed } | null>(null);

  const dirty = save.pending > 0;

  useEffect(() => {
    if (!dirty) return;

    const onUnload = (event: BeforeUnloadEvent): void => {
      // The browser's own *leave site?* prompt.
      event.preventDefault();
    };

    const onClick = (event: MouseEvent): void => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement)) return;

      const path = leavingPath(
        event,
        { href: link.href, target: link.target, download: link.hasAttribute("download") },
        window.location,
      );
      if (path === null) return;

      // Before the router hears it, and before the browser follows it.
      event.preventDefault();
      event.stopPropagation();
      setWaiting({
        proceed: () => {
          router.push(path);
        },
      });
    };

    const release = setLeaveGuard((proceed) => {
      setWaiting({ proceed });
    });

    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("click", onClick, { capture: true });

    return () => {
      release();
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("click", onClick, { capture: true });
    };
  }, [dirty, router]);

  /** Stay: the edits are kept exactly as they were, and so is the page. */
  function stay(): void {
    setWaiting(null);
  }

  /**
   * Take the departure the reader asked for.
   *
   * The edits are not dropped here: leaving is what discards them — the page unmounts, or is
   * re-keyed for another workspace — so a departure that does not happen (a workspace switch
   * the service refuses) leaves the reader on the page with their edits intact.
   */
  function leave(): void {
    if (waiting === null) return;

    setWaiting(null);
    waiting.proceed();
  }

  return (
    <ShellOverlay
      describedBy={described}
      label={LEAVE_TITLE}
      onClose={stay}
      open={waiting !== null}
      role="alertdialog"
    >
      {waiting !== null && (
        <>
          <h2 className="shell-overlay__title">{LEAVE_TITLE}</h2>
          <p className="shell-overlay__note" id={described}>
            {leaveBody(save.pending)}
          </p>

          <div className="settings-leave__actions">
            <Button onClick={leave} tone="danger" type="button">
              {LEAVE_CONFIRM}
            </Button>
            <Button onClick={stay} tone="ghost" type="button">
              {LEAVE_CANCEL}
            </Button>
          </div>
        </>
      )}
    </ShellOverlay>
  );
}
