"use client";

import { Button } from "@/app/ui";

import { LIVE_CARD_TITLE_ID } from "./live";
import { DISMISS_TOAST, GO_TO_LIVE_LOG, queuedToast } from "./submit";
import { useSubmit } from "./submit-store";

/**
 * What a submitted build leaves behind: *Queued #483 in pool-a*, and the way to the live log
 * card (AI.5, [#260](https://github.com/NobuData/ouroboros/issues/260)).
 *
 * ### The seat is always mounted
 *
 * A live region announces what is *added to it*, so it has to exist before it has something to
 * say — `app/farm/enroll-card.tsx`'s toast is built the same way. The seat is an empty
 * `role="status"` under the head; the toast arrives inside it.
 *
 * ### It stays until it is dismissed
 *
 * Never on a timer: a message that vanished by itself is one a keyboard or a screen-reader
 * reader may never reach (`app/workflows/studio-toast.tsx` states the rule).
 *
 * ### The way to the live card is a button that moves focus
 *
 * *Linking to the live log card* is done the way the head's **+ Enroll runner** reaches the
 * enroll card (`app/farm/farm-head.tsx`): the pane — not the window — is the scroll container,
 * and focus is the one mechanism that scrolls it natively, so this focuses the live card's
 * heading rather than navigating to a fragment. A heading is not focusable by itself; it is
 * given `tabindex="-1"` at the moment of the move, which makes it a programmatic target without
 * adding a tab stop to the page.
 *
 * **It says *queued*, and that is the honest word.** The build waits in its pool until a runner
 * accepts it, and a queued build cannot be selected into the card
 * (`app/farm/selection-store.tsx` holds a runner, never a job). The card binds it by itself the
 * moment it starts — the newest running build wins (`app/farm/live.ts`).
 *
 * @returns The seat, and the toast inside it while there is one.
 */
export function SubmitToast() {
  const { submitted, dismiss } = useSubmit();

  return (
    <div className="farm-submit-toast__seat" role="status">
      {submitted !== null && (
        <div className="farm-submit-toast">
          <span className="farm-submit-toast__text">{queuedToast(submitted)}</span>
          <Button onClick={focusLiveCard} size="sm" tone="ghost">
            {GO_TO_LIVE_LOG}
          </Button>
          <Button aria-label={DISMISS_TOAST} onClick={dismiss} size="sm" tone="ghost">
            <span aria-hidden="true">×</span>
          </Button>
        </div>
      )}
    </div>
  );
}

/** Move the reader to the live log card — see the module note for why this is focus. */
function focusLiveCard(): void {
  const heading = document.getElementById(LIVE_CARD_TITLE_ID);
  if (heading === null) return;

  heading.setAttribute("tabindex", "-1");
  heading.focus();
}
