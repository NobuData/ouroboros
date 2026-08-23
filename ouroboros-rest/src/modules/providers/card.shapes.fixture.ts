/**
 * Mockup 07's five cards, written as config schemas — the fixture behind AC.1's third
 * acceptance criterion.
 *
 * *"Config schemas render AE.5's forms with **zero UI special-casing** — proven with a fixture,
 * not asserted."* An assertion would be a sentence in a test name. The proof is this: the five
 * shapes the page actually draws, each one a {@link ProviderConfigSchema}, run through the one
 * `toFormFields` in `provider.forms.ts` — a function whose source contains no provider kind at
 * all, which `provider.forms.spec.ts` checks by reading it.
 *
 * ```
 * Anthropic          masked key row                         → one secret field
 * OpenAI-compatible  Base URL + "optional" key row          → url field, optional secret
 * Ollama             Host field, no key row at all          → url field, no secret
 * GitHub Copilot     masked token row, org-billed           → one secret field
 * Cursor             masked key row                         → one secret field
 * ```
 *
 * Look at what differs between rows one and three: a `title` of *Base URL* against *Host*, and
 * the presence of a field marked `x-ouroboros-secret`. Both are data. Neither is a branch.
 *
 * ---------------------------------------------------------------------------
 * **These are the mockup's shapes, not AC.2–AC.5's schemas.**
 *
 * The adapters do not exist yet, so nothing here can be the authority on what Anthropic's
 * schema will contain — AC.2 ([#217](https://github.com/NobuData/ouroboros/issues/217)) may well
 * add an optional address for a regional endpoint, which `provider-health/checks.ts` already
 * accommodates. What this fixture fixes is the *minimum*: each adapter's real schema must still
 * render its card, and the honest way for each of those tickets to use this file is to assert
 * that its own schema renders every field recorded here. That gives the fixture a job after
 * AC.1 rather than leaving it to rot as a copy of something that has moved on.
 *
 * It is a `.fixture.ts`: not shipped, and not counted as application code by
 * `jest.config.mjs`'s coverage.
 */

import {
  BASE_URL_FIELD,
  PLACEHOLDER_ANNOTATION,
  PROVIDER_CONFIG_DIALECT,
  SECRET_ANNOTATION,
  type ProviderConfigSchema,
} from "./provider.config";
import type { ProviderFormField } from "./provider.forms";

/** One card of mockup 07, as the schema that renders it and the fields that come back. */
export interface CardShape {
  /** Which card — used as the test name, and matching the kind the adapter will register. */
  readonly kind: string;
  /** What mockup 07 draws for it, in a phrase. */
  readonly drawn: string;
  /** The schema an adapter for this card must answer. */
  readonly schema: ProviderConfigSchema;
  /** What `toFormFields` must produce from it, in full. */
  readonly fields: readonly ProviderFormField[];
}

/**
 * A form field with every optional part absent.
 *
 * The expected lists below are written as overrides on this, so a reader compares the *four
 * fields that differ between the five cards* instead of forty identical `null`s. The base is
 * spelled out once, which is also the check that `ProviderFormField` has not silently grown a
 * member nothing sets.
 */
const NOTHING_SET: Omit<ProviderFormField, "name" | "label" | "widget" | "required"> = {
  help: null,
  placeholder: null,
  defaultValue: null,
  choices: null,
  minLength: null,
  maxLength: null,
  pattern: null,
};

/** Mockup 07's Anthropic card: `sk-ant-api03-••••••••••••Xq4A`, **Reveal**, **Rotate**. */
const ANTHROPIC: CardShape = {
  kind: "anthropic",
  drawn: "a masked key row and nothing else",
  schema: {
    $schema: PROVIDER_CONFIG_DIALECT,
    type: "object",
    title: "Connect Anthropic",
    properties: {
      apiKey: {
        type: "string",
        title: "API key",
        minLength: 1,
        [SECRET_ANNOTATION]: true,
        [PLACEHOLDER_ANNOTATION]: "sk-ant-api03-…",
      },
    },
    required: ["apiKey"],
    additionalProperties: false,
  },
  fields: [
    {
      ...NOTHING_SET,
      name: "apiKey",
      label: "API key",
      widget: "secret",
      required: true,
      placeholder: "sk-ant-api03-…",
      minLength: 1,
    },
  ],
};

/**
 * Mockup 07's vLLM card: a **Base URL** field *and* a key row placeheld
 * *"API key — optional, no auth configured"*.
 *
 * The only one of the five with two fields, and the reason `partitionSubmission` has to handle
 * an optional secret: the card ships with that row empty.
 */
