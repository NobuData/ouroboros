"use client";

import { useEffect } from "react";

import { useSession } from "@/app/api/auth-client";
import { setFontScale } from "@/app/font-scale";

import { readFontScale } from "./preference-actions";

/**
 * The reconciliation leg of the font-scale preference
 * ([#649](https://github.com/NobuData/ouroboros/issues/649)): when the session arrives,
 * ask the server what this *person* chose, and correct the browser if the two disagree.
 *
 * The boot script has already painted whatever this browser's mirror said, which is right
 * for the person who used it last — and stale for the same person after they changed the
 * scale on another machine, and wrong for a different person signing into a shared
 * browser. **The server wins**, because the server is the per-account truth and the mirror
 * is only what made the first paint instant; `setFontScale` re-mirrors as it stamps, so
 * the correction also repairs the mirror for the next boot.
 *
 * Nothing is *saved* here, deliberately. The value came from the server; PATCHing it back
 * would be a write that changes nothing at best, and at worst a race repainting a step the
 * reader chose on another device between our read and our echo.
 *
 * Keyed on the session's user id rather than run once: the shell survives a sign-out and
 * the next sign-in (client-side navigation keeps the layout mounted), and the person the
 * mirror belongs to is exactly what changed. `isPending` guards the moment before the
 * session store has answered — an effect that read `undefined` and reconciled nobody would
 * run before every sign-in.
 *
 * Rendered by the shell, so it exists exactly where sessions do: the `(auth)` screens keep
 * honouring the bare mirror, which is § 4's own line about anonymous screens.
 *
 * @returns Nothing to draw. A component rather than a hook so `AppShell` — a Server
 *   Component — can render it without becoming a client boundary itself.
 */
export function FontScaleSync() {
  const session = useSession();
  const userId = session.data?.user.id;

  useEffect(() => {
    if (userId === undefined) return;

    let cancelled = false;

    readFontScale()
      .then((scale) => {
        // The cancellation is not about leaks — nothing here holds resources — it is about
        // *whose* answer this is: a sign-out during the round trip means the scale that
        // returns belongs to a person no longer here, and stamping it would carry one
        // account's preference into the next account's screen.
        if (!cancelled) setFontScale(scale);
      })
      .catch(() => {
        // The quiet posture, same as the save path: the reader is already looking at the
        // mirror's paint, which was right for this browser a moment ago. A failed read
        // corrects nothing rather than interrupting anything.
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  return null;
}
