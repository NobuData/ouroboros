/**
 * Every decision the registry's **parameter form** makes, over CH.2's merged schema
 * ([#585](https://github.com/NobuData/ouroboros/issues/585)).
 *
 * The create dialog's *bind now* mode draws one control per tunable the bound model actually
 * has (CI.4, [#594](https://github.com/NobuData/ouroboros/issues/594)), and CI.3's inspector
 * ([#593](https://github.com/NobuData/ouroboros/issues/593)) draws the same controls over the
 * same answer. So the decisions are here, once, framework-free — what a blank field means,
 * how a typed string becomes the value a `params` document carries, which sentence explains an
 * empty form, and how a `422`'s field paths map back onto the controls that produced them.
 *
 * The two forms differ in exactly one decision and it is stated twice here: a create dialog
 * opens **empty** ({@link paramDefaults}) because nothing is stored yet, and an inspector opens
 * on **what is stored** ({@link paramValues}) because that is what it is editing. Everything
 * downstream of that — the typing, the hints, the document, the refusals — is one code path.
 *
 * **Framework-free and pure**, like `app/registry/table.ts` and `app/registry/view.ts` beside
 * it: nothing here imports React, `next/*` or the server-only client. `app/registry/param-fields.tsx`
 * draws what this decides.
 *
 * ---------------------------------------------------------------------------
 * ### Why this is not `app/ui/schema-form.tsx`
 *
 * The #46 set already has a form drawn from a list of fields it did not write, and this is
 * deliberately not it. Two reasons, and both are about what the two forms are *for*:
 *
 * 1. **Different dialects.** `SchemaFieldSpec` is the provider form's four widgets — text,
 *    url, secret, select — derived by `ouroboros-rest` from an adapter's config schema.
 *    `ModelParamFormField` is CH.2's five — select, text, integer, number, switch — derived
 *    from a *model's* capability schema. Merging them would give one renderer nine widgets and
 *    two vocabularies, and the point of each dialect is that it is closed.
 * 2. **A primitive names no domain concept** (`app/ui/index.ts` § What belongs here). A model
 *    parameter is a domain concept, and *why there is nothing to tune* is a product sentence.
 *
 * ### A blank field sends nothing, and that is the contract's own rule
 *
 * `ModelParamFormField.defaultValue` is documented as **not a value this product sends**: an
 * alias whose `params` omits a key says nothing about that key, and what the provider then
 * does is the provider's own default. So the controls start **empty** and the default is drawn
 * beside them as a sentence ({@link paramHint}) rather than typed into the box. The
 * consequence is the one worth having: a dialog somebody clicked through without touching the
 * parameters creates an alias with `params: {}` — exactly what an untouched import row sends —
 * rather than an alias pinned to whatever this build's adapter happened to suggest.
 *
 * ### An empty form explains itself
 *
 * `properties` may be empty, and then the schema's own `description` says why and `reason`
 * names which of the three honest cases it is. None of them is an error, and each is a
 * different sentence — {@link PARAM_REASONS} keeps them apart, total over the union, so a
 * fourth code added to the service is a build error here rather than a form that says nothing.
 */

import type {
  ModelParamFormField,
  ModelParamReason,
  ModelParamSection,
} from "@/app/api/registry";

/* ------------------------------------------------------------------ what a control holds */

/**
 * What one parameter control holds while the dialog is open.
 *
 * A string for every widget but the switch, because that is what an `<input>` and a `<select>`
 * carry; the typing happens once, on the way out ({@link paramsDocument}), rather than on
 * every keystroke — a field halfway through `40` is not the number `40`, and a form that
 * coerced as it went would fight the reader for the cursor.
 */
export type ParamValue = string | boolean;

/** What every control holds, keyed by the field's `name` — the key a `params` document uses. */
export type ParamValues = Readonly<Record<string, ParamValue>>;

/**
 * The state a fresh form starts in: every control present and empty.
 *
 * Present rather than absent, so a control is never uncontrolled on its first render and
 * controlled on its second — React's own warning, and a real bug when the model changes under
 * a form that is already open.
 *
 * **Empty rather than defaulted** — see this module's header. `false` is a switch's empty,
 * because a switch has no third position and *off* is what an absent boolean means.
 *
 * @param fields The section's fields, in the order the service gave them.
 * @returns One entry per field.
 */
export function paramDefaults(fields: readonly ModelParamFormField[]): ParamValues {
  return Object.fromEntries(fields.map((field) => [field.name, field.widget === "switch" ? false : ""]));
}

