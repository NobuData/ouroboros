import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

import { cx } from "./class-names";

import "./ui.css";

/**
 * The form primitives: a text field, a select, and a switch.
 *
 * All three are uncontrolled and carry no state. That is not a simplification, it is the
 * shape the product needs: every screen in this module is a Server Component, and what
 * writes is a Server Action submitted by a form (`ouroboros-ui/README.md` § Sign-in &
 * tenancy). A controlled input would make the first screen of the product depend on
 * hydration to accept a keystroke.
 *
 * ### Three rules they share
 *
 * 1. **A label, always, and a real one.** `label` is required and `id` is required, because
 *    the two together are what makes a `<label for>` — a placeholder is not a label, and a
 *    field labelled only by the text near it is labelled by nothing.
 * 2. **The hint is wired, not merely printed.** A field's hint is rendered with an id and
 *    named in the control's `aria-describedby`, so it is read with the control rather than
 *    found by luck. A caller's own `aria-describedby` is kept and this is added to it.
 *    An `error` is wired the same way, and sets `aria-invalid` besides: a refused value is
 *    a fact about the control, not a sentence that happens to be near it.
 * 3. **The focus ring is the product's, not the mockups'.** The mockups set `outline: none`
 *    on a focused input and draw their own halo; `app/globals.css` already gives every
 *    control in the product one ring, on the element the keyboard actually reached. So the
 *    ring stays and the field adds the accent boundary beneath it (`ui.css`).
 */

/** What every field shares — the parts around the control. */
interface FieldFrameProps {
  /** The control's id. Required: it is what the label points at. */
  readonly id: string;
  /** The visible label. */
  readonly label: ReactNode;
  /** One line under the control: an example, a constraint, or why it cannot be used. */
  readonly hint?: ReactNode;
  /**
   * What is wrong with the value, when something is. Rendered under the hint as an alert,
   * wired into the control's description, and what sets `aria-invalid` on it — so a field
   * that is refused is refused to a screen reader too, not only in red.
   */
  readonly error?: ReactNode;
  /** Classes from the page — placement only, never colour or type. */
  readonly className?: string;
  /** The control itself. */
  readonly children: ReactNode;
}

/**
 * The label, the control, and the hint beneath it.
 *
 * @param props See {@link FieldFrameProps}.
 * @returns The field.
 */
function FieldFrame({ id, label, hint, error, className, children }: FieldFrameProps) {
  return (
    <div className={cx("ou-field", className)}>
      <label className="ou-field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint !== undefined && (
        <p className="ou-field__hint" id={hintId(id)}>
          {hint}
        </p>
      )}
      {error !== undefined && (
        // An alert rather than a status: a refused value is an interruption to what the
        // reader was doing, and the one they most need to hear about.
        <p className="ou-field__error" id={errorId(id)} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The id a field's hint is given, derived from the control's so neither has to be passed
 * twice.
 *
 * @param id The control's id.
 * @returns The hint's id.
 */
function hintId(id: string): string {
  return `${id}-hint`;
}

/**
 * The id a field's error is given, derived from the control's for the reason the hint's is.
 *
 * @param id The control's id.
 * @returns The error's id.
 */
function errorId(id: string): string {
  return `${id}-error`;
}

/**
 * Everything the control should be described by: its own hint, its own error, plus whatever
 * the caller already pointed at.
 *
 * @param id The control's id.
 * @param hint Whether this field has a hint at all.
 * @param error Whether this field has an error at all.
 * @param callerDescribedBy The caller's own `aria-describedby`, if any.
 * @returns The space-separated id list, or `undefined` when there is nothing to describe it.
 */
function describedBy(
  id: string,
  hint: boolean,
  error: boolean,
  callerDescribedBy: string | undefined,
): string | undefined {
  return cx(hint && hintId(id), error && errorId(id), callerDescribedBy) || undefined;
}

/** What a text field takes, beyond the attributes an `<input>` takes. */
export type TextFieldProps = Omit<FieldFrameProps, "children"> &
  Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "id"> & {
    /** Whether the value is read character by character — a domain, a key, an identifier. */
    readonly mono?: boolean;
  };

/**
 * A text field.
 *
 * A disabled one carries the real `disabled` rather than the `aria-disabled` a
 * {@link Button} uses, and the difference is deliberate: a text box that accepts typing and
 * then discards it is worse than one that does not, and a field keeps its explanation in
 * its hint rather than in a tooltip only a focused control could show.
 *
 * @param props See {@link TextFieldProps}.
 * @returns The field.
 */
export function TextField({
  id,
  label,
  hint,
  error,
  className,
  mono,
  "aria-describedby": callerDescribedBy,
  "aria-invalid": callerInvalid,
  ...rest
}: TextFieldProps) {
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} className={className}>
      <input
        {...rest}
        id={id}
        className={cx("ou-input", mono && "ou-input--mono")}
        aria-describedby={describedBy(id, hint !== undefined, error !== undefined, callerDescribedBy)}
        // The field's own error marks the control invalid; a caller with a refusal of its own
        // to report — the login screen's domain form — keeps saying so through the attribute
        // it passed, which the spread above must not be allowed to lose.
        aria-invalid={error !== undefined ? true : callerInvalid}
      />
    </FieldFrame>
  );
}

