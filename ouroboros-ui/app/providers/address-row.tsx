"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Button, TextField, cx } from "@/app/ui";

import type { AddressRow as AddressRowModel } from "./cards";
import { saveProviderAddress } from "./key-actions";
import {
  ADDRESS_KEPT,
  ADDRESS_REQUIRED,
  ADDRESS_SAVED,
  ADDRESS_SAVING,
  ADDRESS_UNCHANGED,
  SAVE_ADDRESS,
  saveAddressLabel,
} from "./keys";

/**
 * The editable address row ([#229](https://github.com/NobuData/ouroboros/issues/229)) — the
 * vLLM card's **Base URL** and the Ollama card's **Host**, saved with the same discipline a
 * rotation is: **a bad endpoint does not overwrite a working one.**
 *
 * The service validates on save — it checks the new address against the adapter's schema and
 * then asks the provider at it, with the stored key, before it writes — so a refusal here
 * leaves the working address exactly as it was. This row states that ({@link ADDRESS_KEPT})
 * rather than leaving a red field to imply it, for the same reason the rotate dialog states
 * the old key is still live.
 *
 * ### The field is controlled, so *changed* is a fact the button can read
 *
 * The **Save** button is inert until the field differs from what is stored, because a save
 * that re-sends the current address is a live validation the reader did not ask for and a
 * write the service would make for nothing. `aria-disabled`, never `disabled`, so the reason
 * is reachable — the house rule.
 *
 * There is no key row equivalent of *unchanged*, because a credential is write-only: the
 * page never holds the stored value to compare against. An address it does.
 */

/** What the row is told. */
export interface AddressRowProps {
  /** The connection. */
  readonly connectionId: string;
  /** The decided address row — the adapter's own label, and the stored value. */
  readonly address: AddressRowModel;
  /** Whether this reader may edit it. A member gets the read-only field and no Save. */
  readonly mayAdminister: boolean;
}

/**
 * The address row.
 *
 * @param props See {@link AddressRowProps}.
 * @returns A read-only field for a member; an editable field with a validate-on-save button
 *   for an administrator, with the saved confirmation or the standing *unchanged* line under
 *   it.
 */
export function AddressRow({ connectionId, address, mayAdminister }: AddressRowProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(address.value);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const noteId = useId();
  const fieldId = `provider-${connectionId}-address`;

  // A member's field is exactly the read-only one the card drew before this ticket.
  if (!mayAdminister) {
    return (
      <TextField id={fieldId} label={address.label} mono readOnly value={address.value} />
    );
  }

  const trimmed = value.trim();
  const changed = trimmed !== address.value;

  // One note at a time: a refusal the reader just caused, then the confirmation of a save
  // that took. An unchanged field says nothing — the button's reason already does.
  const note = failure ?? (saved ? ADDRESS_SAVED : null);

  /** Save the address. */
  function save(): void {
    if (pending || !changed) return;

    if (trimmed === "") {
      setFailure(ADDRESS_REQUIRED);
      setSaved(false);
      return;
    }

    setFailure(null);
    setSaved(false);

    startTransition(async () => {
      const outcome = await saveProviderAddress(connectionId, trimmed);

      if (!outcome.ok) {
        setFailure(outcome.reason);
        return;
      }

      // The value the service now holds, and a re-read so the meta row's *last checked* and
      // the status pill catch up with the live validation the save just ran.
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="providers-card__address">
      <div className="providers-card__address-field">
        <TextField
          aria-describedby={note === null ? undefined : noteId}
          className="providers-card__key"
          id={fieldId}
          label={address.label}
          mono
          onChange={(event) => {
            setValue(event.target.value);
            setSaved(false);
            setFailure(null);
          }}
          value={value}
        />
        <Button
          aria-label={saveAddressLabel(address.label)}
          onClick={save}
          reason={!changed ? ADDRESS_UNCHANGED : pending ? ADDRESS_SAVING : undefined}
          size="sm"
        >
          {SAVE_ADDRESS}
        </Button>
      </div>
      {note !== null && (
        <p
          className={cx(
            "providers-keys__note",
            failure !== null ? "providers-keys__note--err" : "providers-keys__note--ok",
          )}
          id={noteId}
          role={failure !== null ? "alert" : "status"}
        >
          {note}
        </p>
      )}
      {/* The standing rail: whatever a refusal says, the working address is unchanged. */}
      {failure !== null && <p className="providers-keys__standing">{ADDRESS_KEPT}</p>}
    </div>
  );
}
