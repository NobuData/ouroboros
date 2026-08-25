"use client";

import { useRouter } from "next/navigation";
import { useId, useOptimistic, useState, useTransition } from "react";

import { Toggle, cx } from "@/app/ui";

import { setProviderEnabled } from "./card-actions";
import { SWITCHED_OFF, SWITCH_READ_ONLY, switchLabel } from "./cards";

/**
 * The card's enable switch ([#228](https://github.com/NobuData/ouroboros/issues/228)) —
 * the one control on a provider card that changes something today.
 *
 * The control is the #46 {@link Toggle}, and the behaviour is `app/dashboard/auto-merge-switch.tsx`'s
 * to the line: it moves when pressed and reconciles afterwards, because this is a *setting*
 * on a page nobody reaches without a session, and a switch that waited for a round trip
 * before moving is not how a switch behaves anywhere else in software. The optimistic
 * position is `useOptimistic`'s and lives exactly as long as the transition that set it, so
 * a flip that did not persist goes back without anybody remembering to put it back, and a
 * change made elsewhere arrives as a changed prop and is drawn.
 *
 * **A disabled connection drops out of routing**, and the card says so under the switch
 * ({@link SWITCHED_OFF}) rather than leaving a dimmed card to explain itself. The service is
 * what enforces it — resolution reads `where enabled` (V018) — and this control is the
 * visible end of that fact.
 *
 * **A switch that may not be pressed still renders**, in its real position, marked and
 * explained — the design system's § 3.3 permission-limited state, for § 3.5's reason. The
 * gate that decides is the service's; `card-actions.ts` says what happens when somebody goes
 * around the presentation.
 */

/** What the switch takes. */
export interface ProviderSwitchProps {
  /** The connection. */
  readonly id: string;
  /** The card's heading — what the switch is named for. */
  readonly displayName: string;
  /** Where the switch stands on the server — the listing's `enabled`, freshly read. */
  readonly enabled: boolean;
  /** Whether this reader may change it. `false` renders the read-only control. */
  readonly mayAdminister: boolean;
}

/**
 * The switch, and whatever it has to say for itself.
 *
 * @param props See {@link ProviderSwitchProps}.
 * @returns The switch, with the off-state note or the read-only reason or the last press's
 *   refusal under it — whichever applies, and never more than one.
 */
export function ProviderSwitch({ id, displayName, enabled, mayAdminister }: ProviderSwitchProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [checked, setChecked] = useOptimistic(enabled);
  const [failure, setFailure] = useState<string | null>(null);
  const noteId = useId();

  // One note at a time, most consequential first: a refusal the reader just caused, then the
  // standing reason a role cannot press it, then the fact that routing skips an off card.
  const note = !mayAdminister ? SWITCH_READ_ONLY : (failure ?? (checked ? null : SWITCHED_OFF));

  /**
   * Move the switch, then ask the server to say where it stands.
   *
   * A press while a write is in flight is ignored rather than queued — see the dashboard's
   * switch for why a switch that lands on whichever request answered last is worse than one
   * that waits half a second.
   */
  function press(): void {
    if (pending) return;

    const next = !checked;

    setFailure(null);

    startTransition(async () => {
      setChecked(next);

      const outcome = await setProviderEnabled(id, next);

      if (!outcome.ok) {
        setFailure(outcome.reason);
        return;
      }

      // Inside the transition, so the optimistic position holds until the route has
      // re-rendered from a fresh listing rather than blinking back to the stale prop.
      router.refresh();
    });
  }

  return (
    <div className="providers-card__switch">
      <Toggle
        checked={checked}
        describedBy={note === null ? undefined : noteId}
        label={switchLabel(displayName)}
        onClick={press}
        reason={mayAdminister ? undefined : SWITCH_READ_ONLY}
      />
      {note !== null && (
        <p
          className={cx("providers-card__switch-note", failure !== null && "providers-card__switch-note--err")}
          id={noteId}
          // A refusal is an alert: the reader pressed something and it did not take. The
          // other two notes are standing facts about the card, already the switch's
          // description, and announcing them on arrival would interrupt the page.
          role={failure !== null ? "alert" : undefined}
        >
          {note}
        </p>
      )}
    </div>
  );
}
