"use client";

import { Toggle, cx } from "@/app/ui";

/**
 * The inspector's small controls that the #46 primitives do not provide (S.4,
 * [#150](https://github.com/NobuData/ouroboros/issues/150)): the mockup's segmented control, a
 * labelled switch row, and the inline warning line.
 *
 * The segmented control is a **radio group** rather than a row of buttons, because choosing a
 * mode is choosing one of two values: native radios give it the arrow keys, the group name and
 * the checked state for free, and the visible segments are their labels.
 */

/** One option of a segmented control. */
export interface SegmentOption {
  readonly value: string;
  readonly label: string;
}

/**
 * The mockup's `.seg.sm` — *Direct prompt │ Skill*.
 *
 * @param props.name The radio group's name — unique on the page.
 * @param props.legend What the group is called.
 * @param props.value The chosen value.
 * @param props.options The choices, in order.
 * @param props.onChange Told the value chosen.
 * @returns The control.
 */
export function Segmented({
  name,
  legend,
  value,
  options,
  onChange,
}: Readonly<{
  name: string;
  legend: string;
  value: string;
  options: readonly SegmentOption[];
  onChange: (value: string) => void;
}>) {
  return (
    <fieldset className="studio-inspector__group">
      <legend className="studio-inspector__section">{legend}</legend>
      <span className="studio-inspector__seg">
        {options.map((option) => (
          <label
            className={cx(
              "studio-inspector__seg-option",
              option.value === value && "studio-inspector__seg-option--on",
            )}
            key={option.value}
          >
            <input
              checked={option.value === value}
              className="studio-inspector__seg-input"
              name={name}
              onChange={() => onChange(option.value)}
              type="radio"
              value={option.value}
            />
            {option.label}
          </label>
        ))}
      </span>
    </fieldset>
  );
}

/**
 * A switch with its label beside it — the mockup's `.toggle-row`.
 *
 * @param props.label What the switch declares.
 * @param props.checked Whether it is on.
 * @param props.onToggle Told when pressed.
 * @param props.reason Why it cannot be pressed, for a reader who may not edit.
 * @param props.describedBy The note that explains what the switch means.
 * @returns The row.
 */
export function ToggleRow({
  label,
  checked,
  onToggle,
  reason,
  describedBy,
}: Readonly<{
  label: string;
  checked: boolean;
  onToggle: () => void;
  reason?: string;
  describedBy?: string;
}>) {
  return (
    <div className="studio-inspector__toggle-row">
      <span aria-hidden="true" className="studio-inspector__toggle-label">
        {label}
      </span>
      <Toggle checked={checked} describedBy={describedBy} label={label} onClick={onToggle} reason={reason} />
    </div>
  );
}

/**
 * A warning beside a field — an unknown name, which never blocks (decision **P7**).
 *
 * A status rather than an alert: the reader is typing, and a name the workspace does not list yet
 * is information, not an interruption.
 *
 * @param props.id The id the field's `aria-describedby` points at.
 * @param props.message The warning, or `undefined` for none.
 * @returns The line, or nothing.
 */
export function WarningLine({ id, message }: Readonly<{ id: string; message: string | undefined }>) {
  if (message === undefined) return null;

  return (
    <p className="studio-inspector__warning" id={id} role="status">
      {message}
    </p>
  );
}

/**
 * An error beside a control that is not a #46 field — a routing choice, a predicate list.
 *
 * @param props.id The id the control's `aria-describedby` points at.
 * @param props.message The error, or `undefined` for none.
 * @returns The line, or nothing.
 */
export function ErrorLine({ id, message }: Readonly<{ id: string; message: string | undefined }>) {
  if (message === undefined) return null;

  return (
    <p className="studio-inspector__error" id={id} role="alert">
      {message}
    </p>
  );
}

/**
 * The ids a control is described by, skipping the ones with nothing to say.
 *
 * @param entries Pairs of an id and whether that line is rendered.
 * @returns The space-separated ids, or `undefined`.
 */
export function describedBy(...entries: readonly (readonly [string, boolean])[]): string | undefined {
  return entries.filter(([, shown]) => shown).map(([id]) => id).join(" ") || undefined;
}
