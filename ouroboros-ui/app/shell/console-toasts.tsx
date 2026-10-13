"use client";

import { useEffect, useSyncExternalStore } from "react";

import { Button } from "@/app/ui";

import { DISMISS_TOAST, TOASTS_LABEL } from "./console";
import { ConsoleMark } from "./console-view";
import {
  NO_TOASTS,
  consoleToasts,
  dismissConsoleToast,
  stopConsoleWatches,
  subscribeConsoleToasts,
} from "./console-watch";

import "./shell.css";

/**
 * Where a command's result turns up when it arrives after the command was acknowledged (BZ.5,
 * [#539](https://github.com/NobuData/ouroboros/issues/539)).
 *
 * **The shell's seat, because the result is not any page's.** Every other toast in the product
 * sits under the head of the page whose action raised it (`app/farm/submit-toast.tsx`,
 * `app/knowledge/knowledge-toast.tsx`) — there was no application-wide one before this. A
 * command is run from the palette, which belongs to no page, and its result may arrive after
 * the reader has moved to another one; so the seat is mounted once by `app/shell/app-shell.tsx`
 * and placed against the viewport, the way an overlay is.
 *
 * It keeps the house's shape for a toast all the same: a seat that is **always mounted**, so
 * the live region exists before it has something to say; the sentence, then its link, then a
 * dismissal; and **it stays until dismissed** — nothing here disappears on a clock
 * (`app/workflows/studio-toast.tsx` states the rule).
 *
 * Its unmount is what ends every wait (`app/shell/console-watch.ts`): the shell going away is
 * the one event after which a result has nowhere to be shown.
 *
 * @returns The seat, with a toast in it for each result that has arrived and not been dismissed.
 */
export function ConsoleToasts() {
  const toasts = useSyncExternalStore(subscribeConsoleToasts, consoleToasts, () => NO_TOASTS);

  useEffect(() => stopConsoleWatches, []);

  return (
    <div className="shell-toasts" role="status" aria-label={TOASTS_LABEL}>
      {toasts.map((toast) => (
        <div className="shell-toast" key={toast.id}>
          <p className="shell-toast__line">
            <ConsoleMark tone={toast.tone} />{" "}
            <code className="shell-toast__command">{toast.line}</code>
          </p>
          <p className="shell-toast__text">{toast.text}</p>
          <div className="shell-toast__actions">
            {toast.link !== null && (
              <Button href={toast.link.url} size="sm" tone="ghost">
                {toast.link.label}
              </Button>
            )}
            <Button
              aria-label={DISMISS_TOAST}
              onClick={() => dismissConsoleToast(toast.id)}
              size="sm"
              tone="ghost"
            >
              <span aria-hidden="true">×</span>
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
