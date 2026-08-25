import { SelectField, TextField } from "./field";
import { cx } from "./class-names";

import "./ui.css";

/**
 * A form drawn from a list of fields it did not write — the schema-driven form machinery
 * ([#231](https://github.com/NobuData/ouroboros/issues/231), shared with WF-S.4's inspector,
 * [#150](https://github.com/NobuData/ouroboros/issues/150)).
 *
 * The add-provider dialog's whole claim is that a new adapter gets a working form the day it
 * lands, with no UI written for it. That is only true if the thing drawing the form has **no
 * list of fields of its own**: it takes a list, and draws one control per entry, and the
 * entry says everything — the label, the widget, whether it is required, the placeholder, the
 * bounds. So this is a primitive rather than a screen's component, for the reason the
 * `app/ui` barrel gives for every primitive: it names no domain concept. `SchemaFieldSpec`
 * is structurally the contract's `ProviderFormField`, and it will be structurally whatever
 * the workflow catalog's fields are too, because it is the shape a *form* needs and not the
 * shape any one service happens to send.
 *
 * ### Four widgets, and no fifth
 *
 * `text`, `url`, `secret` and `select` — the four `ouroboros-rest`'s form dialect derives, and
 * derives rather than lets an adapter declare, so that a fifth cannot be invented per
 * provider. Each maps onto one of the field primitives with the attributes that make the
 * browser do the checking: a `url` is a `type="url"` input, a `secret` is a `type="password"`
 * one with autofill turned off, a `select` is the platform's `<select>` over `choices`, and
 * `required`, `minLength`, `maxLength` and `pattern` are the input's own — so the form refuses
 * a blank required key before a request is made, and the server's own check is the one that
 * decides.
 *
 * ### Uncontrolled, like every field in this module
 *
 * The fields carry no state; what was typed is read from the form on submit. That is the
 * primitives' own rule (`field.tsx`), and it has a consequence worth wanting here: a
 * submission the server refuses leaves every value exactly where the reader left it, because
 * nothing re-rendered the inputs from a draft that was never kept.
 *
 * ### Errors arrive keyed by name
 *
 * A refusal from the service is keyed by the field's `name` — `details.fields` on a
 * `provider_config_invalid` — and that is the shape {@link SchemaFieldsProps.errors} takes, so
 * the dialog hands the service's answer straight through and each field draws its own line.
 */

/** How one field is drawn — the four widgets a form dialect derives. */
export type SchemaWidget = "text" | "url" | "secret" | "select";

/**
 * One field of a schema-driven form.
 *
 * Every optional property is an explicit `null` rather than absent, because this is a value a
 * renderer consumes rather than a schema an author writes — and a renderer that had to supply
 * defaults would be a renderer with opinions.
 */
export interface SchemaFieldSpec {
  /** The property name — the control's `name`, and what a submitted value is keyed by. */
  readonly name: string;
  /** What the `<label>` says. */
  readonly label: string;
  /** How to draw it. */
  readonly widget: SchemaWidget;
  /** Whether a value must be supplied. */
  readonly required: boolean;
  /** The help line under the control, or null. */
  readonly help: string | null;
  /** The input's placeholder, or null. Prose, not an example value. */
  readonly placeholder: string | null;
  /** What the control starts at, or null. */
  readonly defaultValue: string | null;
  /** The options for a `select`, or null for every other widget. */
  readonly choices: readonly string[] | null;
  /** The shortest acceptable value, or null. */
  readonly minLength: number | null;
  /** The longest acceptable value, or null. */
  readonly maxLength: number | null;
  /** The pattern a value must match, in ECMA-262 syntax, or null. */
  readonly pattern: string | null;
}

/** What is wrong with which fields, keyed by field name. Absent means nothing is. */
export type SchemaFieldErrors = Readonly<Record<string, readonly string[] | undefined>>;

/** What the form takes. */
export interface SchemaFieldsProps {
  /** The fields, in the order to draw them. */
  readonly fields: readonly SchemaFieldSpec[];
  /**
   * The prefix every control's id is built from, so two forms on one page — or one form
   * opened twice — never share an id. A `useId()` from the caller is the ordinary value.
   */
  readonly idPrefix: string;
  /** The service's refusals, keyed by field name. */
  readonly errors?: SchemaFieldErrors;
  /** Classes from the page — placement only, never colour or type. */
  readonly className?: string;
}

/** The `type` each non-select widget gives its input. */
const INPUT_TYPE: Record<Exclude<SchemaWidget, "select">, string> = {
  text: "text",
  url: "url",
  secret: "password",
};

/**
 * The fields, one control each, in order.
 *
 * @param props See {@link SchemaFieldsProps}.
 * @returns The column of fields.
 */
export function SchemaFields({ fields, idPrefix, errors = {}, className }: SchemaFieldsProps) {
  return (
    <div className={cx("ou-schema-form", className)}>
      {fields.map((field) => (
        <SchemaField
          key={field.name}
          error={errors[field.name]}
          id={`${idPrefix}-${field.name}`}
          spec={field}
        />
      ))}
    </div>
  );
}

/**
 * One field, drawn as its widget says.
 *
 * @param props.spec The field.
 * @param props.id The control's id.
 * @param props.error What the service said is wrong with it, if anything.
 * @returns A text field or a select.
 */
export function SchemaField({
  spec,
  id,
  error,
}: Readonly<{ spec: SchemaFieldSpec; id: string; error?: readonly string[] }>) {
  const common = {
    id,
    label: spec.label,
    name: spec.name,
    required: spec.required,
    hint: spec.help ?? undefined,
    error: errorLine(error),
  };

  if (spec.widget === "select") {
    return (
      <SelectField {...common} defaultValue={spec.defaultValue ?? undefined}>
        {/*
          An optional select needs a way to choose nothing, and a blank option is the
          platform's; a required one starts on its first choice, which is what `required`
          means for a control that cannot be empty.
        */}
        {!spec.required && <option value="">—</option>}
        {(spec.choices ?? []).map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </SelectField>
    );
  }

  return (
    <TextField
      {...common}
      // A secret must not be offered back by a password manager on the next form, and a key
      // pasted from a vault is not a word to check the spelling of.
      autoComplete={spec.widget === "secret" ? "off" : undefined}
      defaultValue={spec.defaultValue ?? undefined}
      maxLength={spec.maxLength ?? undefined}
      minLength={spec.minLength ?? undefined}
      // A key and an address are read character by character; prose is not.
      mono={spec.widget !== "text"}
      pattern={spec.pattern ?? undefined}
      placeholder={spec.placeholder ?? undefined}
      spellCheck={spec.widget === "text"}
      type={INPUT_TYPE[spec.widget]}
    />
  );
}

/**
 * A field's errors, as the one line the field draws.
 *
 * @param errors What the service said, or nothing.
 * @returns The sentences joined, or `undefined` when there is nothing to draw — which is what
 *   keeps `aria-invalid` off a field that is fine.
 */
function errorLine(errors: readonly string[] | undefined): string | undefined {
  return errors === undefined || errors.length === 0 ? undefined : errors.join(" ");
}
