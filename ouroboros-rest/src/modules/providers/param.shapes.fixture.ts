/**
 * Mockup 21's inspector, the two providers that have nothing to tune, and a parameter nothing
 * in this build has ever seen — written as param schemas, with the fields each must render to.
 *
 * The fixture half of CH.2's ([#585](https://github.com/NobuData/ouroboros/issues/585)) fourth
 * acceptance criterion:
 *
 * > *"A fake adapter declaring a **novel param** renders its field in the inspector with **no
 * > UI change** — fixture-proved."*
 *
 * An assertion would be a sentence in a test name. The proof is this: five shapes, run through
 * the one `toParamFields` in `param.forms.ts` — a function whose source contains no param name
 * and no provider kind at all, which `param.forms.spec.ts` checks by reading it.
 *
 * ```
 * Anthropic          Thinking · Token budget · Max output · Temperature   → select + 2 integers + number
 * Anthropic (legacy) Max output · Temperature                             → the same code, two fewer fields
 * Ollama             Max output · Context clamp · Temperature             → no thinking anywhere
 * Copilot / Cursor   nothing, and a sentence saying why                   → an empty list, not a failure
 * Novel              Speculative decoding                                 → a switch, from a name nothing knows
 * ```
 *
 * Look at what differs between the first row and the last: a name this build has a column for
 * against one it does not, and a `select` against a `switch`. Both are data. Neither is a
 * branch.
 *
 * ---------------------------------------------------------------------------
 * **These are shapes, not the adapters' own schemas.** `card.shapes.fixture.ts` makes the same
 * distinction and for the same reason: what this file fixes is the *minimum* each real schema
 * must still render to, and the honest way for an adapter's own suite to use it is to assert
 * that its schema renders every field recorded here. That gives the fixture a job after CH.2
 * rather than leaving it to rot as a copy of something that has moved on.
 *
 * It is a `.fixture.ts`: not shipped, and not counted as application code by
 * `jest.config.mjs`'s coverage.
 */

import {
  MODEL_ALIAS_TEMPERATURE_MAX,
  MODEL_ALIAS_TEMPERATURE_MIN,
  MODEL_ALIAS_TOKENS_MIN,
  THINKING_LEVELS,
} from "../db/schema";
import type { ParamFormField } from "./param.forms";
import { MODEL_PARAM_DIALECT, type ModelParamSchema } from "./provider.params";

/** One inspector shape, as the schema that renders it and the fields that come back. */
export interface ParamShape {
  /** Which shape — used as the test name. */
  readonly name: string;
  /** What the inspector draws for it, in a phrase. */
  readonly drawn: string;
  /** The schema an adapter answering this shape must produce. */
  readonly schema: ModelParamSchema;
  /** What `toParamFields` must produce from it, in full. */
  readonly fields: readonly ParamFormField[];
}

/**
 * A form field with every optional part absent.
 *
 * The expected lists below are written as overrides on this, so a reader compares the parts
 * that *differ* between the five shapes instead of forty identical `null`s. The base is spelled
 * out once, which is also the check that `ParamFormField` has not silently grown a member
 * nothing sets.
 */
const NOTHING_SET: Omit<ParamFormField, "name" | "label" | "widget" | "sources"> = {
  help: null,
  defaultValue: null,
  choices: null,
  minimum: null,
  maximum: null,
};

/** What a field straight from an adapter says about where it came from. */
const FROM_ADAPTER = ["adapter"] as const;

/**
 * Mockup 21's inspector for `coder-max`: **Thinking**, **Token budget**, **Temperature** — and
 * the max-output row the mockup leaves to the *8k out* chip on `sizer`.
 */
const ANTHROPIC_THINKING: ParamShape = {
  name: "a thinking model",
  drawn: "a thinking select, a budget, an output ceiling and a temperature",
  schema: {
    $schema: MODEL_PARAM_DIALECT,
    type: "object",
    title: "Anthropic model parameters",
    properties: {
      thinking: {
        type: "string",
        title: "Thinking",
        description: "How much reasoning effort to ask for before the answer starts.",
        enum: THINKING_LEVELS,
      },
      token_budget: {
        type: "integer",
        title: "Token budget",
        minimum: MODEL_ALIAS_TOKENS_MIN,
        maximum: 1_000_000,
      },
      max_output: {
        type: "integer",
        title: "Max output",
        minimum: MODEL_ALIAS_TOKENS_MIN,
      },
      temperature: {
        type: "number",
        title: "Temperature",
        minimum: MODEL_ALIAS_TEMPERATURE_MIN,
        maximum: 1,
      },
    },
    additionalProperties: false,
  },
  fields: [
    {
      ...NOTHING_SET,
      name: "thinking",
      label: "Thinking",
      widget: "select",
      help: "How much reasoning effort to ask for before the answer starts.",
      choices: ["off", "std", "max"],
      sources: FROM_ADAPTER,
    },
    {
      ...NOTHING_SET,
      name: "token_budget",
      label: "Token budget",
      widget: "integer",
      minimum: 1,
      maximum: 1_000_000,
      sources: FROM_ADAPTER,
    },
    {
      ...NOTHING_SET,
      name: "max_output",
      label: "Max output",
      widget: "integer",
      minimum: 1,
      sources: FROM_ADAPTER,
    },
    {
      ...NOTHING_SET,
      name: "temperature",
      label: "Temperature",
      widget: "number",
      minimum: 0,
      maximum: 1,
      sources: FROM_ADAPTER,
    },
  ],
};

