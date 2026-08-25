"use client";

import { SelectField, TextField, Toggle } from "@/app/ui";

import {
  type ParamValue,
  type ParamValues,
  paramHint,
} from "./params";
import type { ModelParamFormField } from "@/app/api/registry";

import "./registry.css";

/**
 * The registry's **parameter form** — one control per tunable the bound model actually has,
 * drawn from CH.2's merged schema ([#585](https://github.com/NobuData/ouroboros/issues/585)).
 *
 * The create dialog's *bind now* mode renders it (CI.4,
 * [#594](https://github.com/NobuData/ouroboros/issues/594)) and CI.3's inspector
 * ([#593](https://github.com/NobuData/ouroboros/issues/593)) will render the same component
 * over the same answer, which is why it is a component of its own rather than markup inside a
 * dialog. What it decides is nothing: the widget, the label, the bounds and the help all arrive
 * on the field, and `app/registry/params.ts` holds the few judgements that are left.
 *
 * **A form for a model nobody wrote UI for.** That is the whole claim of the endpoint behind
 * it, and it is only true if this file contains no list of parameters. It does not: there is no
 * `thinking`, no `token_budget` and no `temperature` here, and the suite that proves it feeds
 * the component a parameter no adapter in this build has.
 *
 * ### Controlled, unlike `app/ui/schema-form.tsx`
 *
 * Every other form in this module is uncontrolled, because every other form is submitted to a
 * Server Action and a controlled input would make the first screen of the product depend on
 * hydration to accept a keystroke (`app/ui/field.tsx`). This one is controlled, for three
 * reasons that are all about what makes it different:
 *
 * 1. **The field set is replaced under the reader.** Choosing another model re-reads the
 *    schema, and the controls that come back are a different set. Uncontrolled inputs would
 *    carry the previous model's DOM values into the new model's boxes for exactly as long as
 *    React reused the elements.
 * 2. **A switch is not a form control.** The #46 `Toggle` is a `<button role="switch">` — it
 *    has no value to submit — so a boolean parameter has to be held somewhere either way.
 * 3. **The dialog composes a JSON document, not a form body.** `params` is one object with
 *    typed values (`paramsDocument`), so the values are read as a whole rather than scraped
 *    per control, and a blank control has to be *absent* from that object rather than present
 *    and empty.
 *
 * ### The default is drawn, never typed in
 *
 * `defaultValue` is documented as **not a value this product sends**, so it appears in the
 * hint under the control (`paramHint`) and never in the box. A dialog somebody clicked through
 * without touching the parameters therefore creates an alias with `params: {}` — the provider's
 * own defaults — rather than one pinned to whatever this build's adapter happened to suggest.
 */

/** What the parameter form takes. */
export interface ParamFieldsProps {
  /** The section's fields, in the order the service gave them. */
  readonly fields: readonly ModelParamFormField[];
  /** What each control holds, keyed by the field's `name`. */
  readonly values: ParamValues;
  /** Called with a field's name and its new value whenever a control moves. */
  readonly onChange: (name: string, value: ParamValue) => void;
  /**
   * The prefix every control's id is built from, so two forms on one page — or one form opened
   * twice — never share an id. A `useId()` from the caller is the ordinary value.
   */
  readonly idPrefix: string;
  /** The service's refusals, keyed by field name — `params.ts`'s `paramFieldErrors`. */
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}

/**
 * The controls, one per field, in order.
 *
 * @param props See {@link ParamFieldsProps}.
 * @returns The column of controls, or nothing at all when the section has no fields — what to
 *   say instead is the caller's, because *why* a section is empty is the response's `reason`
 *   and the caller is what has it.
 */
export function ParamFields({ fields, values, onChange, idPrefix, errors = {} }: ParamFieldsProps) {
  if (fields.length === 0) return null;

  return (
    <div className="registry-params">
      {fields.map((field) => (
        <ParamField
          error={errors[field.name]}
          field={field}
          id={`${idPrefix}-${field.name}`}
          key={field.name}
          onChange={onChange}
          value={values[field.name]}
        />
      ))}
    </div>
  );
}

/**
 * One control, drawn as its widget says.
 *
 * The five widgets are the closed set CH.2 derives, and this switch is **total** over them:
 * a sixth added to the contract is a build error here rather than a parameter that silently
 * renders as free text and is stored as the wrong type.
 *
 * @param props.field The field.
 * @param props.value What it holds.
 * @param props.onChange Called with the field's name and its new value.
 * @param props.id The control's id.
 * @param props.error What the service said is wrong with it, if anything.
 * @returns The control.
 */
export function ParamField({
  field,
  value,
  onChange,
  id,
  error,
}: Readonly<{
  field: ModelParamFormField;
  value: ParamValue | undefined;
  onChange: (name: string, value: ParamValue) => void;
  id: string;
  error?: readonly string[];
}>) {
  const hint = paramHint(field);
  const common = {
    error: errorLine(error),
    hint: hint ?? undefined,
    id,
    label: field.label,
    name: field.name,
  };

  if (field.widget === "switch") {
    // The #46 switch, with the label drawn beside it: `Toggle` renders its own name as visually
    // hidden text, so the visible copy is `aria-hidden` — a reader who heard it twice would be
    // hearing the same control announced as two.
    return (
      <div className="registry-params__switch">
        <Toggle
          checked={value === true}
          label={field.label}
          onClick={() => { onChange(field.name, value !== true); }}
        />
        <span aria-hidden="true" className="registry-params__switch-label">
          {field.label}
        </span>
        {hint !== null && <p className="registry-params__switch-hint">{hint}</p>}
        {error !== undefined && error.length > 0 && (
          <p className="registry-params__switch-error" role="alert">
            {error.join(" ")}
          </p>
        )}
      </div>
    );
  }

  if (field.widget === "select") {
    return (
      <SelectField
        {...common}
        onChange={(event) => { onChange(field.name, event.currentTarget.value); }}
        value={typeof value === "string" ? value : ""}
      >
        {/*
          The blank option is what *send nothing for this key* looks like in a select, and every
          parameter is optional by construction — the schema has no `required` — so it is never
          conditional the way `SchemaField`'s is.
        */}
        <option value="">{UNSET_OPTION}</option>
        {(field.choices ?? []).map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </SelectField>
    );
  }

  const numeric = field.widget === "integer" || field.widget === "number";

  return (
    <TextField
      {...common}
      // A parameter value is read character by character — an identifier or a figure — never
      // prose, so every one of the three text-ish widgets is mono and unchecked for spelling.
      autoComplete="off"
      max={field.maximum ?? undefined}
      min={field.minimum ?? undefined}
      mono
      onChange={(event) => { onChange(field.name, event.currentTarget.value); }}
      spellCheck={false}
      // `1` refuses `4096.5` in the browser as well as in the service — the contract splits
      // `integer` from `number` because a fractional token budget is a value no provider
      // accepts — and `any` lets a temperature be `0.2`.
      step={field.widget === "integer" ? 1 : field.widget === "number" ? "any" : undefined}
      type={numeric ? "number" : "text"}
      value={typeof value === "string" ? value : ""}
    />
  );
}

/** What the blank choice of a parameter select says: the provider decides. */
export const UNSET_OPTION = "—";

/**
 * A field's errors, as the one line the field draws.
 *
 * @param errors What the service said, or nothing.
 * @returns The sentences joined, or `undefined` when there is nothing to draw — which is what
 *   keeps `aria-invalid` off a control that is fine.
 */
function errorLine(errors: readonly string[] | undefined): string | undefined {
  return errors === undefined || errors.length === 0 ? undefined : errors.join(" ");
}
