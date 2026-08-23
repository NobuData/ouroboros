/**
 * The in-memory adapter — the kit's first subject, `docs/MODEL_PROVIDERS.md`'s worked example,
 * and the thing core tests use instead of a network.
 *
 * AC.1 ([#216](https://github.com/NobuData/ouroboros/issues/216)). It has three jobs and each
 * one is a reason it is written the way it is:
 *
 *   * **It proves the kit is passable.** AC.1's first acceptance criterion is that the
 *     conformance kit is green for the fake, which is a claim about the *kit* — a set of rules
 *     no implementation satisfies is a set of rules nobody can adopt.
 *   * **It powers core tests.** AD.2's credential lifecycle
 *     ([#223](https://github.com/NobuData/ouroboros/issues/223)), the discovery scheduler and
 *     Z.3's health service all need *an adapter*, and none of them needs a real one. A suite
 *     built on this opens no socket, so it runs in `yarn test` rather than in the integration
 *     suite where a slow provider would make it flaky.
 *   * **It is the example an adapter author reads.** `docs/MODEL_PROVIDERS.md` walks through
 *     this file. That is why it derives its `config` failure from its own schema instead of
 *     scripting one: an author copying it should copy the habit of checking configuration
 *     before opening a socket.
 *
 * ---------------------------------------------------------------------------
 * **Why it keys on `custom` by default.** V015's six kinds are the registry's keys and there is
 * no `fake` among them, which is correct — a fake is not a provider anybody connects to.
 * `custom` is the kind V015 has for *an endpoint this product has no adapter opinion about*, so
 * a test registering the fake under it exercises a kind the registry really accepts. The kind
 * is a constructor argument for the cases that want to stand in for a specific one — a
 * discovery-scheduler test that needs an `ollama` row is better served by a fake that says
 * `ollama` than by a real daemon.
 *
 * ---------------------------------------------------------------------------
 * **Why there are two classes rather than one with a flag.** {@link FakePullingProviderAdapter}
 * declares `pull: true` and implements `pullModel`; {@link FakeModelProviderAdapter} declares
 * `false` and has no such member. That is `provider.adapter.ts`'s capability gate as it is
 * meant to be used — a single class with an optional member would be the shape the SPI exists
 * to refuse, demonstrated by the file that is supposed to be the example.
 *
 * It is a `.fixture.ts`: type-checked with the code it exercises, and left out of the image by
 * `tsconfig.build.json`. Nothing that ships imports it, and `.dependency-cruiser.cjs` keeps
 * that true.
 */

import type { ProviderConnectionKind } from "../../db/schema";
import {
  type ModelPullProgress,
  type ModelProviderAdapter,
  type NormalizedModel,
  type ProviderCapabilities,
  type ProviderConnectionContext,
  type ProviderValidation,
  type ProviderValidationFailure,
  type PullCapableAdapter,
} from "../provider.adapter";
import {
  PROVIDER_CONFIG_DIALECT,
  PLACEHOLDER_ANNOTATION,
  SECRET_ANNOTATION,
  BASE_URL_FIELD,
  type ProviderConfigSchema,
  type ProviderConnectionConfig,
} from "../provider.config";
import { ProviderAdapterError, type ProviderErrorClass } from "../provider.errors";

/**
 * The credential the fake's fixtures use.
 *
 * Shaped like a real key and long enough to be findable: the conformance kit searches every
 * rendered detail for this exact string, and a secret of `"x"` would appear in a hundred
 * innocent sentences and prove nothing.
 */
export const FAKE_SECRET = "sk-fake-216-QmFrZUFkYXB0ZXJTZWNyZXQ";

/** The address the fake's fixtures use. */
export const FAKE_BASE_URL = "https://fake.invalid/v1";

/** A configuration the fake considers well-formed. */
export const FAKE_CONFIG: ProviderConnectionConfig = Object.freeze({
  [BASE_URL_FIELD]: FAKE_BASE_URL,
});

/**
 * The fake's config schema — an address and an optional credential.
 *
 * Deliberately the *two-field* shape rather than the simplest one: it is mockup 07's vLLM card,
 * which is the only one of the five that exercises a required address and an optional key at
 * once. A fake whose schema had a single field would leave the interesting half of
 * `partitionSubmission` untested by every suite that uses it.
 */
