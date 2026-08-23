/**
 * The OpenAI-compatible adapter's **recorded fixtures** — two captured endpoints, the refusals
 * they answer with, and the SSRF cases that have to be arranged rather than recorded.
 *
 * AC.3 ([#218](https://github.com/NobuData/ouroboros/issues/218)). The stand-in `fetch` is
 * `http.recordings.fixture.ts`, shared with every other HTTP adapter; what is here is the
 * captures. No socket is opened, so `openai-compatible.conformance.spec.ts` and
 * `openai-compatible.adapter.spec.ts` run in `yarn test`.
 *
 * ```
 * vLLM        200  ·  max_model_len, root, permission     → local/llama-4-maverick · local/deepseek-v3.2
 * generic     200  ·  id · object · created · owned_by    → the same adapter, a plainer server
 * auth        401  ·  invalid_api_key                     → key rejected
 * rate_limit  429  ·  rate_limit_exceeded                 → rate limited
 * upstream    503  ·  the model is still loading          → degraded upstream
 * config      404  ·  a base URL missing its /v1          → needs configuration
 * redirect    302  ·  Location: 169.254.169.254           → not followed
 * network     —    ·  TypeError · ECONNREFUSED            → host unreachable
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Two endpoints, because the ticket asks for two.** *"Recorded fixtures for both a vLLM
 * response and a generic OpenAI-compatible response, so the kit proves the adapter is not
 * vLLM-specific."* {@link OPENAI_COMPATIBLE_FLAVOURS} is that pair, and
 * `openai-compatible.conformance.spec.ts` runs the whole conformance kit once per entry.
 *
 * They differ in the two ways that actually matter. The vLLM capture is **rich** — it publishes
 * `max_model_len`, a `root` naming the checkpoint on disk, and a `permission` array — and its
 * base URL is the OpenAI-style `…:8000/v1` mockup 07's field holds. The generic capture is
 * **bare**: four fields, no context window anywhere, and a base URL that is a plain host. So
 * between them they cover both spellings of the base URL *and* both answers to *does this
 * server say how much context it has* — and the second one's expected models carry
 * `contextLength: null`, which is the assertion that the adapter does not invent one.
 *
 * ---------------------------------------------------------------------------
 * **The `401` body really contains {@link OPENAI_COMPATIBLE_SECRET}.**
 *
 * That is deliberate and it is the sharpest test in this file. OpenAI-shaped servers quote the
 * rejected key back in their error message — *"Incorrect API key provided: sk-…"* — so an
 * adapter that put a refusal's body into a `detail` would leak the credential, and the
 * conformance kit's search for the secret in every rendered detail would find it. The adapter
 * cancels every refusal unread, and this body is what makes that assertion mean something
 * rather than pass vacuously.
 *
 * ---------------------------------------------------------------------------
 * **The redirect points at `169.254.169.254`, which is the whole point of the rule.**
 *
 * A link-local address is the classic SSRF pivot: an endpoint an operator legitimately
 * configured answers `302` to a cloud metadata service, and an adapter that followed redirects
 * would fetch it with the operator's own network position. {@link recordedRedirect} is that
 * exact shape, and `openai-compatible.adapter.spec.ts` asserts the second address is never
 * requested — one `fetch` call, and the `302` classified as the connection's own settings.
 *
 * It is a `.fixture.ts`: type-checked with the code it exercises, left out of the image by
 * `tsconfig.build.json`, and not counted as application code by `jest.config.mjs`.
 */

import type { NormalizedModel } from "../provider.adapter";
import { PROVIDER_MAX_RESPONSE_BYTES } from "../provider.address";

/**
 * The credential the recorded calls are made with.
 *
 * Shaped like the key a vLLM started with `--api-key` is given, and long enough to be findable:
 * the conformance kit searches every rendered `detail` for this exact string, and a secret of
 * `"x"` would appear in a hundred innocent sentences and prove nothing. It is not a key, has
 * never been one, and reaches no network.
 */
