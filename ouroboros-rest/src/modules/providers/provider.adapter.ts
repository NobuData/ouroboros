/**
 * `ModelProviderAdapter` — the one interface core code is allowed to know about.
 *
 * AC.1 ([#216](https://github.com/NobuData/ouroboros/issues/216)), roadmap decision **P1**.
 *
 * ```
 * interface ModelProviderAdapter
 *   kind · configSchema() · capabilities()
 *   validate(config, secret) → {status, latencyMs, detail}
 *   discoverModels(connection) → NormalizedModel[]
 *   pullModel?() — gated by capabilities().pull   ·   invoke?() — reserved for AF.2
 *
 * core ──imports──▶ SPI only        adapters/{anthropic,openai_compat,ollama,copilot,cursor,fake}
 * ```
 *
 * ---------------------------------------------------------------------------
 * **The problem it exists for.** Five kinds ship in MVP and mockup 07's dashed card promises
 * *"OpenAI, Google, Bedrock, or any OpenAI-compatible endpoint"*. Written as a `switch (kind)`
 * across REST, the add-form renderer and the card component, each new provider is a three-file
 * change in three modules — and the catalog promise becomes something the team dreads rather
 * than something that just happens.
 *
 * This project already solved the problem once. The ticket-source SPI (WF-Q.2,
 * [#139](https://github.com/NobuData/ouroboros/issues/139)) set the discipline and its
 * conformance kit ([#142](https://github.com/NobuData/ouroboros/issues/142)) is what makes
 * *"it works on my provider"* a test result rather than a claim. Decision **P1** applies the
 * same pattern here, and `.dependency-cruiser.cjs` is the half a reviewer does not have to
 * remember: a core service that imports an adapter, or any file outside `adapters/` that
 * imports a provider SDK, fails the build.
 *
 * ---------------------------------------------------------------------------
 * **Why `validate` takes loose parts and `discoverModels` takes a connection.**
 *
 * The asymmetry is the lifecycle, not an oversight. `validate` is what AE.5
 * ([#231](https://github.com/NobuData/ouroboros/issues/231)) calls from the add-form *before a
 * row exists* — there is no `connectionId` to hand it, and the credential is a string somebody
 * has just typed rather than a sealed column. `discoverModels` and `pullModel` run against a
 * connection that has been saved, opened by AD.2
 * ([#223](https://github.com/NobuData/ouroboros/issues/223)) for the length of one call.
 *
 * Naming that difference in the signatures means an adapter cannot accidentally require a
 * saved row in order to answer *is this key any good* — which is the one question the add-form
 * has to be able to ask.
 *
 * ---------------------------------------------------------------------------
 * **Failures: a value from `validate`, an exception from the other two.**
 *
 * `validate` returning a failure is the same decision `provider-health/probe.client.ts` makes
 * and for the same reason — a provider being down is the state mockup 07's card foot exists to
 * render, and an exception would put a pill's colour at the mercy of somebody's control flow.
 * `discoverModels` answers a list and `pullModel` answers a stream; neither has room for a
 * failure, so both throw {@link import("./provider.errors").ProviderAdapterError}, which
 * carries the same five-word taxonomy a validation failure would have.
 *
 * ---------------------------------------------------------------------------
 * **Capabilities gate members at compile time, and `pull` is the worked example.**
 *
 * {@link ModelProviderAdapter} has no `pullModel` at all. An adapter that pulls implements
 * {@link PullCapableAdapter}, and a caller reaches the member through {@link supportsPull} or
 * through `ModelProviderRegistry.pullCapable`. So `registry.get("copilot").pullModel(…)` does
 * not compile — *Property 'pullModel' does not exist* — rather than throwing at run time in
 * front of somebody who clicked a button. AC.1's fifth acceptance criterion, as a type.
 *
 * **`invocation` is reserved, and this is the recipe AF.2 follows.** AF.2
 * ([#235](https://github.com/NobuData/ouroboros/issues/235)) adds an `InvocationCapableAdapter`
 * in exactly the shape of {@link PullCapableAdapter} below — an interface extending this one,
 * narrowing `capabilities()` to `{ invocation: true }`, declaring `invoke`, and a `supportsInvocation`
 * guard beside it. The request and event shapes it will use are already written, in
 * `internal/invoke.contract.ts` (AD.3). Nothing in this file has to move for that to happen,
 * which is the whole point of reserving the flag now: AF.2 *extends* the interface rather than
 * reshaping it, and every adapter that already ships keeps compiling.
 */