/**
 * The state a form opens in when the alias **already has** parameters — CI.3's prefill
 * ([#593](https://github.com/NobuData/ouroboros/issues/593)).
 *
 * The counterpart of {@link paramDefaults}, and the one place the two forms differ: a create
 * dialog starts empty because there is nothing stored yet, and an inspector starts on what is
 * stored because that is what it is editing. Every control is still present, and a key the
 * stored document does not carry is still {@link paramDefaults}'s empty — an alias that says
 * nothing about `thinking` must open with a blank select rather than with a value nobody wrote.
 *
 * A stored value is turned into what a control holds rather than into what it means: `400000`
 * becomes the string `"400000"`, because that is what an `<input>` carries, and the typing
 * happens once on the way back out ({@link paramsDocument}). A stored `null` — which the
 * contract's `additionalProperties: true` permits — is the same as an absent key, since neither
 * says anything about the parameter.
 *
 * @param fields The section's fields, in the order the service gave them.
 * @param stored The alias's `params` (or `restrictions`) document as served.
 * @returns One entry per field, prefilled where the document says something.
 */
export function paramValues(
  fields: readonly ModelParamFormField[],
  stored: Readonly<Record<string, unknown>>,
): ParamValues {
  return Object.fromEntries(
    fields.map((field) => [field.name, storedValue(field, stored[field.name])]),
  );
}

/**
 * One stored value, as the control that edits it holds it.
 *
 * @param field The field, which says which widget carries it.
 * @param value Whatever the stored document had under that key.
 * @returns The control's value — `false` or `""` for anything the document did not say.
 */
function storedValue(field: ModelParamFormField, value: unknown): ParamValue {
  if (field.widget === "switch") return value === true;

  if (value === undefined || value === null) return "";

  // A number, a string or a boolean is what a form control can hold; an object under a key
  // this form draws is a value no control could edit, and it opens blank rather than as
  // `[object Object]`. Nothing is lost by that on its own — a save sends the `params` document
  // only when a control moved (`app/registry/inspector.ts`'s `updateBody`), so a form nobody
  // touched leaves the stored document exactly as it was.
  return typeof value === "object" ? "" : String(value);
}

/**
 * Whether two `params` documents say the same thing.
 *
 * What the inspector's **Save alias** is dirty-aware *about*: a control typed into and typed
 * back out of is not a change, and a form that treated it as one would offer to write a
 * revision that changed nothing. Compared by key and by value rather than by serialisation,
 * because two objects with the same entries in different orders are the same document and
 * `JSON.stringify` says otherwise.
 *
 * Shallow, deliberately: every value a form control produces is a string, a number or a
 * boolean ({@link paramValue}), so there is no nesting for a deep compare to reach.
 *
 * @param one A document.
 * @param other The other.
 * @returns Whether they carry the same keys with the same values.
 */
export function documentsEqual(
  one: Readonly<Record<string, unknown>>,
  other: Readonly<Record<string, unknown>>,
): boolean {
  const keys = Object.keys(one);

  return (
    keys.length === Object.keys(other).length &&
    keys.every((key) => Object.hasOwn(other, key) && one[key] === other[key])
  );
}

/**
 * One field's value, typed as the field says — or `undefined` for a control the reader left
 * alone.
 *
 * `undefined` is the whole point: it is what keeps a blank field out of the document rather
 * than putting an empty string, a `NaN` or a `0` into it. A number that will not parse is also
 * `undefined` — the browser's own `type="number"` refuses most of them before this is reached,
 * and a value this cannot read is one the service would refuse anyway, by field, with its own
 * sentence.
 *
 * @param field The field, which says which of the four shapes its value takes.
 * @param value What the control holds.
 * @returns The value to send, or `undefined` to send nothing for this key.
 */
export function paramValue(
  field: ModelParamFormField,
  value: ParamValue | undefined,
): string | number | boolean | undefined {
  if (field.widget === "switch") return value === true ? true : undefined;

  if (typeof value !== "string" || value.trim() === "") return undefined;

  if (field.widget === "integer" || field.widget === "number") {
    const parsed = Number(value);

    // `Number("")` is 0 and `Number(" ")` is 0, both already excluded above; what is left to
    // refuse is a word, and a fraction where the service asked for an integer — `4096.5` is a
    // token budget no provider accepts, and the contract splits `integer` from `number` for
    // exactly that reason.
    if (!Number.isFinite(parsed)) return undefined;
    if (field.widget === "integer" && !Number.isInteger(parsed)) return undefined;

    return parsed;
  }

  return value;
}

/**
 * The `params` document a form produces — every control the reader filled in, and nothing else.
 *
 * @param fields The section's fields.
 * @param values What the controls hold.
 * @returns The document. **`{}` for a form nobody touched**, which is a request to store no
 *   parameters rather than a request to store the adapter's suggestions.
 */
export function paramsDocument(
  fields: readonly ModelParamFormField[],
  values: ParamValues,
): Record<string, string | number | boolean> {
  const document: Record<string, string | number | boolean> = {};

  for (const field of fields) {
    const value = paramValue(field, values[field.name]);

    if (value !== undefined) document[field.name] = value;
  }

  return document;
}