/** What a select takes, beyond the attributes a `<select>` takes. */
export type SelectFieldProps = Omit<FieldFrameProps, "children"> &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "className" | "id"> & {
    /** The `<option>` elements. */
    readonly children: ReactNode;
  };

/**
 * A select.
 *
 * It is the platform's `<select>` and not a listbox built out of divs, which is what makes
 * it work on a phone, with a keyboard, and inside a form that submits without JavaScript.
 * The native control follows the palette because `app/tokens.css` declares `color-scheme`
 * in all three of its blocks.
 *
 * @param props See {@link SelectFieldProps}.
 * @returns The field.
 */
export function SelectField({
  id,
  label,
  hint,
  error,
  className,
  children,
  "aria-describedby": callerDescribedBy,
  "aria-invalid": callerInvalid,
  ...rest
}: SelectFieldProps) {
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} className={className}>
      <select
        {...rest}
        id={id}
        className="ou-input"
        aria-describedby={describedBy(id, hint !== undefined, error !== undefined, callerDescribedBy)}
        aria-invalid={error !== undefined ? true : callerInvalid}
      >
        {children}
      </select>
    </FieldFrame>
  );
}

/** What a toggle takes. */
export interface ToggleProps {
  /** Whether the thing it controls is on now. */
  readonly checked: boolean;
  /**
   * Its accessible name: what pressing it would do — "Enable acme-robotics", not
   * "acme-robotics". The switch is 38 pixels of track and carries no text of its own, so
   * this is rendered as visually hidden text beside it.
   */
  readonly label: string;
  /**
   * Why it cannot be pressed. Its presence is what makes the switch a read-only indicator:
   * same shape, same state, `aria-disabled`, and this as its tooltip.
   */
  readonly reason?: string;
  /** The id of an element describing the read-only state, when there is one. */
  readonly describedBy?: string;
  /**
   * Whether pressing it submits the form around it. `submit` is how this product writes —
   * a switch inside a one-field form calling a Server Action, which works before hydration
   * and without JavaScript. Defaults to `button`, which does nothing without an `onClick`.
   */
  readonly type?: "button" | "submit";
  /** Called on press, for the client-side form of the control. */
  readonly onClick?: () => void;
  /** Classes from the page — placement only, never colour or type. */
  readonly className?: string;
}

/**
 * A switch.
 *
 * It is a `<button role="switch">` rather than a checkbox: `role="switch"` plus
 * `aria-checked` is what makes a control announce as on or off rather than as ticked, and a
 * button is what can submit a form of one hidden field without any JavaScript at all.
 *
 * A switch that may not be pressed still renders, in its real state, marked and explained —
 * hiding the switches on a list somebody may only read would leave a list that looks like it
 * has no settings (design system § 3.3, § 3.5).
 *
 * @param props See {@link ToggleProps}.
 * @returns The switch.
 */
export function Toggle({
  checked,
  label,
  reason,
  describedBy: describedById,
  type = "button",
  onClick,
  className,
}: ToggleProps) {
  const inert = reason !== undefined;

  return (
    <button
      // A read-only switch is never a submit button, whatever the caller asked for: the
      // form behind it would still accept the press.
      type={inert ? "button" : type}
      className={cx("ou-switch", className)}
      role="switch"
      aria-checked={checked}
      aria-disabled={inert || undefined}
      aria-describedby={describedById}
      title={reason}
      onClick={inert ? undefined : onClick}
    >
      <span className="sr-only">{label}</span>
    </button>
  );
}