import type { ProviderConnectionKind } from "../db/schema";
import type { ProviderConfigSchema, ProviderConnectionConfig } from "./provider.config";
import { pillFor, type ProviderErrorClass, type ProviderStatusPill } from "./provider.errors";

/**
 * What an adapter can do, as four flags.
 *
 * A total shape rather than an optional bag: an adapter author has to answer all four, and
 * `false` is an answer. A partial record would let a capability be *unmentioned*, and every
 * consumer would then have to decide what an absent flag means — which is how a fifth
 * meaning ("undefined, so probably no") gets invented at four call sites.
 */
export interface ProviderCapabilities {
  /**
   * Whether {@link ModelProviderAdapter.discoverModels} asks the provider, or answers a fixed
   * catalog.
   *
   * **Not whether the member exists** — it always does. Mockup 07's Copilot and Cursor cards
   * each show a single model chip that this product knows about because somebody wrote it
   * down, and a `discoverModels` that returned that list is telling the truth. What the flag
   * says is whether *refreshing* means anything: AE.4
   * ([#230](https://github.com/NobuData/ouroboros/issues/230)) hides the refresh affordance
   * where it is `false`, because a spinner over a constant is a lie about where data comes
   * from.
   */
  readonly discovery: boolean;
  /**
   * Whether this adapter implements {@link PullCapableAdapter}.
   *
   * The one flag with a member behind it today. Ollama-class only: mockup 07's pull-list with
   * its **Pull latest** buttons is AC.4's ([#219](https://github.com/NobuData/ouroboros/issues/219)).
   * The conformance kit asserts this flag and the member agree, in both directions.
   */
  readonly pull: boolean;
  /**
   * Whether {@link ModelProviderAdapter.validate} also reports what the credential is entitled
   * to.
   *
   * No member of its own — it is a promise about `detail`. Mockup 07's Copilot card reads
   * *"org-billed · 4 seats"*, and a seat count is something only a check against the vendor
   * can know. AC.5 ([#220](https://github.com/NobuData/ouroboros/issues/220)) is the adapter
   * that sets it; AE.2 ([#228](https://github.com/NobuData/ouroboros/issues/228)) renders the
   * capability line from it.
   */
  readonly entitlements: boolean;
  /**
   * **Reserved for AF.2** ([#235](https://github.com/NobuData/ouroboros/issues/235)) — whether
   * this adapter can execute a model call.
   *
   * `false` on every adapter that ships under AC.1–AC.5, and the flag exists now so that the
   * interface AF.2 needs is an extension rather than a reshape. See this file's header for the
   * recipe, which is the one {@link PullCapableAdapter} already demonstrates.
   */
  readonly invocation: boolean;
}

/**
 * One model an adapter found, in this product's vocabulary rather than its provider's.
 *
 * Four fields, because four is what mockup 07's two model surfaces need: the **Models
 * available** chips print {@link display}, and the Ollama pull-list prints {@link id} beside
 * {@link sizeBytes} as `qwen3-coder:32b · 19 GB`. {@link contextLength} is what mockup 21's
 * registry and Z.1's floor policy read.
 *
 * **`null` means the provider did not say**, never zero and never a guess. A model whose
 * context length is unknown and a model with no context are different facts, and only one of
 * them is possible.
 */
export interface NormalizedModel {
  /**
   * The provider's own identifier, unchanged — `claude-opus-5`, `qwen3-coder:32b`.
   *
   * Unchanged because it is what a later call has to send back, and because
   * `model_aliases.model` and `model_prices.match_model` are written against these spellings.
   * An adapter that prettified an id here would break the join that makes a chip's price real.
   */
  readonly id: string;
  /**
   * What a person reads — *Claude Opus 5*, *Qwen3 Coder 32B*.
   *
   * Falls back to {@link id} when the provider publishes no display name; an adapter must
   * never leave this empty, because a chip with no text is a chip nobody can click.
   */
  readonly display: string;
  /** Tokens of context, or null when the provider does not publish it. */
  readonly contextLength: number | null;
  /**
   * On-disk size in bytes, or null.
   *
   * Only a locally-hosted model has one. The pull-list's `19 GB` is this, formatted by the UI
   * — bytes rather than a formatted string, because a number is a fact and `19 GB` is a
   * rendering decision made in the wrong module.
   */
  readonly sizeBytes: number | null;
}

