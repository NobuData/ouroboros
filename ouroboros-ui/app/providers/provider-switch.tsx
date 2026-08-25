"use client";

import { useRouter } from "next/navigation";
import { useId, useOptimistic, useState, useTransition } from "react";

import { ShellOverlay } from "@/app/shell/overlay";
import { Button, Chip, Toggle, cx } from "@/app/ui";

import type { Reading } from "@/app/api/reading";
import { setProviderEnabled } from "./card-actions";
import { SWITCHED_OFF, SWITCH_READ_ONLY, switchLabel } from "./cards";
import {
  CANCEL_LABEL,
  DEPENDENT_ROUTES,
  SWITCH_OFF_CONFIRM,
  SWITCH_OFF_NOTE,
  needsConfirmation,
  switchOffTitle,
  switchOffUnchecked,
} from "./keys";

/**
 * The card's enable switch ([#228](https://github.com/NobuData/ouroboros/issues/228)), which
 * since AE.3 ([#229](https://github.com/NobuData/ouroboros/issues/229)) **asks before it
 * takes routes down.**
 *
 * The control is the #46 {@link Toggle}, and the round trip is the dashboard's auto-merge
 * switch to the line: it moves when pressed and reconciles afterwards, the optimistic
 * position living exactly as long as the transition that set it, so a flip that did not
 * persist goes back on its own and a change made elsewhere arrives as a changed prop.
 *
 * ### Switching off is a confirmation when routes depend on it
 *
 * Disabling has the same practical effect as deleting for a running loop — routing resolves
 * `where enabled` (V018), so a switched-off provider is skipped exactly as a deleted one is
 * — and unlike delete there is no service-side guard to catch it. So when aliases resolve
 * through the connection, turning it *off* asks first and names them; turning it *on* never
 * does. And when the dependents could not be read at all, it asks too, because a read that
 * failed is not a workspace with no routes ({@link needsConfirmation}).
 *
 * **A disabled connection drops out of routing**, and the card says so under the switch
 * ({@link SWITCHED_OFF}). **A switch that may not be pressed still renders**, marked and
 * explained (design system § 3.3 for § 3.5's reason). The gate that enforces is the
 * service's; `card-actions.ts` says what happens when somebody goes around the presentation.
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
  /** The routes that resolve through the connection — what a switch-off asks about. */
  readonly dependents: Reading<readonly string[]>;
}

/**
 * The switch, and whatever it has to say for itself.
 *
 * @param props See {@link ProviderSwitchProps}.
 * @returns The switch, with the off-state note or the read-only reason or the last press's
 *   refusal under it — and, when a switch-off needs confirming, the dialog that asks.
 */
export function ProviderSwitch({
  id,
  displayName,
  enabled,
  mayAdminister,
  dependents,
}: ProviderSwitchProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [checked, setChecked] = useOptimistic(enabled);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const noteId = useId();

  const note = !mayAdminister ? SWITCH_READ_ONLY : (failure ?? (checked ? null : SWITCHED_OFF));

  /** Move the switch to a position and reconcile — the write itself, past any confirmation. */
  function commit(next: boolean): void {
    setFailure(null);

    startTransition(async () => {
      setChecked(next);

      const outcome = await setProviderEnabled(id, next);

      if (!outcome.ok) {
        setFailure(outcome.reason);
        return;
      }

      router.refresh();
    });
  }

  /**
   * Press the switch.
   *
   * Turning off with dependents — or with dependents that could not be read — opens the
   * confirmation rather than committing. Everything else commits straight away.
   */
  function press(): void {
    if (pending) return;

    const next = !checked;

    if (!next && needsConfirmation(dependents)) {
      setConfirming(true);
      return;
    }

    commit(next);
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
          role={failure !== null ? "alert" : undefined}
        >
          {note}
        </p>
      )}

      <ShellOverlay
        label={switchOffTitle(displayName)}
        onClose={() => setConfirming(false)}
        open={confirming}
      >
        <div className="providers-keys__dialog">
          <h2 className="shell-overlay__title">{switchOffTitle(displayName)}</h2>
          {dependents.ok ? (
            <>
              <p className="shell-overlay__note">{SWITCH_OFF_NOTE}</p>
              <ul aria-label={DEPENDENT_ROUTES} className="providers-keys__aliases">
                {dependents.value.map((alias) => (
                  <li key={alias}>
                    <Chip mono tone="model">
                      {alias}
                    </Chip>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="shell-overlay__note">{switchOffUnchecked(dependents.reason)}</p>
          )}
          <div className="providers-keys__actions">
            <Button
              onClick={() => {
                setConfirming(false);
                commit(false);
              }}
              tone="danger"
              type="button"
            >
              {SWITCH_OFF_CONFIRM}
            </Button>
            <Button onClick={() => setConfirming(false)} tone="ghost" type="button">
              {CANCEL_LABEL}
            </Button>
          </div>
        </div>
      </ShellOverlay>
    </div>
  );
}
