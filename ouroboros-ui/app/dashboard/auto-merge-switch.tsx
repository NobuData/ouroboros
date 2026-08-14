"use client";

import { useRouter } from "next/navigation";
import { useId, useOptimistic, useState, useTransition } from "react";

import { Toggle, cx } from "@/app/ui";

import { setAutoMerge } from "./pulse-actions";
import { AUTO_MERGE_READ_ONLY } from "./view";

/**
 * The **Auto-merge when checks pass** row — the dashboard's one control that changes
 * something ([#83](https://github.com/NobuData/ouroboros/issues/83), over
 * [#74](https://github.com/NobuData/ouroboros/issues/74)).
 *
 * The control is the #46 {@link Toggle}. What this adds is everything about the press: who
 * may make one, what the switch shows between the press and the answer, and what it does
 * when the answer is no. The row's caption and whatever the switch has to say for itself
 * live here rather than in the card, because all three are one control.
 *
 * ### Why this one is optimistic where the login screen's switches are forms
 *
 * `app/login/enablement-switch.tsx` is a submit button in a one-field form, and its
 * paragraph explains why: the login screen is the *first* screen of the product on an
 * unknown connection, so a control that works before hydration is worth more than an
 * animation. This switch is on a page nobody reaches without a session, beside a table that
 * is already ticking a clock — hydration has happened — and it is a *setting* rather than a
 * step in a flow. So it moves when it is pressed and reconciles afterwards, which is the
 * behaviour a switch has everywhere else in software.
 *
 * That is a promise about the failure case, not a licence to skip it. **A flip that did not
 * persist goes back**, and the reason is drawn under the row: this switch changes what the
 * loop does without asking a human, and a switch left drawn in a position the server does not
 * hold would be the one dishonest control on a page built to be honest.
 *
 * ### The server's answer wins, and nothing has to remember to hand it back
 *
 * The optimistic position is `useOptimistic`'s, which means it lives exactly as long as the
 * transition that set it: the moment the write and the refresh behind it have finished, the
 * switch is drawing `enabled` again — the aggregate's `pulse.autoMerge`, freshly read. That
 * is one property doing three jobs, and each of them is a bug this component does not have to
 * remember to avoid:
 *
 * - **A failed write needs no rollback**, because the optimistic value simply expires with
 *   its transition; there is no stored position to put back and no path on which somebody
 *   could forget to.
 * - **A write that landed on a different value than it sent** — somebody else pressed first
 *   — is drawn from the refreshed read rather than from what this browser asked for.
 * - **A change nobody made here** — a poll, another administrator — arrives as a changed prop
 *   and is drawn, because between transitions there is nothing else to draw.
 *
 * An effect synchronising a `useState` copy against the prop would render the stale position
 * once and correct it in a second pass, which is a switch visibly flicking back and forth.
 *
 * `router.refresh()` is also this card's half of
 * [#87](https://github.com/NobuData/ouroboros/issues/87)'s criterion — *"refetch triggered
 * by … auto-merge PATCH"*. Until the polling hook lands it is the whole of it: the route's
 * Server Components re-run and every card is redrawn from a fresh aggregate, which is the
 * *"verified by the next poll"* the acceptance criterion asks for, without a navigation.
 *
 * ### A switch that may not be pressed still renders
 *
 * `owner` and `admin` may change a workspace; `member` and `viewer` may look at it
 * (`openapi.yaml`, and #74's role gate). A role that may not press it gets the same control
 * in the same position, marked `aria-disabled`, with {@link AUTO_MERGE_READ_ONLY} as its
 * tooltip and its description — the design system's § 3.3 permission-limited state, for
 * § 3.5's reason: hiding the switch would leave a card that looks like it has no setting, and
 * a `disabled` button would drop the explanation out of the tab order along with the control.
 *
 * The gate that *decides* is the service's, not this component's. A Server Action is a POST
 * endpoint anybody can reach, so the browser's copy of the rule is presentation, and
 * `app/dashboard/pulse-actions.ts` says what happens when somebody goes around it.
 */

/** What the row takes. */
export interface AutoMergeSwitchProps {
  /**
   * Where the switch stands on the server — the aggregate's `pulse.autoMerge`. A change to
   * it is what retires an optimistic position, so it must be the *read* value rather than
   * anything this component last sent.
   */
  readonly enabled: boolean;
  /**
   * Whether this reader may change it. `false` renders the read-only control; it does not
   * hide it, and it is not what stops a forged write.
   */
  readonly canAdminister: boolean;
}

/** What the row is called, as the mockup captions it. */
export const AUTO_MERGE_LABEL = "Auto-merge when checks pass";

/**
 * The switch's accessible name.
 *
 * What pressing it would do, rather than what the row is called: the caption beside it is
 * already in the accessibility tree, and a control whose name repeats the text next to it
 * makes a screen reader say the same words twice. It never changes with the position —
 * `aria-checked` is what carries that.
 */
const SWITCH_LABEL = "Merge pull requests automatically when checks pass";

/**
 * The row.
 *
 * @param props See {@link AutoMergeSwitchProps}.
 * @returns The caption, the switch, and whatever it has to say — the reason it cannot be
 *   pressed, or the reason the last press did not take.
 */
export function AutoMergeSwitch({ enabled, canAdminister }: AutoMergeSwitchProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // What this browser draws while it waits to be told. Between transitions it is `enabled`
  // itself, which is what makes the server the only lasting authority on this switch.
  const [checked, setChecked] = useOptimistic(enabled);
  const [failure, setFailure] = useState<string | null>(null);
  const noteId = useId();

  const note = canAdminister ? failure : AUTO_MERGE_READ_ONLY;

  /**
   * Move the switch, then ask the server to say where it stands.
   *
   * A press while a write is in flight is ignored rather than queued: the second press would
   * race the first one's refresh, and a switch that ends up in the position of whichever
   * request happened to answer last is worse than one that waits half a second.
   */
  function press(): void {
    if (pending) return;

    const next = !checked;

    setFailure(null);

    startTransition(async () => {
      // Inside the transition, because that is what an optimistic value is scoped to — and
      // it is therefore also what puts the switch back when the write below does not land.
      setChecked(next);

      const result = await setAutoMerge(next);

      if (!result.ok) {
        setFailure(result.reason);
        return;
      }

      // The refresh is inside the transition as well, so the optimistic position holds until
      // the route has re-rendered from a fresh aggregate rather than blinking back to the
      // stale prop while the request is in flight.
      router.refresh();
    });
  }

  return (
    <div className="dash-pulse__control">
      <div className="dash-pulse__switch">
        <span className="dash-pulse__switch-label">{AUTO_MERGE_LABEL}</span>
        <Toggle
          checked={checked}
          label={SWITCH_LABEL}
          onClick={press}
          reason={canAdminister ? undefined : AUTO_MERGE_READ_ONLY}
          describedBy={note === null ? undefined : noteId}
        />
      </div>
      {note !== null && (
        <p
          className={cx("dash-pulse__note", canAdminister && "dash-pulse__note--err")}
          id={noteId}
          // A failed write is an `alert`: the reader pressed something and it did not take,
          // and the element is rendered only when there is something to say, so the region
          // is announced on the press that produced it rather than sitting empty. The
          // read-only reason is not — it is a standing fact about the row, already the
          // switch's description, and announcing it on arrival would interrupt the page.
          role={canAdminister ? "alert" : undefined}
        >
          {note}
        </p>
      )}
    </div>
  );
}
