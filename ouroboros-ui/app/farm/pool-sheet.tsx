"use client";

import { useEffect, useRef, useState } from "react";

import { ShellOverlay } from "@/app/shell/overlay";
import { Eyebrow, SelectField } from "@/app/ui";

import { PoolForm } from "./pool-form";
import { usePools } from "./pool-store";
import {
  NEW_POOL,
  NEW_POOL_VALUE,
  NO_POOLS_MEMBER_NOTE,
  NO_POOLS_TITLE,
  PICKER_LABEL,
  SHEET_CLOSE,
  SHEET_EYEBROW,
  SHEET_MEMBER_NOTE,
  SHEET_TITLE,
} from "./pools";

/**
 * The pool configuration sheet — what the pools card's **Configure →** and the head's **Pool
 * settings** open (AI.4, [#259](https://github.com/NobuData/ouroboros/issues/259)).
 *
 * **One sheet, and a picker inside it** (decided with the owner): the link sits on the card, not
 * on a row, and the sheet's scope includes creating a pool — so the sheet opens on the first pool
 * and a select names the one being configured, with `+ New pool` as its last choice. The form
 * under it is `app/farm/pool-form.tsx`'s, remounted per pool so one pool's half-typed edit is
 * never carried onto another.
 *
 * The modal contract — focus in, Tab kept inside, Escape and a press outside close, focus back
 * to whichever control opened it — is the shell overlay's (`app/shell/overlay.tsx`).
 *
 * ### Focus is never left on the page behind
 *
 * A create and a delete each end by showing a *different* pool, which remounts the form — and so
 * unmounts the control that was pressed. A browser hands focus to `<body>` then, outside the
 * dialog, where Escape closes nothing. So once such a write has settled, focus is moved to the
 * sheet's first control: the picker, now naming the pool that is shown. A plain save keeps its
 * form, and its focus.
 *
 * ### A reader who may not write
 *
 * May open it, and reads every pool's configuration in a form whose fields are genuinely
 * disabled. They are not offered `+ New pool`: a blank form nobody may submit says nothing.
 *
 * @param props.mayAdminister Whether this reader may change a pool.
 * @returns The sheet while open; nothing otherwise.
 */
export function PoolSheet({ mayAdminister }: Readonly<{ mayAdminister: boolean }>) {
  const { pools, sheetOpen, closeSheet } = usePools();
  const [chosen, setChosen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settled, setSettled] = useState(0);
  const head = useRef<HTMLDivElement>(null);

  /** Rescue focus after a write that remounted the form — see the note above. */
  useEffect(() => {
    if (settled === 0 || document.activeElement !== document.body) return;

    head.current
      ?.closest("[role='dialog']")
      ?.querySelector<HTMLElement>("select:not(:disabled), input:not(:disabled)")
      ?.focus();
  }, [settled]);

  const held = pools ?? [];
  // A choice outlives the pool it names when the pool is deleted; the first pool stands in. With
  // no pool to stand in, a reader who may create is given the blank form.
  const creating = mayAdminister && (chosen === NEW_POOL_VALUE || held.length === 0);
  const pool = creating ? null : (held.find((one) => one.id === chosen) ?? held[0] ?? null);

  /** Close, and forget what the last write said — the next opening is a fresh look. */
  function close(): void {
    setNotice(null);
    closeSheet();
  }

  return (
    <ShellOverlay label={SHEET_TITLE} onClose={close} open={sheetOpen}>
      <div ref={head}>
        <Eyebrow>{SHEET_EYEBROW}</Eyebrow>
        <h2 className="shell-overlay__title">{SHEET_TITLE}</h2>
      </div>

      {!mayAdminister && (
        <p className="shell-overlay__note" role="note">
          {SHEET_MEMBER_NOTE}
        </p>
      )}

      {held.length > 0 && (
        <SelectField
          id={PICKER_ID}
          label={PICKER_LABEL}
          onChange={(event) => {
            setChosen(event.target.value);
            setNotice(null);
          }}
          value={creating ? NEW_POOL_VALUE : (pool?.id ?? "")}
        >
          {held.map((one) => (
            <option key={one.id} value={one.id}>
              {one.name}
            </option>
          ))}
          {mayAdminister && <option value={NEW_POOL_VALUE}>{NEW_POOL}</option>}
        </SelectField>
      )}

      {creating || pool !== null ? (
        <PoolForm
          key={pool?.id ?? NEW_POOL_VALUE}
          mayAdminister={mayAdminister}
          onSettled={(next, said) => {
            setChosen(next);
            setNotice(said);
            setSettled((count) => count + 1);
          }}
          onTouched={() => setNotice(null)}
          pool={pool}
        />
      ) : (
        <p className="shell-overlay__note">
          {NO_POOLS_TITLE} {NO_POOLS_MEMBER_NOTE}
        </p>
      )}

      {/* Always mounted, so the region exists before it has something to say. */}
      <p className="farm-pool-form__notice" role="status">
        {notice}
      </p>

      <button className="shell-overlay__close" onClick={close} type="button">
        {SHEET_CLOSE}
      </button>
    </ShellOverlay>
  );
}

/** The picker's id. */
const PICKER_ID = "pool-sheet-picker";
