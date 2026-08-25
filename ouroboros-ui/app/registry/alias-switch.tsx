"use client";

import { useRouter } from "next/navigation";
import { useId, useOptimistic, useState, useTransition } from "react";

import { ShellOverlay } from "@/app/shell/overlay";
import { Button, Chip, Toggle } from "@/app/ui";

import { setAliasEnabled } from "./switch-actions";
import {
  CANCEL_LABEL,
  REFERRERS_LABEL,
  SWITCH_OFF_CONFIRM,
  SWITCH_READ_ONLY,
  SWITCH_UNBOUND,
  type TableRow,
  needsConfirmation,
  switchLabel,
  switchOffNote,
  switchOffTitle,
} from "./table";

import "./registry.css";

/**
 * The allowed-models table's **On** switch
 * ([#592](https://github.com/NobuData/ouroboros/issues/592)) — CH.1's enable/disable
 * ([#584](https://github.com/NobuData/ouroboros/issues/584)) as one control per row, which
 * **asks before it takes routes down.**
 *
 * The control is the #46 {@link Toggle}, and the round trip is the provider card's switch to
 * the line (`app/providers/provider-switch.tsx`): it moves when pressed and reconciles
 * afterwards, the optimistic position living exactly as long as the transition that set it,
 * so a flip that did not persist goes back on its own and a change made elsewhere arrives as
 * a changed prop.
 *
 * ### The switch has consequences the reader cannot see
 *
 * Disabling an alias that three routes depend on drops their hops through it at the next
 * resolution — silently, unless this table asks first and names them. So when anything
 * references the alias, turning it *off* opens a confirmation listing the referrers as chips
 * and saying what will happen to them; turning it *on* never does, and neither does turning
 * off an alias nothing names ({@link needsConfirmation}). Cancelling leaves the switch where
 * it was, because nothing was written.
 *
 * ### Two rows where it cannot be pressed, each saying why
 *
 * The **unbound row's** switch is inert with {@link SWITCH_UNBOUND}: the contract refuses to
 * enable an alias with no connection, and a switch the reader could press and then watch fail
 * would be honest one round trip late. A **member's** switch is inert with
 * {@link SWITCH_READ_ONLY}, in its real position, marked and explained (design system § 3.3
 * for § 3.5's reason). Both are `aria-disabled` rather than `disabled`, so the reader who
 * most needs the tooltip is not the one who cannot reach it. The gate that enforces is the
 * service's; `switch-actions.ts` says what happens when somebody goes around the presentation.
 *
 * ### It sits inside a selectable row
 *
 * A press on the switch also selects its row — the click reaches the `<tr>` — which is the
 * right side effect: the inspector then shows the alias whose switch was pressed. A key
 * pressed on the switch is the switch's alone (`app/ui/table.tsx`), so Space toggles rather
 * than moving the selection.
 */

/** What the switch takes. */
export interface AliasSwitchProps {
  /** The row the switch belongs to. */
  readonly row: TableRow;
  /** Whether this reader may change it. `false` renders the read-only control. */
  readonly mayAdminister: boolean;
}

/**
 * The switch, and whatever it has to say for itself.
 *
 * @param props See {@link AliasSwitchProps}.
 * @returns The switch, with the last press's refusal under it — and, when a switch-off needs
 *   confirming, the dialog that asks.
 */
export function AliasSwitch({ row, mayAdminister }: AliasSwitchProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [checked, setChecked] = useOptimistic(row.enabled);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const noteId = useId();

  // Role first, then the binding: a member is told about their role, not about a binding
  // they could not change either.
  const reason = !mayAdminister
    ? SWITCH_READ_ONLY
    : row.provider === null
      ? SWITCH_UNBOUND
      : undefined;

  /** Move the switch to a position and reconcile — the write itself, past any confirmation. */
  function commit(next: boolean): void {
    setFailure(null);

    startTransition(async () => {
      setChecked(next);

      const outcome = await setAliasEnabled(row.id, next);

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
   * Turning off a referenced alias opens the confirmation rather than committing. Everything
   * else commits straight away.
   */
  function press(): void {
    if (pending) return;

    const next = !checked;

    if (!next && needsConfirmation(row.references)) {
      setConfirming(true);
      return;
    }

    commit(next);
  }

  return (
    <div className="registry-switch">
      <Toggle
        checked={checked}
        describedBy={failure === null ? undefined : noteId}
        label={switchLabel(row.alias)}
        onClick={press}
        reason={reason}
      />
      {failure !== null && (
        <p className="registry-switch__note registry-switch__note--err" id={noteId} role="alert">
          {failure}
        </p>
      )}

      <ShellOverlay
        label={switchOffTitle(row.alias)}
        onClose={() => setConfirming(false)}
        open={confirming}
      >
        <div className="registry-confirm">
          <h2 className="shell-overlay__title">{switchOffTitle(row.alias)}</h2>
          <p className="shell-overlay__note">{switchOffNote(row.references.length)}</p>
          <ul aria-label={REFERRERS_LABEL} className="registry-confirm__referrers">
            {row.references.map((reference) => (
              <li key={reference.refId}>
                <Chip mono tone="model">
                  {reference.label}
                </Chip>
              </li>
            ))}
          </ul>
          <div className="registry-confirm__actions">
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