export const FAKE_CONFIG_SCHEMA: ProviderConfigSchema = {
  $schema: PROVIDER_CONFIG_DIALECT,
  type: "object",
  title: "Connect a test provider",
  properties: {
    [BASE_URL_FIELD]: {
      type: "string",
      title: "Base URL",
      description: "Where the provider is. Never called — this adapter answers from memory.",
      format: "uri",
      minLength: 1,
      [PLACEHOLDER_ANNOTATION]: "https://provider.example/v1",
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
};

/** The models the fake reports, unless it is built with others. */
export const FAKE_MODELS: readonly NormalizedModel[] = Object.freeze([
  Object.freeze({
    id: "fake/small",
    display: "Fake Small",
    contextLength: 200_000,
    sizeBytes: null,
  }),
  Object.freeze({
    id: "fake/large",
    display: "Fake Large",
    contextLength: 1_000_000,
    sizeBytes: 19_327_352_832,
  }),
]);

/**
 * One recorded failure per error class, in the vocabulary `provider.errors.ts` publishes.
 *
 * These are the fake's *recorded fixtures*: it has no wire to capture, so what a real adapter
 * records as a captured HTTP response, this records as the result that response would produce.
 * The details are the real phrases — `key rejected (401)`, `503 upstream` — so a suite reading
 * the fake's output sees what a card will actually print.
 *
 * `config` is absent on purpose. The fake derives that one from its own schema, which is the
 * habit `docs/MODEL_PROVIDERS.md` asks an adapter author to copy: check the configuration
 * before opening a socket, because a missing address is not a provider being down.
 */
export const FAKE_FAILURES: Readonly<
  Record<Exclude<ProviderErrorClass, "config">, ProviderValidationFailure>
> = Object.freeze({
  auth: Object.freeze({ status: "failed", errorClass: "auth", detail: "key rejected (401)" }),
  network: Object.freeze({
    status: "failed",
    errorClass: "network",
    detail: "unreachable (ECONNREFUSED)",
  }),
  upstream: Object.freeze({ status: "failed", errorClass: "upstream", detail: "503 upstream" }),
  rate_limit: Object.freeze({
    status: "failed",
    errorClass: "rate_limit",
    detail: "rate limited (429)",
  }),
});

/** How the fake may be built. Every field has a default that makes a conforming adapter. */
export interface FakeAdapterOptions {
  /** The kind to register under. Defaults to `custom` — see this file's header. */
  readonly kind?: ProviderConnectionKind;
  /** The schema to answer. Defaults to {@link FAKE_CONFIG_SCHEMA}. */
  readonly schema?: ProviderConfigSchema;
  /** The models to report. Defaults to {@link FAKE_MODELS}. */
  readonly models?: readonly NormalizedModel[];
  /** Whether `discovery` is declared. Defaults to `true`. */
  readonly discovery?: boolean;
  /** Whether `entitlements` is declared. Defaults to `false`. */
  readonly entitlements?: boolean;
  /** The latency a successful validation reports. Defaults to `7`. */
  readonly latencyMs?: number;
}

/**
 * An adapter that answers from memory.
 *
 * Scripting is by the two `will…` methods, each of which returns `this` so a test reads as one
 * expression. Anything not scripted succeeds, which is the default a test should not have to
 * ask for.
 */
export class FakeModelProviderAdapter implements ModelProviderAdapter {
  readonly kind: ProviderConnectionKind;

  /** How many times each member has been called. What a core test asserts against. */
  readonly calls = { validate: 0, discoverModels: 0, pullModel: 0 };

  private readonly schema: ProviderConfigSchema;
  private readonly models: readonly NormalizedModel[];
  private readonly discovery: boolean;
  private readonly entitlements: boolean;
  private readonly latencyMs: number;

  /** Scripted validation outcomes, consumed one per call, oldest first. */
  private readonly scripted: ProviderValidation[] = [];

  /** What `discoverModels` should throw instead of answering, if anything. */
  private discoveryFailure: ProviderAdapterError | null = null;

  /**
   * @param options - What to answer. Every field defaults to something conforming.
   */
  constructor(options: FakeAdapterOptions = {}) {
    this.kind = options.kind ?? "custom";
    this.schema = options.schema ?? FAKE_CONFIG_SCHEMA;
    this.models = options.models ?? FAKE_MODELS;
    this.discovery = options.discovery ?? true;
    this.entitlements = options.entitlements ?? false;
    this.latencyMs = options.latencyMs ?? 7;
  }

  /**
   * Script the next validation to fail.
   *
   * @param errorClass - Which recorded failure to answer with. `config` is not scriptable: the
   *   fake produces it the way an adapter should, by finding a required field missing — call
   *   `validate({}, …)` for it.
   * @returns This adapter, so calls chain.
   */
  willFail(errorClass: Exclude<ProviderErrorClass, "config">): this {
    this.scripted.push(FAKE_FAILURES[errorClass]);

    return this;
  }

  /**
   * Script `discoverModels` to throw.
   *
   * @param errorClass - The class the thrown error carries.
   * @param detail - The phrase it carries. Defaults to the recorded failure's.
   * @returns This adapter, so calls chain.
   */
  willFailDiscovery(
    errorClass: Exclude<ProviderErrorClass, "config">,
    detail = FAKE_FAILURES[errorClass].detail,
  ): this {
    this.discoveryFailure = new ProviderAdapterError(errorClass, detail);

    return this;
  }

  /**
   * The fake's schema.
   *
   * @returns A fresh deep copy every call. A shared object would let a caller — AE.5 holds this
   *   while somebody fills in a form — mutate the adapter's own value, which is exactly what
   *   the conformance kit tries to do.
   */
  configSchema(): ProviderConfigSchema {
    return JSON.parse(JSON.stringify(this.schema)) as ProviderConfigSchema;
  }

  /**
   * What the fake can do.
   *
   * @returns The flags. `pull` is `false` here and `true` on {@link FakePullingProviderAdapter};
   *   `invocation` is `false` because AF.2 ([#235](https://github.com/NobuData/ouroboros/issues/235))
   *   has not defined what a `true` would mean.
   */
  capabilities(): ProviderCapabilities {
    return {
      discovery: this.discovery,
      pull: false,
      entitlements: this.entitlements,
      invocation: false,
    };
  }

  /**
   * Check a configuration, from memory.
   *
   * Configuration first, then the script. That order is the point of the example: a missing
   * address is something an adapter knows about before it opens anything, and reporting it as
   * `network` because the socket failed would send somebody to check a firewall.
   *
   * @param config - The settings.
   * @param _secret - The credential. Read by no branch here, and named with an underscore to
   *   say so — the fake has nothing to authenticate against, and a fake that *stored* one would
   *   be modelling the mistake rather than the interface.
   * @returns The scripted outcome, a `config` failure, or a success. Never rejects.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async validate(
    config: ProviderConnectionConfig,
    _secret: string | null,
  ): Promise<ProviderValidation> {
    this.calls.validate += 1;

    const missing = this.schema.required.filter((field) => (config[field] ?? "").length === 0);

    if (missing.length > 0) {
      return {
        status: "failed",
        errorClass: "config",
        detail: `${missing.join(", ")} required`,
      };
    }

    return this.scripted.shift() ?? { status: "ok", latencyMs: this.latencyMs, detail: "200" };
  }

  /**
   * The models the fake was built with.
   *
   * @param _connection - The opened connection. Unread: there is nothing to reach.
   * @returns A copy of the list, so a caller sorting it in place does not reorder the fixture
   *   the next assertion compares against.
   * @throws {ProviderAdapterError} When {@link willFailDiscovery} scripted one.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async discoverModels(_connection: ProviderConnectionContext): Promise<NormalizedModel[]> {
    this.calls.discoverModels += 1;

    if (this.discoveryFailure !== null) {
      throw this.discoveryFailure;
    }

    return [...this.models];
  }
}

/**
 * The progress a fake pull reports.
 *
 * Three events, shaped like Ollama's: a manifest fetch with no byte counts because none are
 * known yet, a transfer with both, and a terminal event. The first is the interesting one — it
 * is why {@link ModelPullProgress}'s counts are nullable rather than defaulted to zero.
 */
export const FAKE_PULL_EVENTS: readonly ModelPullProgress[] = Object.freeze([
  Object.freeze({
    status: "pulling manifest",
    completedBytes: null,
    totalBytes: null,
    done: false,
  }),
  Object.freeze({
    status: "downloading",
    completedBytes: 9_663_676_416,
    totalBytes: 19_327_352_832,
    done: false,
  }),
  Object.freeze({
    status: "success",
    completedBytes: 19_327_352_832,
    totalBytes: 19_327_352_832,
    done: true,
  }),
]);

/**
 * A fake that pulls — the Ollama-shaped half of the SPI, without a daemon.
 *
 * Exists so that {@link import("../provider.adapter").supportsPull},
 * `ModelProviderRegistry.pullCapable` and AE.4's
 * ([#230](https://github.com/NobuData/ouroboros/issues/230)) progress rendering all have
 * something to be tested against before AC.4
 * ([#219](https://github.com/NobuData/ouroboros/issues/219)) lands.
 */
export class FakePullingProviderAdapter
  extends FakeModelProviderAdapter
  implements PullCapableAdapter
{
  /** What each pull reports, in order. */
  private readonly events: readonly ModelPullProgress[];

  /**
   * @param options - The base options; `kind` defaults to `ollama` here, since that is the
   *   kind a pulling provider is in this product.
   * @param events - The progress events to stream. Defaults to a manifest fetch, one
   *   part-transferred update, and a terminal event.
   */
  constructor(
    options: FakeAdapterOptions = {},
    events: readonly ModelPullProgress[] = FAKE_PULL_EVENTS,
  ) {
    super({ kind: "ollama", ...options });
    this.events = events;
  }

  /** @returns The flags, with `pull` narrowed to `true` as the interface requires. */
  override capabilities(): ProviderCapabilities & { readonly pull: true } {
    return { ...super.capabilities(), pull: true };
  }

  /**
   * Stream the scripted progress.
   *
   * @param _connection - The opened connection. Unread.
   * @param _modelId - The model. Unread: the fake pulls whatever it is asked for.
   * @returns The events, in order, ending with the terminal one.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async *pullModel(
    _connection: ProviderConnectionContext,
    _modelId: string,
  ): AsyncIterable<ModelPullProgress> {
    this.calls.pullModel += 1;

    for (const event of this.events) {
      yield event;
    }
  }
}
