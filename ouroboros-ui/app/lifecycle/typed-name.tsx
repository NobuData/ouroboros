"use client";

import { TextField } from "@/app/ui";

import { typeNameLabel } from "./danger";

/** What {@link TypedName} takes. */
export interface TypedNameProps {
  /** The field's id. */
  readonly id: string;
  /** The workspace's name — what must be typed. */
  readonly workspaceName: string;
  /** What has been typed. */
  readonly value: string;
  /** Called with the new value, exactly as typed. */
  readonly onChange: (value: string) => void;
  /** What the service found wrong with it, when it refused the name. */
  readonly error?: string;
}

/**
 * The typed confirmation the two destructive dialogs share
 * (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)): a field the reader types the
 * workspace's name into.
 *
 * It decides nothing — `app/lifecycle/danger.ts`'s `nameMatches` is the rule, and each dialog
 * asks it. No autocomplete, correction or capitalisation: a browser that finished the name for
 * the reader would undo the reason the field exists.
 *
 * @param props See {@link TypedNameProps}.
 * @returns The field.
 */
export function TypedName({ id, workspaceName, value, onChange, error }: TypedNameProps) {
  return (
    <TextField
      autoCapitalize="off"
      autoComplete="off"
      autoCorrect="off"
      error={error}
      id={id}
      label={typeNameLabel(workspaceName)}
      mono
      onChange={(event) => {
        onChange(event.target.value);
      }}
      spellCheck={false}
      value={value}
    />
  );
}