const OPENAI_COMPATIBLE: CardShape = {
  kind: "openai_compatible",
  drawn: "a Base URL field and an optional key row",
  schema: {
    $schema: PROVIDER_CONFIG_DIALECT,
    type: "object",
    title: "Connect an OpenAI-compatible endpoint",
    properties: {
      [BASE_URL_FIELD]: {
        type: "string",
        title: "Base URL",
        description: "The OpenAI-compatible root — vLLM, LM Studio, llama.cpp, TGI.",
        format: "uri",
        minLength: 1,
        [PLACEHOLDER_ANNOTATION]: "http://10.0.4.20:8000/v1",
      },
      apiKey: {
        type: "string",
        title: "API key",
        [SECRET_ANNOTATION]: true,
        [PLACEHOLDER_ANNOTATION]: "API key — optional, no auth configured",
      },
    },
    required: [BASE_URL_FIELD],
    additionalProperties: false,
  },
  fields: [
    {
      ...NOTHING_SET,
      name: BASE_URL_FIELD,
      label: "Base URL",
      widget: "url",
      required: true,
      help: "The OpenAI-compatible root — vLLM, LM Studio, llama.cpp, TGI.",
      placeholder: "http://10.0.4.20:8000/v1",
      minLength: 1,
    },
    {
      ...NOTHING_SET,
      name: "apiKey",
      label: "API key",
      widget: "secret",
      required: false,
      placeholder: "API key — optional, no auth configured",
    },
  ],
};

/**
 * Mockup 07's Ollama card: a **Host** field, and no key row anywhere on it.
 *
 * The same `baseUrl` property as the card above, with a different label. That is the whole of
 * `provider.config.ts`'s reserved-name argument, visible in one diff.
 */
const OLLAMA: CardShape = {
  kind: "ollama",
  drawn: "a Host field and no key row",
  schema: {
    $schema: PROVIDER_CONFIG_DIALECT,
    type: "object",
    title: "Connect an Ollama host",
    properties: {
      [BASE_URL_FIELD]: {
        type: "string",
        title: "Host",
        description: "Where the daemon is listening. No credential — it is your own machine.",
        format: "uri",
        minLength: 1,
        [PLACEHOLDER_ANNOTATION]: "http://ken-station.local:11434",
      },
    },
    required: [BASE_URL_FIELD],
    additionalProperties: false,
  },
  fields: [
    {
      ...NOTHING_SET,
      name: BASE_URL_FIELD,
      label: "Host",
      widget: "url",
      required: true,
      help: "Where the daemon is listening. No credential — it is your own machine.",
      placeholder: "http://ken-station.local:11434",
      minLength: 1,
    },
  ],
};

/** Mockup 07's Copilot card: a masked token row, and the capability line about seats. */
const COPILOT: CardShape = {
  kind: "copilot",
  drawn: "a masked token row, org-billed",
  schema: {
    $schema: PROVIDER_CONFIG_DIALECT,
    type: "object",
    title: "Connect GitHub Copilot",
    properties: {
      token: {
        type: "string",
        title: "GitHub token",
        description: "Billed to the organization. Seats are read back when the token is tested.",
        minLength: 1,
        [SECRET_ANNOTATION]: true,
        [PLACEHOLDER_ANNOTATION]: "ghp_…",
      },
    },
    required: ["token"],
    additionalProperties: false,
  },
  fields: [
    {
      ...NOTHING_SET,
      name: "token",
      label: "GitHub token",
      widget: "secret",
      required: true,
      help: "Billed to the organization. Seats are read back when the token is tested.",
      placeholder: "ghp_…",
      minLength: 1,
    },
  ],
};

/** Mockup 07's Cursor card: a plain key. */
const CURSOR: CardShape = {
  kind: "cursor",
  drawn: "a masked key row",
  schema: {
    $schema: PROVIDER_CONFIG_DIALECT,
    type: "object",
    title: "Connect Cursor",
    properties: {
      apiKey: {
        type: "string",
        title: "API key",
        minLength: 1,
        [SECRET_ANNOTATION]: true,
        [PLACEHOLDER_ANNOTATION]: "key_…",
      },
    },
    required: ["apiKey"],
    additionalProperties: false,
  },
  fields: [
    {
      ...NOTHING_SET,
      name: "apiKey",
      label: "API key",
      widget: "secret",
      required: true,
      placeholder: "key_…",
      minLength: 1,
    },
  ],
};

/**
 * The five, in the order mockup 07 draws them.
 *
 * Ordered rather than keyed, because the test that matters iterates it — a `Record` would let a
 * card be dropped without a suite noticing that four is not five.
 */
export const CARD_SHAPES: readonly CardShape[] = Object.freeze([
  ANTHROPIC,
  CURSOR,
  COPILOT,
  OPENAI_COMPATIBLE,
  OLLAMA,
]);