/* ------------------------------------------------------------------ what a control says */

/**
 * The line under one control: the field's own help, then its bounds, then what the provider
 * does if nothing is typed.
 *
 * The default belongs here rather than in the box for the reason this module's header gives,
 * and the bounds belong here as well as on the input: `min` and `max` make the browser refuse
 * an out-of-range value, and a reader who cannot see the range is left guessing what it
 * refused them for.
 *
 * @param field The field.
 * @returns The sentence, or `null` when the field has nothing to add to its label.
 */
export function paramHint(field: ModelParamFormField): string | null {
  const parts: string[] = [];

  if (field.help !== null) parts.push(field.help);

  if (field.minimum !== null && field.maximum !== null) {
    parts.push(`${field.minimum}–${field.maximum}`);
  } else if (field.minimum !== null) {
    parts.push(`at least ${field.minimum}`);
  } else if (field.maximum !== null) {
    parts.push(`at most ${field.maximum}`);
  }

  if (field.defaultValue !== null) parts.push(`${PROVIDER_DEFAULT} ${String(field.defaultValue)}`);

  return parts.length === 0 ? null : parts.join(" · ");
}

/**
 * How the provider's own default is introduced in a hint.
 *
 * *Provider default* and not *default*: the value is what happens when this product sends
 * nothing, which is a fact about the provider rather than a value the field is pre-set to.
 */
export const PROVIDER_DEFAULT = "provider default:";

/**
 * Why a params section offers nothing, for each of the three codes the contract publishes.
 *
 * Total over the union — a `Record` keyed by every non-null `reason`, so a fourth code added
 * to the service is a build error here rather than an empty form drawn with no explanation.
 * None of the three is an error, and the sentences say so: two of them are facts about the
 * provider, and the third is the state the *bind later* mode deliberately creates.
 */
export const PARAM_REASONS: Readonly<Record<NonNullable<ModelParamReason>, string>> = {
  alias_unbound:
    "No provider is bound yet, so nothing knows what this model supports. Parameters can be " +
    "set once the alias is bound.",
  provider_has_no_parameters:
    "This provider publishes no per-call parameters — its catalog is fixed, and there is " +
    "nothing here to tune.",
  provider_unsupported:
    "This build has no adapter for that provider, so it cannot say what the model supports.",
};

/**
 * What to say above an empty parameter section.
 *
 * The service's own `description` is preferred, because it is written against the exact model
 * and this is not; {@link PARAM_REASONS} is the fallback for an empty schema that carried
 * none, and `null` is the honest answer when the section is not empty at all.
 *
 * @param section The params section, as served.
 * @param reason The response's `reason`, or `null`.
 * @returns The sentence, or `null` when there are fields to draw instead.
 */
export function paramsNote(section: ModelParamSection, reason: ModelParamReason): string | null {
  if (section.fields.length > 0) return null;

  return section.schema.description ?? (reason === null ? null : PARAM_REASONS[reason]);
}

/* ------------------------------------------------------------------ what a refusal says */

/**
 * A `422`'s field messages, mapped back onto the controls that produced them.
 *
 * `model_alias_params_invalid` names each offending field by its whole path —
 * `params.thinking`, `restrictions.batch_ok` — because an alias write carries two documents
 * and a bare `thinking` would not say which. This takes the prefix off, so each section's
 * fields can look their own errors up by `name` without knowing they were ever prefixed.
 *
 * A path that is not this section's is dropped rather than guessed at: an error about
 * `restrictions.batch_ok` drawn under the `thinking` select would be worse than one drawn
 * nowhere, and the dialog's whole-form sentence is what catches whatever finds no field.
 *
 * @param details The refusal's `details`, whatever shape it arrived in.
 * @param prefix Which document — `params` or `restrictions`.
 * @returns The sentences keyed by field name. Empty when nothing in `details` belongs here.
 */
export function paramFieldErrors(
  details: Readonly<Record<string, unknown>>,
  prefix: "params" | "restrictions",
): Readonly<Record<string, readonly string[]>> {
  const errors: Record<string, readonly string[]> = {};

  for (const [path, value] of Object.entries(details)) {
    if (!path.startsWith(`${prefix}.`)) continue;

    const sentences = messagesOf(value);

    if (sentences.length > 0) errors[path.slice(prefix.length + 1)] = sentences;
  }

  return errors;
}

/**
 * One entry of a refusal's `details`, as the sentences to draw.
 *
 * The contract's `422` bodies carry an array of messages per field; a service that sent one
 * string is read as one sentence rather than as a character array, and anything else is
 * ignored — a client that rendered `[object Object]` under a field would be reporting its own
 * confusion as the reader's mistake.
 *
 * @param value Whatever was under the field's key.
 * @returns The sentences, possibly none.
 */
function messagesOf(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];

  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");

  return [];
}