/** A live check that succeeded. */
export interface ProviderValidationOk {
  readonly status: "ok";
  /**
   * The measured round trip, in whole milliseconds. Never negative.
   *
   * Present on this branch only — see {@link ProviderValidationFailure} for why a failure
   * carries none.
   */
  readonly latencyMs: number;
  /**
   * The card foot's note after the glyph — `200`.
   *
   * Mockup 07 draws it as `✓ 200 · 38ms`: the glyph is the status, this is the detail, and the
   * latency is appended by the card. An adapter that returned the whole sentence would be
   * deciding a layout from inside a network client.
   */
  readonly detail: string;
}

/** A live check that failed. */
export interface ProviderValidationFailure {
  readonly status: "failed";
  /**
   * Which of the five it was — see `provider.errors.ts`, which is where this maps onto the
   * card's status pill.
   */
  readonly errorClass: ProviderErrorClass;
  /**
   * The card foot's note after the glyph — `503 upstream`, `key rejected (401)`.
   *
   * Mockup 07's warn note reads `△ 503 upstream · retrying`; the `· retrying` half is the
   * card's, from `PROVIDER_ERROR_RETRYABLE`.
   *
   * **Must never contain the credential.** The conformance kit asserts it against every
   * recorded failure fixture, because the shortest path to a leaked key is an adapter that
   * echoes a provider's error body, and provider error bodies quote request headers.
   */
  readonly detail: string;
}

/**
 * What a live check found.
 *
 * A union rather than one shape with optional fields, so that *there is no latency on a
 * failure* is enforced by the compiler instead of by a convention. It is the same rule
 * `provider-health/probe.client.ts` states in prose: a timeout's "latency" is the deadline and
 * a refusal's is how fast the refusal came, and neither is what the word means on a card.
 */
export type ProviderValidation = ProviderValidationOk | ProviderValidationFailure;

/**
 * The pill a validation result renders as.
 *
 * @param validation - What the check found.
 * @returns `connected` for a success, the class's own pill for a failure.
 */
export function validationPill(validation: ProviderValidation): ProviderStatusPill {
  return pillFor(validation.status === "ok" ? null : validation.errorClass);
}

/**
 * A saved connection, opened for the length of one call.
 *
 * What {@link ModelProviderAdapter.discoverModels} and {@link PullCapableAdapter.pullModel} are
 * handed. It is assembled by the caller — AD.2 opens the credential, this module never holds a
 * vault — and it is deliberately not the database row: a row carries a workspace, a display
 * name, a health blob and a sealed column, none of which an adapter has any business reading.
 */
export interface ProviderConnectionContext {
  /**
   * `provider_connections.id` — for the caller's logs and for an adapter that needs to name
   * the connection in an error. Never sent to a provider.
   */
  readonly connectionId: string;
  /** The connection's settings, in the adapter's own schema's vocabulary. */
  readonly config: ProviderConnectionConfig;
  /**
   * The opened credential, or null for a provider that needs none.
   *
   * Null is the ordinary state of a local one — an Ollama daemon on the operator's own box —
   * rather than an unfinished connection.
   */
  readonly secret: string | null;
}

/**
 * The SPI. Everything core code is allowed to know about a provider.
 *
 * Five members, and every one of them is something mockup 07's page does: the add-form is
 * {@link configSchema}, the **Test connection** button is {@link validate}, the **Models
 * available** chips are {@link discoverModels}, and which affordances a card shows at all is
 * {@link capabilities}.
 */
export interface ModelProviderAdapter {
  /**
   * The registry key — one of V015's six `provider_connections.kind` values.
   *
   * The same spelling `model_prices.match_provider_kind` carries, so a connection and a price
   * agree about what kind of thing they are describing without either translating.
   */
  readonly kind: ProviderConnectionKind;

  /**
   * The fields this provider needs configured.
   *
   * @returns A schema in `provider.config.ts`'s dialect. Must be **stable** — two calls answer
   *   equal values — because AE.5 may render it, store the result, and render it again against
   *   a form somebody is halfway through filling in. The conformance kit asserts the
   *   stability, and that the value cannot be mutated back into the adapter.
   */
  configSchema(): ProviderConfigSchema;

  /**
   * What this adapter can do.
   *
   * @returns All four flags. Must be stable for the same reason {@link configSchema} must:
   *   a capability that changed between two renders would show an affordance that then failed.
   */
  capabilities(): ProviderCapabilities;

