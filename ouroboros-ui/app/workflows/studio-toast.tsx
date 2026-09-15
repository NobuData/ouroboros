"use client";

import { Button } from "@/app/ui";

import { DISMISS_TOAST_LABEL } from "./publish";
import { useStudioSession } from "./studio-session-context";

import "./workflows.css";

/**
 * The toast a publish that took leaves above the studio grid — S.6
 * ([#152](https://github.com/NobuData/ouroboros/issues/152)).
 *
 * It stays until dismissed, for `app/issues/selection-bar.tsx`'s reason: a message that vanished on a
 * timer is one a keyboard or screen-reader reader may never reach.
 *
 * @returns The toast while there is one; nothing otherwise, and nothing outside a session.
 */
export function StudioToast() {
  const session = useStudioSession();
  if (session === null || session.toast === null) return null;

  return (
    <div className="studio-toast" role="status">
      <span className="studio-toast__text">{session.toast}</span>
      <Button aria-label={DISMISS_TOAST_LABEL} onClick={session.dismissToast} size="sm" tone="ghost">
        ×
      </Button>
    </div>
  );
}
