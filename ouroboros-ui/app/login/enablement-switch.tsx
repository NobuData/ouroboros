import { Toggle } from "@/app/ui";

import { ENABLED_FIELD } from "./enablement";

/**
 * The on/off switch beside a workspace.
 *
 * The control itself is the #46 {@link Toggle}: a `<button role="switch">` with the shape,
 * the states and the read-only treatment the design system gives every switch in the
 * product. What this component adds is the one thing that is the login screen's own — how
 * the press reaches the server.
 *
 * ### It is a form, not a checkbox
 *
 * The whole screen is a Server Component, and the only writes it makes are Server Actions —
 * so the switch is a submit button inside a one-field form. That has a property a
 * `useState` toggle would not: it works before hydration and without JavaScript at all,
 * which for the *first* screen of the product on an unknown connection is worth more than
 * an optimistic animation. The form carries the state to move *to* rather than the state it
 * is in, so a stale render — a second tab, a back button — asks for something specific
 * instead of inverting whatever the flag has become since.
 *
 * `display: contents` on the form (`login.css`) keeps it out of the row's layout: it is the
 * transport, and it must not become a box.
 *
 * ### A switch that may not be pressed still renders
 *
 * Two reasons a switch cannot move, and the control is the same for both. `member` and
 * `viewer` may read a workspace and not administer it (`openapi.yaml`: the mutations are
 * `owner` and `admin`); and a workspace with no GitHub organisations recorded has nothing
 * for a switch to act on at all. Either way it is a read-only indicator: same shape, same
 * state, `aria-disabled`, and the reason in its tooltip and its accessible description. That
 * is the design system's § 3.3 permission-limited state and its § 3.5 honesty rule in one
 * control — hiding the switches would leave a list that looks like it has no settings, and a
 * `disabled` button would drop the explanation out of the tab order along with the control.
 *
 * Its form goes with it: a read-only switch renders bare, so there is no form for a press
 * to submit even if one reached the button.
 */

/** How a switch is told what to do, and what it may say about it. */
export interface EnablementSwitchProps {
  /** The Server Action to submit to. Ignored when {@link reason} is present. */
  readonly action: (formData: FormData) => Promise<void>;
  /** The form's fields — the reference the action needs, without the desired state. */
  readonly fields: Readonly<Record<string, string>>;
  /** Whether the thing is enabled now. Also what decides the state submitted. */
  readonly enabled: boolean;
  /** The switch's accessible name: what pressing it would do. */
  readonly label: string;
  /** Why it cannot be pressed. Its presence is what makes this read-only. */
  readonly reason?: string;
  /** The id of the element describing the read-only state, if there is one. */
  readonly describedBy?: string;
}

/**
 * The switch.
 *
 * @param props See {@link EnablementSwitchProps}.
 * @returns A submit button in a form, or a read-only indicator of the same shape.
 */
export function EnablementSwitch({
  action,
  fields,
  enabled,
  label,
  reason,
  describedBy,
}: EnablementSwitchProps) {
  if (reason !== undefined) {
    return (
      <Toggle checked={enabled} label={label} reason={reason} describedBy={describedBy} />
    );
  }

  return (
    <form className="login-switch-form" action={action}>
      {Object.entries(fields).map(([name, value]) => (
        <input type="hidden" name={name} value={value} key={name} />
      ))}
      {/* The state to move to, not the state it is in. */}
      <input type="hidden" name={ENABLED_FIELD} value={enabled ? "false" : "true"} />
      <Toggle checked={enabled} label={label} type="submit" />
    </form>
  );
}
