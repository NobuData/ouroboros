/**
 * The Anthropic adapter's **recorded fixtures** — captured responses, and the stand-in `fetch`
 * that serves them.
 *
 * AC.2 ([#217](https://github.com/NobuData/ouroboros/issues/217)). The conformance kit is
 * explicit that its fixtures are recorded rather than live: *"a harness arranges a stand-in
 * `fetch` over a captured response and calls the adapter"*. That is what this file is. It
 * opens no socket, so `anthropic.conformance.spec.ts` and `anthropic.adapter.spec.ts` run in
 * `yarn test` — the suite that will actually notice them — rather than in an integration
 * suite gated on somebody having a key.
 *
 * ```
 * success        200  ·  four claude-* models          → the card's chips, and ✓ 200 · 38ms
 * priority       200  ·  anthropic-priority-…-limit    → the `priority tier` pill (P8)
 * auth           401  ·  authentication_error          → key rejected
 * rate_limit     429  ·  rate_limit_error              → rate limited
 * upstream       529  ·  overloaded_error              → degraded upstream
 * network        —    ·  TypeError · ECONNREFUSED      → unreachable
 * config         —    ·  no credential at all          → needs configuration
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Why the responses are built by functions rather than held as constants.** A `Response`
 * body may be read once. The kit builds a fresh harness for every `it` precisely so no case
 * can be affected by a previous one, and a shared `Response` would undo that by being
 * consumed by whichever test ran first. The *bodies* are constants — they are the recording —
 * and each builder wraps one in a new envelope.
 *
 * ---------------------------------------------------------------------------
 * **The error bodies are Anthropic's real shape, and nothing reads them.** They are here so
 * that the assertion *no `detail` ever quotes a provider's error body* is made against a body
 * that really would leak something if it were read: each carries a `request_id` and a message
 * naming the header. The adapter cancels every refusal unread, and the kit searches every
 * rendered detail for the credential.
 *
 * It is a `.fixture.ts`: type-checked with the code it exercises, left out of the image by
 * `tsconfig.build.json`, and not counted as application code by `jest.config.mjs`.
 */

import type { NormalizedModel } from "../provider.adapter";
import { PRIORITY_TIER } from "./anthropic.adapter";

/**
 * The credential every recorded call is made with.
 *
 * Shaped like a real key — mockup 07's key row reads `sk-ant-api03-••••••••••••Xq4A` — and
 * long enough to be findable: the conformance kit searches every rendered `detail` for this
 * exact string, and a secret of `"x"` would appear in a hundred innocent sentences and prove
 * nothing. It is not a key, has never been one, and reaches no network.
 */
export const ANTHROPIC_SECRET = "sk-ant-api03-000000000000000000000000000000217Xq4A";

/**
 * The four models mockup 07's card draws, as `/v1/models` answers them.
 *
 * Anthropic's model object is an `id`, a `type`, a `display_name` and a `created_at` — no
 * context window, which is why every expected model below carries `contextLength: null`. The
 * order is the provider's own, newest first, and this adapter preserves it.
 */
export const ANTHROPIC_MODEL_ENTRIES: readonly unknown[] = Object.freeze([
  {
    type: "model",
    id: "claude-fable-5",
    display_name: "Claude Fable 5",
    created_at: "2026-05-14T00:00:00Z",
  },
  {
    type: "model",
    id: "claude-opus-5",
    display_name: "Claude Opus 5",
    created_at: "2026-05-14T00:00:00Z",
  },
  {
    type: "model",
    id: "claude-sonnet-5",
    display_name: "Claude Sonnet 5",
    created_at: "2026-05-14T00:00:00Z",
  },
  {
    type: "model",
    id: "claude-haiku-4-5",
    display_name: "Claude Haiku 4.5",
    created_at: "2025-10-01T00:00:00Z",
  },
]);

/**
 * What the listing above must normalize to when the response carried no tier signal.
 *
 * Written out in full, which is the point of the kit's discovery leg: normalization is where
 * two adapters most easily disagree — one trims a vendor prefix, another does not — and the
 * only way to check it is to state the answer.
 */
export const ANTHROPIC_EXPECTED_MODELS: readonly NormalizedModel[] = Object.freeze([
  Object.freeze({
    id: "claude-fable-5",
    display: "Claude Fable 5",
    contextLength: null,
    sizeBytes: null,
    tier: null,
  }),
  Object.freeze({
    id: "claude-opus-5",
    display: "Claude Opus 5",
    contextLength: null,
    sizeBytes: null,
    tier: null,
  }),
  Object.freeze({
    id: "claude-sonnet-5",
    display: "Claude Sonnet 5",
    contextLength: null,
    sizeBytes: null,
    tier: null,
  }),
  Object.freeze({
    id: "claude-haiku-4-5",
    display: "Claude Haiku 4.5",
    contextLength: null,
    sizeBytes: null,
    tier: null,
  }),
]);

