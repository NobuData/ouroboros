import { SelectField, TextAreaField, TextField } from "./field";
import { cx } from "./class-names";

import "./ui.css";

/**
 * A form drawn from a list of fields it did not write — the schema-driven form machinery
 * ([#231](https://github.com/NobuData/ouroboros/issues/231), shared with WF-S.4's inspector,
 * [#150](https://github.com/NobuData/ouroboros/issues/150), and since Q.4 with the ticket-source
 * settings form, [#141](https://github.com/NobuData/ouroboros/issues/141)).
 *
 * The add-provider dialog's whole claim is that a new adapter gets a working form the day it
 * lands, with no UI written for it — and the add-source dialog makes the same claim about a
 * tracker. That is only true if the thing drawing the form has **no list of fields of its
 * own**: it takes a list, and draws one control per entry, and the entry says everything — the
 * label, the widget, whether it is required, the placeholder, the bounds. So this is a
 * primitive rather than a screen's component, for the reason the `app/ui` barrel gives for
 * every primitive: it names no domain concept. `SchemaFieldSpec` is structurally the
 * contract's `ProviderFormField` *and* its `TicketSourceFormField`, and it will be structurally
 * whatever the workflow catalog's fields are too, because it is the shape a *form* needs and
 * not the shape any one service happens to send.
 *
 * ### Five widgets, and no sixth
 *
 * `text`, `url`, `secret`, `select` and `list` — the widgets `ouroboros-rest`'s two form
 * dialects derive, and derive rather than let a provider declare, so that a sixth cannot be
 * invented per provider. Each maps onto one of the field primitives with the attributes that
 * make the browser do the checking: a `url` is a `type="url"` input, a `secret` is a
 * `type="password"` one with autofill turned off, a `select` is the platform's `<select>` over
 * `choices`, a `list` is a `<textarea>` with one entry per line, and `required`, `minLength`,
 * `maxLength` and `pattern` are the input's own — so the form refuses a blank required key
 * before a request is made, and the server's own check is the one that decides.
 *
 * **A `list`'s bounds describe its entries, and the browser cannot check them.** `minLength`,
 * `maxLength` and `pattern` on a list field are per entry, and `minItems`/`maxItems` bound the
 * list; a textarea has no attribute for any of those, so a list is submitted with only
 * `required` enforced client-side and the server's `details.fields` is what says which entry
 * was wrong. The help line carries the rule in words, which is what a reader needs anyway.
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
 * `provider_config_invalid` or a `ticket_source_config_invalid` — and that is the shape
 * {@link SchemaFieldsProps.errors} takes, so the dialog hands the service's answer straight
 * through and each field draws its own line.
 */

/** How one field is drawn — the five widgets the form dialects derive. */
export type SchemaWidget = "text" | "url" | "secret" | "select" | "list";

/**
 * One field of a schema-driven form.
 *
 * Every optional property is an explicit `null` rather than absent, because this is a value a
 * renderer consumes rather than a schema an author writes — and a renderer that had to supply
 * defaults would be a renderer with opinions. The two list bounds are the exception in shape
 * only: a contract that has no `list` widget does not carry them, so they may be absent as
 * well as null, and both read as *unbounded*.
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
  /** What the control starts at, or null. On a `list`, the entries joined by newlines. */
  readonly defaultValue: string | null;
  /** The options for a `select`, or null for every other widget. */
  readonly choices: readonly string[] | null;
  /** The shortest acceptable value — or entry, on a `list` — or null. */
  readonly minLength: number | null;
  /** The longest acceptable value — or entry, on a `list` — or null. */
  readonly maxLength: number | null;
  /** The pattern a value — or every entry, on a `list` — must match, in ECMA-262 syntax, or null. */
  readonly pattern: string | null;
  /** The fewest entries a `list` may hold, or null. Absent on a contract with no lists. */
  readonly minItems?: number | null;
  /** The most entries a `list` may hold, or null. Absent on a contract with no lists. */
  readonly maxItems?: number | null;
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

/** The `type` each single-line widget gives its input. */
const INPUT_TYPE: Record<Exclude<SchemaWidget, "select" | "list">, string> = {
  text: "text",
  url: "url",
  secret: "password",
};

/** How many lines a list control shows before it scrolls. */
export const LIST_ROWS = 5;

/**
 * The entries a `list` control's value holds, one per line.
 *
 * The one piece of *reading* this primitive does, exported so the form that submits a list
 * splits it exactly as the control draws it: by line, trimmed, blank lines dropped. A comma is
 * accepted as a separator too, because a list pasted from somewhere else arrives that way and
 * a form that refused it would be teaching a reader this control's rule the hard way.
 *
 * @param value What the textarea holds.
 * @returns The entries, in order.
 */
export function listEntries(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

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
 * @returns A text field, a select, or a multi-line field.
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

  if (spec.widget === "list") {
    return (
      <TextAreaField
        {...common}
        autoComplete="off"
        defaultValue={spec.defaultValue ?? undefined}
        // Names are read character by character, and a list of them is not prose to check
        // the spelling of.
        mono
        placeholder={spec.placeholder ?? undefined}
        rows={LIST_ROWS}
        spellCheck={false}
      />
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
