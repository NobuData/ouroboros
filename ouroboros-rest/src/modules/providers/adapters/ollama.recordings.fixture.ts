/**
 * The Ollama adapter's **recorded fixtures** — a captured daemon, the refusals a proxy in front
 * of one answers with, and the two pull streams AC.4 asks for by name.
 *
 * AC.4 ([#219](https://github.com/NobuData/ouroboros/issues/219)):
 * *"Recorded fixtures for the kit, including streamed pull chunks and a partial-then-resumed
 * sequence."* The stand-in `fetch` is `http.recordings.fixture.ts`, shared with every other HTTP
 * adapter; what is here is the captures. No socket is opened, so
 * `ollama.conformance.spec.ts` and `ollama.adapter.spec.ts` run in `yarn test`.
 *
 * ```
 * version     200  ·  {"version":"0.12.3"}                → the card foot's  ✓ 200 · 4ms
 * tags        200  ·  three models, with real sizes       → qwen3-coder:32b · 19 GB …
 * pull        200  ·  NDJSON, manifest → layers → success → the pull-list's progress bar
 * resumed     200  ·  NDJSON that starts at 61%           → a layer already half on disk
 * auth        401  ·  a reverse proxy's challenge         → key rejected
 * rate_limit  429  ·  the same proxy, throttling          → rate limited
 * upstream    500  ·  the daemon's own failure            → degraded upstream
 * config      404  ·  a Host pointed at something else    → needs configuration
 * network     —    ·  TypeError · ECONNREFUSED            → host unreachable  (a stopped daemon)
 * ```
 *
 * ---------------------------------------------------------------------------
 * **The `401` and `429` come from a reverse proxy, and that is why they are recorded.**
 *
 * An Ollama daemon authenticates nobody — the adapter declares no credential field at all. The
 * conformance kit still requires a fixture for every one of the five error classes, with no
 * *"this cannot happen for my provider"* escape hatch, and that rule earns its keep here:
 * putting a daemon behind Caddy or nginx with basic auth is the ordinary way an operator exposes
 * one beyond their own machine, and a `401` from that proxy is a real answer this adapter has to
 * classify. An author who could have declared the class inapplicable would have shipped an
 * adapter that renders *degraded upstream* over a password prompt.
 *
 * ---------------------------------------------------------------------------
 * **The sizes are the mockup's, in bytes.**
 *
 * `19 GB`, `63 GB` and `9.1 GB` are what mockup 07's pull-list draws, and `ollama list` prints
 * sizes in decimal units — so {@link OLLAMA_TAG_ENTRIES}' `size` values are the byte counts that
 * render as those three tags. The adapter reports bytes and nothing else: `19 GB` is a rendering
 * decision, it belongs to AE.4 ([#230](https://github.com/NobuData/ouroboros/issues/230)), and a
 * fixture that recorded the *string* would be recording the wrong layer's answer.
 *
 * ---------------------------------------------------------------------------
 * **Two pull streams, because a pull has two shapes.**
 *
 * {@link OLLAMA_PULL_LINES} is a cold pull: a manifest fetch with no byte counts *at all* — which
 * is why {@link import("../provider.adapter").ModelPullProgress}'s counts are nullable rather
 * than defaulted to zero — then a layer transferring, then verify, write, and `success`.
 *
 * {@link OLLAMA_RESUMED_PULL_LINES} is the partial-then-resumed sequence: the same model, pulled
 * again after the transfer was interrupted, so the daemon's very first byte count is already at
 * 61% of the layer. It is the fixture that proves nothing in the adapter assumes a pull starts
 * at zero — a progress reading that was computed as *bytes seen since we started* rather than
 * read from the daemon would show 0% here and then jump.
 *
 * Both are served through {@link recordedPull}, which can split the stream at arbitrary byte
 * offsets — because a JSON object arriving in two TCP segments is the ordinary case for a
 * line-delimited protocol, not an edge one.
 *
 * It is a `.fixture.ts`: type-checked with the code it exercises, left out of the image by
 * `tsconfig.build.json`, and not counted as application code by `jest.config.mjs`.
 */

import type { NormalizedModel } from "../provider.adapter";

/**
 * Mockup 07's **Host** field, verbatim.
 *
 * A `.local` name on somebody's own network, which is exactly the address the SSRF policy
 * deliberately allows and the reflexive private-range block would refuse.
 */
export const OLLAMA_HOST = "http://ken-station.local:11434";

/** Where {@link OLLAMA_HOST} puts the version ping. */
export const OLLAMA_VERSION_URL = "http://ken-station.local:11434/api/version";

/** Where {@link OLLAMA_HOST} puts the model listing. */
export const OLLAMA_TAGS_URL = "http://ken-station.local:11434/api/tags";