/**
 * The same four models, as they normalize when the response *did* carry the signal.
 *
 * The `priority tier` pill's data, and the row `R__dev_seed_providers.sql` seeds: every
 * Anthropic model carries `meta.tier = "priority"`, because an entitlement is a fact about
 * the credential rather than about one model.
 */
export const ANTHROPIC_EXPECTED_PRIORITY_MODELS: readonly NormalizedModel[] = Object.freeze(
  ANTHROPIC_EXPECTED_MODELS.map((model) => Object.freeze({ ...model, tier: PRIORITY_TIER })),
);

/**
 * The rate-limit headers an organization **with** priority-tier capacity is sent.
 *
 * Captured from a real answer's shape: the standard allowances, plus the `anthropic-priority-`
 * family that only such an organization receives. The standard ones are here on purpose —
 * they are the near-miss that a prefix match written carelessly would report as a tier.
 */
export const ANTHROPIC_PRIORITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "anthropic-ratelimit-requests-limit": "4000",
  "anthropic-ratelimit-input-tokens-limit": "2000000",
  "anthropic-priority-input-tokens-limit": "500000",
  "anthropic-priority-input-tokens-remaining": "500000",
  "anthropic-priority-output-tokens-limit": "100000",
});

/**
 * The rate-limit headers an organization **without** it is sent.
 *
 * The standard family and nothing else, which is what makes the priority family a signal
 * rather than a formality — and which is the response every assertion about "no pill" is made
 * against.
 */
export const ANTHROPIC_STANDARD_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "anthropic-ratelimit-requests-limit": "4000",
  "anthropic-ratelimit-input-tokens-limit": "2000000",
});

/**
 * Anthropic's error envelope, as it really arrives.
 *
 * A `type`, an `error` with its own `type` and `message`, and a `request_id`. Nothing in the
 * adapter reads it; it exists so that the kit's *the detail never quotes the provider's body*
 * assertion is made against a body worth not quoting.
 *
 * @param type - The vendor's error type — `authentication_error`, `rate_limit_error`.
 * @param message - The vendor's message.
 * @returns The body.
 */
export function anthropicErrorBody(type: string, message: string): unknown {
  return {
    type: "error",
    request_id: "req_011CQ217AnthropicAdapterFixture",
    error: { type, message },
  };
}

/** One recorded refusal per HTTP status the kit needs, with the vendor's real error type. */
export const ANTHROPIC_REFUSALS: Readonly<Record<number, unknown>> = Object.freeze({
  401: anthropicErrorBody(
    "authentication_error",
    "invalid x-api-key: the header was present but the key it carried is not recognised",
  ),
  429: anthropicErrorBody(
    "rate_limit_error",
    "Number of request tokens has exceeded your rate limit",
  ),
  529: anthropicErrorBody("overloaded_error", "Overloaded"),
  404: anthropicErrorBody("not_found_error", "Not found"),
});

/**
 * A recorded model listing.
 *
 * @param options - What to vary. Every field has a default that makes the ordinary answer.
 * @returns A fresh `Response`, because a body may be read once.
 */
export function recordedListing(options: RecordedListingOptions = {}): Response {
  return Response.json(
    {
      data: options.entries ?? ANTHROPIC_MODEL_ENTRIES,
      has_more: options.hasMore ?? false,
      first_id: options.firstId ?? null,
      last_id: options.lastId ?? null,
    },
    { status: 200, headers: options.headers ?? ANTHROPIC_STANDARD_HEADERS },
  );
}

