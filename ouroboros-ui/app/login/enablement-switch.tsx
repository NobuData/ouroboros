/**
 * The on/off switch beside an organisation or a repository.
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
 * `display: contents` on the form (login.css) keeps it out of the row's layout: it is the
 * transport, and it must not become a box.
 *
 * ### It announces as a switch
 *
 * `role="switch"` plus `aria-checked` is what makes a button announce its state; the label
 * is a visually hidden span, because the shape is 34 pixels of track and carries no text.
 * The row beside it names the organisation, and this names the action — "Enable
 * acme-robotics" — because the name of a control should say what pressing it does.
 *
 * ### A switch that may not be pressed still renders
 *
 * `member` and `viewer` may read a workspace and not administer it (`openapi.yaml`: the
 * mutations are `owner` and `admin`), so for them every switch here is a read-only
 * indicator: same shape, same state, `aria-disabled`, and the reason in its tooltip and its
 * accessible description. That is the design system's § 3.3 permission-limited state and its
 * § 3.5 honesty rule in one control — hiding the switches would leave a list that looks like
 * it has no settings, and a `disabled` button would drop the explanation out of the tab
 * order along with the control.
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
      <button
        type="button"
        className="login-switch"
        role="switch"
        aria-checked={enabled}
        aria-disabled="true"
        aria-describedby={describedBy}
        title={reason}
      >
        <span className="sr-only">{label}</span>
      </button>
    );
  }

  return (
    <form className="login-switch__form" action={action}>
      {Object.entries(fields).map(([name, value]) => (
        <input type="hidden" name={name} value={value} key={name} />
      ))}
      {/* The state to move to, not the state it is in. */}
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <button type="submit" className="login-switch" role="switch" aria-checked={enabled}>
        <span className="sr-only">{label}</span>
      </button>
    </form>
  );
}