/** Where {@link OLLAMA_HOST} puts the pull route. */
export const OLLAMA_PULL_URL = "http://ken-station.local:11434/api/pull";

/** Mockup 07's capability line under the Ollama card's name, verbatim. */
export const OLLAMA_CAPABILITY_NOTE = "zero-cost lane — used for docs & commit messages";

/**
 * Where a recorded redirect tries to send this service.
 *
 * The AWS instance metadata service. Nothing fetches it — that is the assertion — and it is this
 * address rather than an innocuous one because a fixture should look like the attack the rule
 * exists to stop. A daemon put behind a proxy that has been reconfigured is how a `302` really
 * turns up on this card.
 */
export const OLLAMA_REDIRECT_TARGET = "http://169.254.169.254/latest/meta-data/iam/";

/** The model the recorded pulls are of — mockup 07's largest, and the one worth resuming. */
export const OLLAMA_PULLED_MODEL = "llama4:scout";

/**
 * The three models mockup 07's `OL` card draws, as `/api/tags` answers them.
 *
 * The shapes are the daemon's own: `name` and `model` carry the same string, `details` is the
 * manifest's summary, and `digest` is the manifest's. Nothing but `name` and `size` is read —
 * the rest is kept because a capture that quietly tidied a response is not a capture.
 */
export const OLLAMA_TAG_ENTRIES: readonly unknown[] = Object.freeze([
  {
    name: "qwen3-coder:32b",
    model: "qwen3-coder:32b",
    modified_at: "2026-07-19T09:14:02.118374Z",
    // 19 GB, as `ollama list` prints it.
    size: 18_997_469_184,
    digest: "b5f1e0d2196a3c4e5f60718293a4b5c6d7e8f9012a3b4c5d6e7f8091a2b3c4d5",
    details: {
      parent_model: "",
      format: "gguf",
      family: "qwen3",
      families: ["qwen3"],
      parameter_size: "32.8B",
      quantization_level: "Q4_K_M",
    },
  },
  {
    name: "llama4:scout",
    model: "llama4:scout",
    modified_at: "2026-06-30T21:41:55.902117Z",
    // 63 GB.
    size: 62_970_741_760,
    digest: "c6a2f1e3287b4d5f60718293a4b5c6d7e8f9012a3b4c5d6e7f8091a2b3c4d5e6",
    details: {
      parent_model: "",
      format: "gguf",
      family: "llama4",
      families: ["llama4"],
      parameter_size: "108.6B",
      quantization_level: "Q4_K_M",
    },
  },
  {
    name: "phi4:14b",
    model: "phi4:14b",
    modified_at: "2026-05-14T16:03:11.447290Z",
    // 9.1 GB.
    size: 9_053_116_800,
    digest: "d7b3021f398c5e6f70819304b5c6d7e8f9012a3b4c5d6e7f8091a2b3c4d5e6f7",
    details: {
      parent_model: "",
      format: "gguf",
      family: "phi3",
      families: ["phi3"],
      parameter_size: "14.7B",
      quantization_level: "Q4_K_M",
    },
  },
]);

/**
 * What the recorded listing must normalize to.
 *
 * Written out in full, which is the point of the kit's discovery leg: normalization is where two
 * adapters most easily disagree, and the only way to check it is to state the answer. The two
 * things worth reading here are that `display` is the tag *unchanged* — unlike AC.3's `local/`
 * chips, because `:32b` already says what an Ollama tag is — and that `sizeBytes` is the
 * daemon's own number rather than anything derived from it.
 */
export const OLLAMA_EXPECTED_MODELS: readonly NormalizedModel[] = Object.freeze([
  Object.freeze({
    id: "qwen3-coder:32b",
    display: "qwen3-coder:32b",
    contextLength: null,
    tier: null,
    sizeBytes: 18_997_469_184,
  }),
  Object.freeze({
    id: "llama4:scout",
    display: "llama4:scout",
    contextLength: null,
    tier: null,
    sizeBytes: 62_970_741_760,
  }),
  Object.freeze({
    id: "phi4:14b",
    display: "phi4:14b",
    contextLength: null,
    tier: null,
    sizeBytes: 9_053_116_800,
  }),
]);

/**
 * A cold pull of {@link OLLAMA_PULLED_MODEL}, line by line.
 *
 * The daemon's own sequence, shortened in the middle: a real 63 GB transfer emits a progress
 * line every few hundred milliseconds, and a fixture with nine thousand of them would say
 * nothing the five below do not.
 *
 * The first line is the interesting one. `pulling manifest` carries **no counts at all**, because
 * the daemon does not know the size until it has the manifest — which is why
 * {@link import("../provider.adapter").ModelPullProgress}'s byte counts are nullable rather than
 * defaulted to zero. A `0 of 0` progress bar is a claim; an absent one is the truth.
 */