  /**
   * Check a configuration and credential against the live provider.
   *
   * The **Test connection** button, and the last step of the add-form. Called before any row
   * exists — see this file's header on the asymmetry with {@link discoverModels}.
   *
   * @param config - The settings, as
   *   {@link import("./provider.forms").partitionSubmission} produced them. Contains no
   *   credential.
   * @param secret - The credential, or null where the schema declares none. Held for the
   *   length of this call and nowhere else: an adapter that stored one would be a singleton
   *   holding a plaintext key across requests.
   * @returns What the check found. **Never rejects** for anything a provider did — a refusal,
   *   a timeout, a closed socket and a nonsense body are all results. The conformance kit
   *   asserts this against every recorded failure fixture.
   */
  validate(config: ProviderConnectionConfig, secret: string | null): Promise<ProviderValidation>;

  /**
   * The models this connection can reach.
   *
   * @param connection - The saved connection, opened.
   * @returns The models, normalized. Ids are unique within the answer; the order is the
   *   provider's own, because it is frequently meaningful and this layer has no better one.
   *   An empty list is a legitimate answer — a freshly installed Ollama daemon has no models —
   *   and is not an error.
   * @throws {ProviderAdapterError} When the provider could not be asked or refused. Carries the
   *   same five-word taxonomy a validation failure would; see this file's header.
   */
  discoverModels(connection: ProviderConnectionContext): Promise<NormalizedModel[]>;
}

/**
 * One progress event from a model pull.
 *
 * Ollama's `/api/pull` streams these; AE.4 ([#230](https://github.com/NobuData/ouroboros/issues/230))
 * renders them as the pull-list's progress. Byte counts are `null` until the provider knows
 * them — a manifest is fetched before a size is — for {@link NormalizedModel}'s reason: a
 * `0 of 0` progress bar is a claim, and an absent one is the truth.
 */
export interface ModelPullProgress {
  /** What is happening, in the provider's words — `pulling manifest`, `downloading`. */
  readonly status: string;
  /** Bytes transferred so far, or null when the provider has not said. */
  readonly completedBytes: number | null;
  /** Bytes in total, or null when the provider has not said. */
  readonly totalBytes: number | null;
  /**
   * Whether this is the last event.
   *
   * Exactly one event in a completed stream carries `true`, and it is the last. A stream that
   * ends without one ended early — which is a failure the consumer has to be able to tell from
   * a success, and cannot if completion is inferred from the iterator finishing.
   */
  readonly done: boolean;
}

/**
 * An adapter that can pull a model onto the machine serving it.
 *
 * Ollama-class. See this file's header for why the member lives on a sub-interface rather than
 * as an optional member of {@link ModelProviderAdapter}, and why that is the difference between
 * a type error and a run-time one.
 */
export interface PullCapableAdapter extends ModelProviderAdapter {
  /**
   * @returns The flags, with `pull` narrowed to `true`. Narrowing the return type is what makes
   *   an adapter claiming this interface while reporting `pull: false` fail to compile — so the
   *   flag and the member cannot disagree in the one direction a type can catch. The
   *   conformance kit catches the other.
   */
  capabilities(): ProviderCapabilities & { readonly pull: true };

  /**
   * Pull one model, reporting progress as it goes.
   *
   * @param connection - The saved connection, opened.
   * @param modelId - The model's own id, as {@link NormalizedModel.id} gave it.
   * @returns A stream of progress events, ending with one whose `done` is `true`. An async
   *   iterable rather than a callback or an event emitter, because the consumer is an HTTP
   *   response being streamed to a browser and `for await` is what that reads as.
   * @throws {ProviderAdapterError} When the pull could not be started or failed part way. A
   *   failure part way through is thrown from the iterator, which is where a `for await`
   *   catches it.
   */
  pullModel(
    connection: ProviderConnectionContext,
    modelId: string,
  ): AsyncIterable<ModelPullProgress>;
}

/**
 * Whether an adapter can pull models — and, for the compiler, that its `pullModel` is there.
 *
 * The narrowing is the point: without it there is no way to reach the member at all, which is
 * what makes AC.1's fifth acceptance criterion true.
 *
 * The check is the **flag**, not the presence of the method. An adapter is entitled to say what
 * it can do, and an inherited or half-finished `pullModel` on something reporting `pull: false`
 * must not be callable because it happens to exist. The conformance kit asserts the two agree,
 * so a disagreement is caught where it is written rather than where it is called.
 *
 * @param adapter - Any adapter.
 * @returns `true` when it declares the capability.
 */
export function supportsPull(adapter: ModelProviderAdapter): adapter is PullCapableAdapter {
  return adapter.capabilities().pull;
}