export const OPENAI_COMPATIBLE_SECRET = "sk-vllm-000000000000000000000000000000218Xq4A";

/** Mockup 07's **Base URL** field, verbatim — an OpenAI-style root, `/v1` included. */
export const VLLM_BASE_URL = "http://10.0.4.20:8000/v1";

/** Where {@link VLLM_BASE_URL} puts the listing: the `/v1` is not doubled. */
export const VLLM_LISTING_URL = "http://10.0.4.20:8000/v1/models";

/** A plain host, with no version segment — the other spelling an operator will paste. */
export const GENERIC_BASE_URL = "http://ken-station.local:1234";

/** Where {@link GENERIC_BASE_URL} puts the listing: the `/v1` is supplied. */
export const GENERIC_LISTING_URL = "http://ken-station.local:1234/v1/models";

/** Mockup 07's capability line under the vLLM card's name, verbatim. */
export const OPENAI_COMPATIBLE_CAPABILITY_NOTE = "self-hosted · A100 ×2";

/**
 * Where the recorded redirect tries to send this service.
 *
 * The AWS instance metadata service. Nothing fetches it — that is the assertion — and it is
 * this address rather than an innocuous one because a fixture should look like the attack the
 * rule exists to stop.
 */
export const SSRF_REDIRECT_TARGET = "http://169.254.169.254/latest/meta-data/iam/";

/**
 * The two models mockup 07's `VL` card draws, as vLLM's `/v1/models` answers them.
 *
 * The ids are what `--served-model-name` was set to, which is why they are short: vLLM serves a
 * checkpoint under whatever name the operator gave it, and `root` is where the weights actually
 * came from. `permission` is vLLM's echo of OpenAI's legacy shape — nothing reads it, and it is
 * kept because a capture that quietly tidied a response is not a capture.
 */
export const VLLM_MODEL_ENTRIES: readonly unknown[] = Object.freeze([
  {
    id: "llama-4-maverick",
    object: "model",
    created: 1_780_012_800,
    owned_by: "vllm",
    root: "meta-llama/Llama-4-Maverick-17B-128E-Instruct",
    parent: null,
    max_model_len: 1_048_576,
    permission: [
      {
        id: "modelperm-0000000000000000000000218a",
        object: "model_permission",
        created: 1_780_012_800,
        allow_sampling: true,
        allow_logprobs: true,
        is_blocking: false,
      },
    ],
  },
  {
    id: "deepseek-v3.2",
    object: "model",
    created: 1_780_012_800,
    owned_by: "vllm",
    root: "deepseek-ai/DeepSeek-V3.2-Exp",
    parent: null,
    max_model_len: 163_840,
    permission: [
      {
        id: "modelperm-0000000000000000000000218b",
        object: "model_permission",
        created: 1_780_012_800,
        allow_sampling: true,
        allow_logprobs: true,
        is_blocking: false,
      },
    ],
  },
]);

/**
 * What the vLLM listing must normalize to.
 *
 * Written out in full, which is the point of the kit's discovery leg: normalization is where two
 * adapters most easily disagree, and the only way to check it is to state the answer. The two
 * things worth reading here are that `id` is untouched while `display` carries `local/`, and
 * that `contextLength` is `max_model_len` rather than anything derived from it.
 */
export const VLLM_EXPECTED_MODELS: readonly NormalizedModel[] = Object.freeze([
  Object.freeze({
    id: "llama-4-maverick",
    display: "local/llama-4-maverick",
    contextLength: 1_048_576,
    sizeBytes: null,
    tier: null,
  }),
  Object.freeze({
    id: "deepseek-v3.2",
    display: "local/deepseek-v3.2",
    contextLength: 163_840,
    sizeBytes: null,
    tier: null,
  }),
]);

/**
 * A plainer server's answer — four fields per model and nothing else.
 *
 * llama.cpp's server, LM Studio and TGI all answer roughly this: OpenAI's own model object,
 * which has no context window in it. It is the capture that proves this adapter is not
 * vLLM-specific, and the one whose expected models are the assertion that a missing context
 * length stays missing.
 */