export const OLLAMA_PULL_LINES: readonly unknown[] = Object.freeze([
  { status: "pulling manifest" },
  {
    status: "pulling c6a2f1e3287b",
    digest: "sha256:c6a2f1e3287b4d5f60718293a4b5c6d7e8f9012a3b4c5d6e7f8091a2b3c4d5e6",
    total: 62_970_741_760,
    completed: 0,
  },
  {
    status: "pulling c6a2f1e3287b",
    digest: "sha256:c6a2f1e3287b4d5f60718293a4b5c6d7e8f9012a3b4c5d6e7f8091a2b3c4d5e6",
    total: 62_970_741_760,
    completed: 38_412_152_474,
  },
  {
    status: "pulling c6a2f1e3287b",
    digest: "sha256:c6a2f1e3287b4d5f60718293a4b5c6d7e8f9012a3b4c5d6e7f8091a2b3c4d5e6",
    total: 62_970_741_760,
    completed: 62_970_741_760,
  },
  { status: "verifying sha256 digest" },
  { status: "writing manifest" },
  { status: "removing any unused layers" },
  { status: "success" },
]);

/**
 * The same pull, resumed — the sequence AC.4 asks for by name.
 *
 * The transfer was interrupted at 61% and started again, so the daemon's *first* byte count is
 * already 38 GB of 63 GB. There is no `pulling manifest` line either: the manifest is on disk
 * from last time.
 *
 * What it proves is that nothing in the adapter computes progress from what it has itself seen.
 * A `completedBytes` derived from bytes-since-we-started would report 0% on the first line here
 * and then leap, which is precisely the lie a progress bar exists not to tell.
 */
export const OLLAMA_RESUMED_PULL_LINES: readonly unknown[] = Object.freeze([
  {
    status: "pulling c6a2f1e3287b",
    digest: "sha256:c6a2f1e3287b4d5f60718293a4b5c6d7e8f9012a3b4c5d6e7f8091a2b3c4d5e6",
    total: 62_970_741_760,
    completed: 38_412_152_474,
  },
  {
    status: "pulling c6a2f1e3287b",
    digest: "sha256:c6a2f1e3287b4d5f60718293a4b5c6d7e8f9012a3b4c5d6e7f8091a2b3c4d5e6",
    total: 62_970_741_760,
    completed: 51_226_874_368,
  },
  {
    status: "pulling c6a2f1e3287b",
    digest: "sha256:c6a2f1e3287b4d5f60718293a4b5c6d7e8f9012a3b4c5d6e7f8091a2b3c4d5e6",
    total: 62_970_741_760,
    completed: 62_970_741_760,
  },
  { status: "verifying sha256 digest" },
  { status: "success" },
]);

/**
 * A recorded version ping.
 *
 * A function rather than a constant because a `Response` body may be read once, and the kit
 * builds a fresh harness for every `it` precisely so no case can be affected by a previous one.
 *
 * @param version - What the daemon reports. Nothing reads it — the adapter cancels this body
 *   unread — and it is here because a capture of an empty `200` would not be a capture.
 * @returns A fresh `Response`.
 */
export function recordedVersion(version = "0.12.3"): Response {
  return Response.json({ version }, { status: 200 });
}

/**
 * A recorded model listing.
 *
 * @param entries - The entries. Defaults to the three-model capture.
 * @returns A fresh `Response`.
 */
export function recordedTags(entries: readonly unknown[] = OLLAMA_TAG_ENTRIES): Response {
  return Response.json({ models: entries }, { status: 200 });
}

/**
 * A recorded `200` whose body is whatever is handed in.
 *
 * For the cases about a body that is not a listing — a router's HTML login page, a JSON array,
 * an object with no `models`. Kept separate from {@link recordedTags} so that function stays
 * *the recording* and this one is obviously an arrangement.
 *
 * @param body - What the host answered with.
 * @param contentType - The header. Defaults to JSON.
 * @returns A fresh `Response`.
 */