/** How {@link recordedListing} may be varied. */
export interface RecordedListingOptions {
  /** The entries. Defaults to {@link ANTHROPIC_MODEL_ENTRIES}. */
  readonly entries?: readonly unknown[];
  /** Whether Anthropic says another page follows. Defaults to `false`. */
  readonly hasMore?: boolean;
  /** The cursor for that page. Defaults to `null`. */
  readonly lastId?: string | null;
  /** The first entry's id, which nothing reads. Defaults to `null`. */
  readonly firstId?: string | null;
  /** The response headers. Defaults to {@link ANTHROPIC_STANDARD_HEADERS}. */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * A recorded refusal.
 *
 * @param status - The status. One of {@link ANTHROPIC_REFUSALS}' keys, or any other — an
 *   unrecorded status gets a plausible envelope so a test about classification does not need
 *   a body written for it.
 * @returns A fresh `Response`.
 */
export function recordedRefusal(status: number): Response {
  return Response.json(ANTHROPIC_REFUSALS[status] ?? anthropicErrorBody("api_error", "Failure"), {
    status,
    headers: ANTHROPIC_STANDARD_HEADERS,
  });
}

/**
 * The transport failure a refused socket really arrives as.
 *
 * `fetch` reports one as a `TypeError` reading *fetch failed* whose `cause` carries the code —
 * which is the shape `errors/failure.ts` exists to look through, and the reason a fixture that
 * threw a bare `Error` would prove nothing.
 *
 * @param code - The runtime's code. Defaults to a refused connection.
 * @returns The error to reject with.
 */
export function recordedTransportFailure(code = "ECONNREFUSED"): unknown {
  return new TypeError("fetch failed", { cause: { code } });
}

/**
 * A deadline, as `AbortSignal.timeout` reports one.
 *
 * A `DOMException`, which Node does **not** make an `instanceof Error` — the trap
 * `provider.errors.ts`'s `isTimeout` is written for. Constructed here so a test of the timeout
 * phrase exercises the real shape rather than an object with the right `name`.
 *
 * @returns The error to reject with.
 */
export function recordedTimeout(): unknown {
  return new DOMException("The operation was aborted due to timeout", "TimeoutError");
}

/**
 * Serve these responses to the next `fetch` calls, in order.
 *
 * The global `fetch` is spied on rather than injected, for `probe.client.spec.ts`'s reason:
 * injecting one would make every assertion *"the adapter called the function it was given"*,
 * which is equally true of an adapter that also calls the real one.
 *
 * @param responses - What to answer, oldest first. The last one is repeated if the adapter asks
 *   again, so a test that does not care how many calls happen does not have to count — but it
 *   is repeated as the *same object*, and a body may be read once. A test whose adapter really
 *   reads more bodies than there are responses here wants {@link recordRepeatedly}.
 * @returns The spy, for a test that wants to read the request the provider would have seen.
 */
export function recordResponses(
  ...responses: readonly Response[]
): jest.MockedFunction<typeof fetch> {
  const spy = jest.spyOn(globalThis, "fetch") as unknown as jest.MockedFunction<typeof fetch>;

  spy.mockReset();

  for (const response of responses.slice(0, -1)) {
    spy.mockResolvedValueOnce(response);
  }

  spy.mockResolvedValue(responses[responses.length - 1]);

  return spy;
}

/**
 * Answer every `fetch` with a freshly built response.
 *
 * The counterpart of {@link recordResponses} for a test that drives an adapter round a loop:
 * a `Response`'s body may be read once, so handing the same object back a second time is a
 * *body already used* failure rather than the behaviour under test.
 *
 * @param build - Builds one response. Called once per request.
 * @returns The spy.
 */
export function recordRepeatedly(build: () => Response): jest.MockedFunction<typeof fetch> {
  const spy = jest.spyOn(globalThis, "fetch") as unknown as jest.MockedFunction<typeof fetch>;

  spy.mockReset();
  // eslint-disable-next-line @typescript-eslint/require-await
  spy.mockImplementation(async () => build());

  return spy;
}

/**
 * Fail the next `fetch` the way the runtime fails.
 *
 * @param error - What to reject with. Defaults to a refused connection.
 * @returns The spy.
 */
export function recordFailure(
  error: unknown = recordedTransportFailure(),
): jest.MockedFunction<typeof fetch> {
  const spy = jest.spyOn(globalThis, "fetch") as unknown as jest.MockedFunction<typeof fetch>;

  spy.mockReset();
  spy.mockRejectedValue(error);

  return spy;
}

/**
 * The request the provider would have received, from a spy.
 *
 * @param spy - The `fetch` spy.
 * @param index - Which call. Defaults to the first.
 * @returns Its URL and its init, so a test can assert the method, the headers and the
 *   deadline without repeating the tuple destructuring.
 */
export function recordedRequest(
  spy: jest.MockedFunction<typeof fetch>,
  index = 0,
): { url: string; init: RequestInit } {
  const [target, init] = spy.mock.calls[index];
  // `fetch` accepts three things and this adapter only ever passes the first, but the tuple's
  // type is all three — and `String(new Request(…))` is `[object Object]`, which would make a
  // URL assertion pass for the wrong reason.
  const url =
    typeof target === "string" ? target : target instanceof URL ? target.href : target.url;

  return { url, init: init ?? {} };
}