export const GENERIC_MODEL_ENTRIES: readonly unknown[] = Object.freeze([
  { id: "qwen3-coder-30b-a3b", object: "model", created: 1_779_408_000, owned_by: "llamacpp" },
  { id: "phi-4-reasoning", object: "model", created: 1_779_408_000, owned_by: "llamacpp" },
]);

/** What the generic listing must normalize to. Every context length is `null`, on purpose. */
export const GENERIC_EXPECTED_MODELS: readonly NormalizedModel[] = Object.freeze([
  Object.freeze({
    id: "qwen3-coder-30b-a3b",
    display: "local/qwen3-coder-30b-a3b",
    contextLength: null,
    sizeBytes: null,
    tier: null,
  }),
  Object.freeze({
    id: "phi-4-reasoning",
    display: "local/phi-4-reasoning",
    contextLength: null,
    sizeBytes: null,
    tier: null,
  }),
]);

/** One recorded endpoint, as the conformance kit and the unit suite both consume it. */
export interface OpenAiCompatibleFlavour {
  /** What to call it in a `describe` — *vLLM*, *a generic OpenAI-compatible server*. */
  readonly name: string;
  /** The **Base URL** field's value. */
  readonly baseUrl: string;
  /** Where that address puts the listing, so a test can assert the join without repeating it. */
  readonly listingUrl: string;
  /** The listing's entries, as captured. */
  readonly entries: readonly unknown[];
  /** What they must normalize to, in full. */
  readonly expected: readonly NormalizedModel[];
}

/**
 * The two endpoints the ticket asks for, and the two spellings of a base URL.
 *
 * Iterated rather than keyed: the conformance spec runs the whole kit once per entry, and a
 * `Record` would let one be dropped without a suite noticing that one is not two.
 */
export const OPENAI_COMPATIBLE_FLAVOURS: readonly OpenAiCompatibleFlavour[] = Object.freeze([
  Object.freeze({
    name: "vLLM",
    baseUrl: VLLM_BASE_URL,
    listingUrl: VLLM_LISTING_URL,
    entries: VLLM_MODEL_ENTRIES,
    expected: VLLM_EXPECTED_MODELS,
  }),
  Object.freeze({
    name: "a generic OpenAI-compatible server",
    baseUrl: GENERIC_BASE_URL,
    listingUrl: GENERIC_LISTING_URL,
    entries: GENERIC_MODEL_ENTRIES,
    expected: GENERIC_EXPECTED_MODELS,
  }),
]);

/**
 * OpenAI's error envelope, as every server speaking this format answers it.
 *
 * Nothing in the adapter reads one. They exist so the kit's *the detail never quotes the
 * provider's body* assertion is made against a body worth not quoting — see this file's header
 * on the `401`.
 *
 * @param type - The envelope's error type — `invalid_request_error`, `server_error`.
 * @param message - The server's message.
 * @param code - The symbolic code, or null where the server sends none.
 * @returns The body.
 */
export function openAiErrorBody(type: string, message: string, code: string | null): unknown {
  return { error: { message, type, param: null, code } };
}

/** One recorded refusal per HTTP status the kit needs, with a real server's wording. */
export const OPENAI_COMPATIBLE_REFUSALS: Readonly<Record<number, unknown>> = Object.freeze({
  401: openAiErrorBody(
    "invalid_request_error",
    // The credential, quoted back — which is exactly what these servers do, and what makes the
    // "no body in a detail" assertion worth making. See this file's header.
    `Incorrect API key provided: ${OPENAI_COMPATIBLE_SECRET}. ` +
      "You can find your API key in the server's startup log.",
    "invalid_api_key",
  ),
  429: openAiErrorBody(
    "rate_limit_error",
    "Rate limit reached for requests. Please try again in 1s.",
    "rate_limit_exceeded",
  ),
  503: openAiErrorBody("server_error", "The model is still being loaded onto the device.", null),
  404: openAiErrorBody(
    "invalid_request_error",
    "The route /v1/v1/models does not exist on this server.",
    null,
  ),
});