export function recordedBody(body: string, contentType = "application/json"): Response {
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

/**
 * One recorded refusal body per status the kit needs.
 *
 * The `401` and `429` are a reverse proxy's, in its own wording, because the daemon behind it
 * has no opinion about credentials — see this file's header. The `500` and `404` are Ollama's
 * own `{"error": …}` envelope.
 *
 * Nothing in the adapter reads any of them. They exist so the *no body in a detail* assertion is
 * made against a body worth not quoting.
 */
export const OLLAMA_REFUSALS: Readonly<Record<number, string>> = Object.freeze({
  401: '<html><head><title>401 Unauthorized</title></head><body><h1>401 Unauthorized</h1><p>ken-station.local: Basic realm="ollama"</p></body></html>',
  429: '{"error":"too many requests — retry after 1s"}',
  500: '{"error":"llama runner process has terminated: signal: killed"}',
  503: '{"error":"server busy: loading model into VRAM"}',
  404: '{"error":"404 page not found"}',
});

/**
 * A recorded refusal.
 *
 * @param status - The status. One of {@link OLLAMA_REFUSALS}' keys, or any other — an unrecorded
 *   status gets a plausible envelope so a test about classification does not need a body written
 *   for it.
 * @returns A fresh `Response`. The `401` is `text/html` because that is what a proxy's challenge
 *   page really is, and an adapter that assumed every refusal is JSON would be the thing this
 *   catches.
 */
export function recordedRefusal(status: number): Response {
  const body = OLLAMA_REFUSALS[status] ?? '{"error":"the host had a problem"}';

  return new Response(body, {
    status,
    headers: { "content-type": status === 401 ? "text/html" : "application/json" },
  });
}

/**
 * A redirect, as a proxy that has been reconfigured behind an operator's back answers one.
 *
 * @param status - The redirect status. Defaults to `302`.
 * @param location - Where it points. Defaults to {@link OLLAMA_REDIRECT_TARGET}.
 * @returns A fresh `Response`, with a body — a real `302` from an HTTP server carries a short
 *   HTML courtesy page, and a fixture with no body would let an adapter that forgets to cancel
 *   one pass.
 */
export function recordedRedirect(status = 302, location = OLLAMA_REDIRECT_TARGET): Response {
  return new Response(`<html><body>Moved to <a href="${location}">here</a>.</body></html>`, {
    status,
    headers: { location, "content-type": "text/html" },
  });
}

/** How a recorded pull stream is chopped up on its way out. */
export interface RecordedPullOptions {
  /**
   * How many bytes each network chunk carries.
   *
   * The reason this option exists: NDJSON is line-delimited and TCP is not, so a progress object
   * arriving split across two reads is the ordinary case. A fixture that only ever handed over
   * whole lines would let an adapter that forgot to buffer pass every test and then fail against
   * a real daemon on its first slow layer. Defaults to one whole line per chunk.
   */
  readonly chunkBytes?: number;
  /**
   * Whether the last line ends with a newline. Defaults to `true`, which is what Ollama sends.
   *
   * `false` is the daemon that closed the stream on the byte after its last brace — rare, and
   * cheap to survive.
   */
  readonly trailingNewline?: boolean;
}

/**
 * A recorded pull, as an NDJSON stream.
 *
 * @param lines - The objects, one per line. Defaults to the cold-pull capture.
 * @param options - How to chop the bytes up on the way out.
 * @returns A fresh `Response` streaming the encoded lines. The stream stops being pulled as soon
 *   as the adapter cancels it, which is what a test of an abandoned pull relies on.
 */
export function recordedPull(
  lines: readonly unknown[] = OLLAMA_PULL_LINES,
  options: RecordedPullOptions = {},
): Response {
  const text =
    lines.map((line) => JSON.stringify(line)).join("\n") +
    ((options.trailingNewline ?? true) ? "\n" : "");

  return recordedNdjson(text, options.chunkBytes);
}

/**
 * A recorded NDJSON body, chopped into chunks.
 *
 * Separate from {@link recordedPull} so a test can record something that is *not* a valid pull —
 * HTML, a half-written object, a line longer than the buffer's cap.
 *
 * @param text - The whole body.
 * @param chunkBytes - How many bytes per chunk. Defaults to the whole body in one.
 * @returns A fresh `Response`.
 */
export function recordedNdjson(text: string, chunkBytes?: number): Response {
  const encoded = new TextEncoder().encode(text);
  const size = chunkBytes ?? Math.max(1, encoded.byteLength);
  let offset = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= encoded.byteLength) {
        controller.close();

        return;
      }

      controller.enqueue(encoded.slice(offset, offset + size));
      offset += size;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "application/x-ndjson" },
  });
}

/**
 * A pull that never says anything.
 *
 * The stall deadline's fixture: a `200` whose body is opened and then holds the connection open
 * forever, which is what a daemon whose machine has gone to sleep mid-transfer looks like from
 * here. Nothing closes it — the adapter's deadline is what has to.
 *
 * @returns A fresh `Response`.
 */
export function recordedSilentPull(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      pull() {
        // Deliberately never resolves and never enqueues. A `pull` that returns a promise which
        // never settles is how a ReadableStream says *nothing more has arrived yet*.
        return new Promise<void>(() => {
          // Intentionally empty: this stream is the silence under test.
        });
      },
    }),
    { status: 200, headers: { "content-type": "application/x-ndjson" } },
  );
}
