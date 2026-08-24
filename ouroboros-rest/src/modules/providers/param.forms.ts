/**
 * A param schema, as the thing a form renderer actually iterates.
 *
 * CH.2's ([#585](https://github.com/NobuData/ouroboros/issues/585)) *"a fake adapter declaring
 * a novel param renders its field in the inspector with **no UI change** — fixture-proved"*.
 * This file is the half of that proof that lives in `rest` — one total function from a schema
 * to an ordered list of fields, with **no param name and no provider kind anywhere in it**.
 * `param.forms.spec.ts` reads this file's own source with its comments stripped and fails if
 * either appears, which is the only version of *no special-casing* that stays true after
 * somebody is in a hurry.
 *
 * The fixture half is `param.shapes.fixture.ts`: mockup 21's inspector, the two fixed-catalog
 * providers that have nothing to tune, and a schema carrying a param nothing in this build has
 * ever seen — all run through {@link toParamFields}, with the expected field list recorded
 * beside each.
 *
 * It is `provider.forms.ts` for the other dialect, and the argument for its existence is the
 * same one: which widget a field gets, whether it is a choice, what its bounds are and where
 * it came from are decisions, and they should be made once on this side rather than twice in
 * two renderers. The one difference is that this dialect has four types where that one has a
 * single `string`, so {@link widgetForParam} is a switch rather than a priority list.
 */

import {
  SOURCES_ANNOTATION,
  type ModelParamFieldSchema,
  type ModelParamSchema,
  type ParamSource,
} from "./provider.params";

/**
 * How one param is drawn.
 *
 * Derived rather than declared — see {@link widgetForParam}. An adapter author picks a widget
 * by describing the param truthfully (*it is one of these three words*, *it is a whole number
 * of tokens*), which is the property that keeps a fifth widget from being invented per
 * provider.
 */
export type ParamWidget = "select" | "text" | "integer" | "number" | "switch";

/**
 * One rendered param field.
 *
 * Every optional schema keyword becomes an explicit `null` here, which is the same asymmetry
 * `provider.forms.ts` draws between a schema an author is writing and a value a renderer is
 * consuming: absence is fine in the first and unhelpful in the second.
 */
export interface ParamFormField {
  /** The property name — what a submitted value is keyed by. Never shown to a person. */
  readonly name: string;
  /** What the `<label>` says. */
  readonly label: string;
  /** How to draw it. */
  readonly widget: ParamWidget;
  /** The help line under the input, or null. */
  readonly help: string | null;
  /** What the input starts at when the alias has no value of its own, or null. */
  readonly defaultValue: string | number | boolean | null;
  /** The options for a `select`, or null for every other widget. */
  readonly choices: readonly string[] | null;
  /** The lowest acceptable value, or null. */
  readonly minimum: number | null;
  /** The highest acceptable value, or null. */
  readonly maximum: number | null;
  /**
   * Every source that shaped this field, highest precedence first.
   *
   * Never empty and never absent: a field the merge produced says where it came from, and a
   * field straight from an adapter is `["adapter"]`. A renderer showing *context ≤ 32k* can
   * therefore always say whether that bound is the provider's live word or a catalogued one,
   * which is the whole reason the annotation exists.
   */
  readonly sources: readonly ParamSource[];
}

/**
 * What a field with no source annotation is taken to be.
 *
 * An adapter writing its own schema is stating what *it* supports, so `adapter` is the honest
 * default and the annotation is something only the merge needs to write. Defaulting rather
 * than requiring it keeps an adapter's schema readable; getting the default wrong in the other
 * direction would attribute an adapter's own claim to a catalog.
 */
const DEFAULT_SOURCES: readonly ParamSource[] = Object.freeze(["adapter"]);

/**
 * Which widget a param is drawn with.
 *
 * A `string` with an `enum` is a choice and a `string` without one is free text; the other
 * three types name themselves. Exhaustive over the dialect's four types by construction —
 * the `default` branch is unreachable for a schema that passed the dialect, and answers
 * `text`, which is the widget that can render any scalar rather than the one that throws.
 *
 * @param field - The param's schema.
 * @returns The widget.
 */
export function widgetForParam(field: ModelParamFieldSchema): ParamWidget {
  switch (field.type) {
    case "string":
      return field.enum === undefined ? "text" : "select";
    case "integer":
      return "integer";
    case "number":
      return "number";
    case "boolean":
      return "switch";
    default:
      return "text";
  }
}

/**
 * A schema, as the fields a form draws — one per property, in the schema's own order.
 *
 * Total over the dialect: every schema {@link import("./provider.params").paramSchemaViolations}
 * accepts produces a field list, and an empty `properties` produces an empty list rather than
 * a failure. That is the case a fixed-catalog provider is in, and the reason the inspector
 * renders the schema's `description` instead.
 *
 * @param schema - A schema in the dialect.
 * @returns The fields, in `properties` order. Empty for a provider with nothing to tune.
 */
export function toParamFields(schema: ModelParamSchema): ParamFormField[] {
  return Object.entries(schema.properties).map(([name, field]) => ({
    name,
    label: field.title,
    widget: widgetForParam(field),
    help: field.description ?? null,
    defaultValue: field.default ?? null,
    choices: field.enum === undefined ? null : [...field.enum],
    minimum: field.minimum ?? null,
    maximum: field.maximum ?? null,
    sources: [...(field[SOURCES_ANNOTATION] ?? DEFAULT_SOURCES)],
  }));
}