/**
 * A recorded model listing.
 *
 * A function rather than a constant because a `Response` body may be read once, and the kit
 * builds a fresh harness for every `it` precisely so no case can be affected by a previous one.
 * The *bodies* are the constants above — they are the recording — and this wraps one in a new
 * envelope.
 *
 * @param entries - The entries. Defaults to the vLLM capture.
 * @returns A fresh `Response`.
 */
export function recordedListing(entries: readonly unknown[] = VLLM_MODEL_ENTRIES): Response {
  return Response.json({ object: "list", data: entries }, { status: 200 });
}

/**
 * A recorded `200` whose body is whatever is handed in.
 *
 * For the cases about a body that is not a listing — a web UI's HTML, a JSON array, an object
 * with no `data`. Kept separate from {@link recordedListing} so that function stays *the
 * recording* and this one is obviously an arrangement.
 *
 * @param body - What the server answered with.
 * @param contentType - The header. Defaults to JSON.
 * @returns A fresh `Response`.
 */
export function recordedBody(body: string, contentType = "application/json"): Response {
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

/**
 * A recorded refusal.
 *
 * @param status - The status. One of {@link OPENAI_COMPATIBLE_REFUSALS}' keys, or any other — an
 *   unrecorded status gets a plausible envelope so a test about classification does not need a
 *   body written for it.
 * @returns A fresh `Response`.
 */
export function recordedRefusal(status: number): Response {
  return Response.json(
    OPENAI_COMPATIBLE_REFUSALS[status] ??
      openAiErrorBody("server_error", "The server had a problem.", null),
    { status },
  );
}

/**
 * A redirect, as a server that has been reconfigured behind an operator's back answers one.
 *
 * @param status - The redirect status. Defaults to `302`.
 * @param location - Where it points. Defaults to {@link SSRF_REDIRECT_TARGET}.
 * @returns A fresh `Response`, with a body — a real `302` from an HTTP server carries a short
 *   HTML courtesy page, and a fixture with no body would let an adapter that forgets to cancel
 *   one pass.
 */
export function recordedRedirect(status = 302, location = SSRF_REDIRECT_TARGET): Response {
  return new Response(`<html><body>Moved to <a href="${location}">here</a>.</body></html>`, {
    status,
    headers: { location, "content-type": "text/html" },
  });
}

/**
 * A `200` that *claims* to be enormous.
 *
 * The fast path of the response cap: a `content-length` past the limit is refused before a byte
 * of the body is read. The body itself is tiny, which is what makes this the header's test
 * rather than the stream's.
 *
 * @param declaredBytes - What `content-length` says. Defaults to one past the cap.
 * @returns A fresh `Response`.
 */
export function recordedDeclaredOversize(
  declaredBytes = PROVIDER_MAX_RESPONSE_BYTES + 1,
): Response {
  return new Response('{"object":"list","data":[]}', {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-length": declaredBytes.toString(),
    },
  });
}

/**
 * A `200` that really is enormous, and does not say so.
 *
 * The enforcement half. A streamed body with no `content-length` is what a server answering
 * from a generator sends, and it is the shape a declared-size check alone would miss — so the
 * cap has to be counted as the bytes arrive.
 *
 * @param totalBytes - How much the stream would produce if it were read to the end. Defaults to
 *   comfortably past the cap.
 * @returns A fresh `Response`. The stream stops being pulled as soon as the adapter cancels it,
 *   so nothing here actually allocates that many bytes.
 */
export function recordedStreamedOversize(totalBytes = PROVIDER_MAX_RESPONSE_BYTES * 2): Response {
  const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
  let produced = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (produced >= totalBytes) {
        controller.close();

        return;
      }

      produced += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