/**
 * The same provider, a model from before extended thinking existed.
 *
 * The shape that proves per-model variation is real rather than decorative: two fields fewer,
 * out of the same adapter and the same renderer.
 */
const ANTHROPIC_LEGACY: ParamShape = {
  name: "a pre-thinking model",
  drawn: "the same two rows with no thinking pair above them",
  schema: {
    $schema: MODEL_PARAM_DIALECT,
    type: "object",
    title: "Anthropic model parameters",
    properties: {
      max_output: {
        type: "integer",
        title: "Max output",
        minimum: MODEL_ALIAS_TOKENS_MIN,
      },
      temperature: {
        type: "number",
        title: "Temperature",
        minimum: MODEL_ALIAS_TEMPERATURE_MIN,
        maximum: 1,
      },
    },
    additionalProperties: false,
  },
  fields: [
    {
      ...NOTHING_SET,
      name: "max_output",
      label: "Max output",
      widget: "integer",
      minimum: 1,
      sources: FROM_ADAPTER,
    },
    {
      ...NOTHING_SET,
      name: "temperature",
      label: "Temperature",
      widget: "number",
      minimum: 0,
      maximum: 1,
      sources: FROM_ADAPTER,
    },
  ],
};

/** Mockup 21's `local-docs`: a context clamp, and no thinking control at all. */
const LOCAL: ParamShape = {
  name: "a locally served model",
  drawn: "an output ceiling, a context clamp and a temperature",
  schema: {
    $schema: MODEL_PARAM_DIALECT,
    type: "object",
    title: "Ollama model parameters",
    properties: {
      max_output: {
        type: "integer",
        title: "Max output",
        minimum: MODEL_ALIAS_TOKENS_MIN,
      },
      context_clamp: {
        type: "integer",
        title: "Context clamp",
        minimum: MODEL_ALIAS_TOKENS_MIN,
      },
      temperature: {
        type: "number",
        title: "Temperature",
        minimum: MODEL_ALIAS_TEMPERATURE_MIN,
        maximum: MODEL_ALIAS_TEMPERATURE_MAX,
      },
    },
    additionalProperties: false,
  },
  fields: [
    {
      ...NOTHING_SET,
      name: "max_output",
      label: "Max output",
      widget: "integer",
      minimum: 1,
      sources: FROM_ADAPTER,
    },
    {
      ...NOTHING_SET,
      name: "context_clamp",
      label: "Context clamp",
      widget: "integer",
      minimum: 1,
      sources: FROM_ADAPTER,
    },
    {
      ...NOTHING_SET,
      name: "temperature",
      label: "Temperature",
      widget: "number",
      minimum: 0,
      maximum: 2,
      sources: FROM_ADAPTER,
    },
  ],
};

/**
 * Mockup 21's `coder-fallback` and `second-opinion`: a fixed catalog with nothing to tune.
 *
 * The shape whose *field list is empty* and whose schema still says something. `toParamFields`
 * answers `[]` rather than failing, and the inspector renders the description in place of the
 * fields — which is the whole difference between an empty form and a form that failed to load.
 */
const FIXED_CATALOG: ParamShape = {
  name: "a fixed catalog",
  drawn: "no fields at all, and a sentence explaining why",
  schema: {
    $schema: MODEL_PARAM_DIALECT,
    type: "object",
    title: "GitHub Copilot model parameters",
    description:
      "Copilot is a fixed catalog reached through a seat licence, and publishes no per-call " +
      "parameters this product can set. Restrictions still apply to the alias.",
    properties: {},
    additionalProperties: false,
  },
  fields: [],
};

/**
 * A parameter nothing in this build has a column, a chip or a case for.
 *
 * The criterion, as a shape. `speculative_decoding` is not one of V019's five keys, no adapter
 * ships it, and `param.forms.ts` has never heard of it — and it renders a switch with a label
 * and a help line, because the renderer reads the schema rather than a list of names it knows.
 * The day an adapter genuinely needs it, the work is a column vocabulary and a chip; the
 * renderer and the UI are already done.
 */
const NOVEL: ParamShape = {
  name: "a parameter this build has never seen",
  drawn: "one switch, from a name nothing in the renderer knows",
  schema: {
    $schema: MODEL_PARAM_DIALECT,
    type: "object",
    title: "A provider with a parameter this build has never seen",
    properties: {
      speculative_decoding: {
        type: "boolean",
        title: "Speculative decoding",
        description: "Draft with a smaller model and verify with this one.",
      },
    },
    additionalProperties: false,
  },
  fields: [
    {
      ...NOTHING_SET,
      name: "speculative_decoding",
      label: "Speculative decoding",
      widget: "switch",
      help: "Draft with a smaller model and verify with this one.",
      sources: FROM_ADAPTER,
    },
  ],
};

/** The five shapes, in the order the suite reports them. */
export const PARAM_SHAPES: readonly ParamShape[] = Object.freeze([
  ANTHROPIC_THINKING,
  ANTHROPIC_LEGACY,
  LOCAL,
  FIXED_CATALOG,
  NOVEL,
]);
