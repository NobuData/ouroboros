import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CARD_SHAPES } from "../card.shapes.fixture";
import type { ProviderConnectionContext } from "../provider.adapter";
import {
  PROVIDER_MAX_RESPONSE_BYTES,
  PROVIDER_REDIRECT,
  resolveProviderAddress,
} from "../provider.address";
import {
  BASE_URL_FIELD,
  CAPABILITY_NOTE_FIELD,
  CAPABILITY_NOTE_MAX_LENGTH,
  SECRET_ANNOTATION,
} from "../provider.config";
import { ProviderAdapterError } from "../provider.errors";
import { toFormFields } from "../provider.forms";
import {
  recordFailure,
  recordResponses,
  recordedRequest,
  recordedTimeout,
  recordedTransportFailure,
} from "./http.recordings.fixture";
import {
  LOCAL_DISPLAY_PREFIX,
  OPENAI_COMPATIBLE_API_KEY_FIELD,
  OPENAI_COMPATIBLE_TIMEOUT_MS,
  OpenAiCompatibleAdapter,
  listingUrl,
  localDisplay,
  missingConfiguration,
  normalizeModel,
} from "./openai-compatible.adapter";
import {
  GENERIC_BASE_URL,
  GENERIC_EXPECTED_MODELS,
  GENERIC_LISTING_URL,
  GENERIC_MODEL_ENTRIES,
  OPENAI_COMPATIBLE_CAPABILITY_NOTE,
  OPENAI_COMPATIBLE_SECRET,
  SSRF_REDIRECT_TARGET,
  VLLM_BASE_URL,
  VLLM_EXPECTED_MODELS,
  VLLM_LISTING_URL,
  VLLM_MODEL_ENTRIES,
  recordedBody,
  recordedDeclaredOversize,
  recordedListing,
  recordedRedirect,
  recordedRefusal,
  recordedStreamedOversize,
} from "./openai-compatible.recordings.fixture";
import { paramSchemaViolations, storageViolations } from "../provider.params";

/**
 * The OpenAI-compatible adapter, against recorded responses.
 *
 * `openai-compatible.conformance.spec.ts` runs the kit — twice, once per recorded endpoint —
 * which is the contract every adapter shares. This suite is what is true about *this* one:
 * that it draws mockup 07's `VL` card, that its key is genuinely optional, that its chips carry
 * the `local/` prefix while its ids do not, and — the half with the most room to go quietly
 * wrong — that its **SSRF policy is enforced rather than described**.
 *
 * The policy's four rules each have cases below:
 *
 * ```
 * scheme allow-list    file: · gopher: · ftp: · a bare host   →  refused, and no socket opened
 * private ranges       10.0.4.20 · 127.0.0.1 · localhost      →  ALLOWED, deliberately
 * no redirects         302 → 169.254.169.254                  →  one fetch, and it is not that one
 * response size cap    a declared and an undeclared flood     →  refused, and the stream cancelled
 * ```
 *
 * Every case is arranged from `openai-compatible.recordings.fixture.ts`. Nothing opens a socket.
 */

/** A connection context, as AD.2 would hand one over. */
function connection(
  config: Record<string, string> = {
    [BASE_URL_FIELD]: VLLM_BASE_URL,
    [CAPABILITY_NOTE_FIELD]: OPENAI_COMPATIBLE_CAPABILITY_NOTE,
  },
  secret: string | null = OPENAI_COMPATIBLE_SECRET,
): ProviderConnectionContext {
  return { connectionId: "00000000-0000-4000-8000-000000000218", config, secret };
}

/** The stored settings the recorded vLLM endpoint is reached with. */
const VLLM_CONFIG = {
  [BASE_URL_FIELD]: VLLM_BASE_URL,
  [CAPABILITY_NOTE_FIELD]: OPENAI_COMPATIBLE_CAPABILITY_NOTE,
};

/** Mockup 07's vLLM card, from the fixture recorded before this adapter existed. */
const VLLM_CARD = CARD_SHAPES.find((shape) => shape.kind === "openai_compatible")!;

describe("the OpenAI-compatible adapter's config schema", () => {
  const adapter = new OpenAiCompatibleAdapter();

  it("renders mockup 07's card — a Base URL field and an optional key row", () => {
    // `card.shapes.fixture.ts` asks each of AC.2–AC.5 to assert its real schema still renders
    // the card recorded there. The recorded shape is the *minimum*, which is what lets an
    // adapter add a field the fixture predates — so the two recorded rows are checked exactly,
    // in order, and the note is checked beside them rather than instead of them.
    const fields = toFormFields(adapter.configSchema());

    expect(fields.slice(0, VLLM_CARD.fields.length)).toEqual(VLLM_CARD.fields);
  });

  it("declares the address, the optional key and the capability note, in that order", () => {
    const schema = adapter.configSchema();

    expect(Object.keys(schema.properties)).toEqual([
      BASE_URL_FIELD,
      OPENAI_COMPATIBLE_API_KEY_FIELD,
      CAPABILITY_NOTE_FIELD,
    ]);
    // The order is the order the form renders in, and the mockup draws the address first.
    expect(schema.required).toEqual([BASE_URL_FIELD]);
  });

  it("marks the key as the credential and leaves it optional", () => {
    // The one shape most adapters do not have. Mockup 07's placeholder says so in prose —
    // "API key — optional, no auth configured" — and `required` is where it is enforced.
    const schema = adapter.configSchema();

    expect(schema.properties[OPENAI_COMPATIBLE_API_KEY_FIELD][SECRET_ANNOTATION]).toBe(true);
    expect(schema.required).not.toContain(OPENAI_COMPATIBLE_API_KEY_FIELD);
    expect(toFormFields(schema)[1]).toMatchObject({ widget: "secret", required: false });
  });

  it("bounds the capability note at what V017's constraint will store", () => {
    // `provider_connections_capability_note_present` refuses anything longer. A schema with no
    // maxLength would render a form whose valid-looking submission fails at the insert.
    const note = adapter.configSchema().properties[CAPABILITY_NOTE_FIELD];

    expect(note.maxLength).toBe(CAPABILITY_NOTE_MAX_LENGTH);
    expect(adapter.configSchema().required).not.toContain(CAPABILITY_NOTE_FIELD);
  });

  it("hands out a fresh value the caller cannot mutate back in", () => {
    // AE.5 holds this while somebody fills in a form. The cast is the point of the case: the
    // interface is readonly, and what is being checked is what happens when something that is
    // not TypeScript writes to it anyway.
    const tampered = adapter.configSchema().properties[BASE_URL_FIELD] as { title: string };
    tampered.title = "tampered";

    expect(adapter.configSchema().properties[BASE_URL_FIELD].title).toBe("Base URL");
  });
});

describe("the OpenAI-compatible adapter's capabilities", () => {
  it("discovers, does not pull, and promises no entitlements", () => {
    // Nothing in an OpenAI-shaped response says anything about a seat or an allowance, and a
    // served model is already loaded — there is no route in this format to ask for another.
    expect(new OpenAiCompatibleAdapter().capabilities()).toEqual({
      discovery: true,
      pull: false,
      entitlements: false,
      invocation: false,
    });
  });

  it("keys on V015's openai_compatible kind", () => {
    expect(new OpenAiCompatibleAdapter().kind).toBe("openai_compatible");
  });
});

describe("where the listing is looked for", () => {
  it.each([
    // The mockup's own field: an OpenAI-style root, which already ends in /v1.
    [VLLM_BASE_URL, VLLM_LISTING_URL],
    // A plain host, which is the other spelling an operator will paste.
    [GENERIC_BASE_URL, GENERIC_LISTING_URL],
    // Trailing slashes are the commonest paste artefact, and a double slash is answered by vLLM
    // and refused by stricter servers.
    ["http://10.0.4.20:8000/v1/", VLLM_LISTING_URL],
    ["http://10.0.4.20:8000/v1///", VLLM_LISTING_URL],
    ["http://ken-station.local:1234/", GENERIC_LISTING_URL],
    // A gateway that mounts the API under a prefix.
    ["https://gw.internal/openai/v1", "https://gw.internal/openai/v1/models"],
    // A query string is not part of an API root, and carrying one through would send an
    // operator's stray `?` to a stranger's server.
    ["http://10.0.4.20:8000/v1?debug=1", VLLM_LISTING_URL],
    ["http://10.0.4.20:8000/v1#models", VLLM_LISTING_URL],
    // https keeps its implicit port off the URL, the way a browser writes it.
    ["https://models.example.com", "https://models.example.com/v1/models"],
  ])("joins %s onto %s", (base, expected) => {
    // Through `resolveProviderAddress`, because that is the only way an adapter ever gets a
    // root — a test that hand-built one would not be exercising the join the adapter makes.
    const address = resolveProviderAddress(base);

    expect(address.ok && listingUrl(address.root)).toBe(expected);
  });

  it("never doubles the version segment", async () => {
    // The failure this join exists to prevent: the ticket writes the call as `{base}/v1/models`
    // and the mockup's field already ends in `/v1`, so an unconditional append would request
    // `/v1/v1/models` from the card's own placeholder.
    const spy = recordResponses(recordedListing());

    await new OpenAiCompatibleAdapter().validate(VLLM_CONFIG, OPENAI_COMPATIBLE_SECRET);

    expect(recordedRequest(spy).url).toBe(VLLM_LISTING_URL);
    expect(recordedRequest(spy).url).not.toContain("/v1/v1");
  });
});

describe("the request an OpenAI-compatible endpoint sees", () => {
  it("is a GET of the models listing, with no body", async () => {
    const spy = recordResponses(recordedListing());

    await new OpenAiCompatibleAdapter().validate(VLLM_CONFIG, OPENAI_COMPATIBLE_SECRET);

    const { url, init } = recordedRequest(spy);
    expect(url).toBe(VLLM_LISTING_URL);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("presents the credential as a bearer token when there is one", async () => {
    const spy = recordResponses(recordedListing());

    await new OpenAiCompatibleAdapter().validate(VLLM_CONFIG, OPENAI_COMPATIBLE_SECRET);

    expect(recordedRequest(spy).init.headers).toEqual({
      accept: "application/json",
      authorization: `Bearer ${OPENAI_COMPATIBLE_SECRET}`,
    });
  });

  it.each([[null], [""]])("sends no Authorization header at all for %p", async (secret) => {
    // The card's ordinary state. A server that sees `Authorization: Bearer ` answers 401, which
    // would render *key rejected* on a card whose whole point is that it needs no key.
    const spy = recordResponses(recordedListing());

    await new OpenAiCompatibleAdapter().validate(VLLM_CONFIG, secret);

    expect(recordedRequest(spy).init.headers).toEqual({ accept: "application/json" });
  });

  it("carries a deadline, so a card cannot be held open by one slow endpoint", async () => {
    const spy = recordResponses(recordedListing());

    await new OpenAiCompatibleAdapter().validate(VLLM_CONFIG, OPENAI_COMPATIBLE_SECRET);

    const signal = recordedRequest(spy).init.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(OPENAI_COMPATIBLE_TIMEOUT_MS).toBe(10_000);
  });

  it("refuses to follow a redirect, on every call it makes", async () => {
    // Rule 2 of the address policy, asserted on the request rather than only on the outcome: a
    // `fetch` here that forgot the property would follow a redirect out of the address the
    // policy checked, which is the whole rule undone in one omitted line.
    const validating = recordResponses(recordedListing());
    await new OpenAiCompatibleAdapter().validate(VLLM_CONFIG, OPENAI_COMPATIBLE_SECRET);
    expect(recordedRequest(validating).init.redirect).toBe(PROVIDER_REDIRECT);

    const discovering = recordResponses(recordedListing());
    await new OpenAiCompatibleAdapter().discoverModels(connection());
    expect(recordedRequest(discovering).init.redirect).toBe("manual");
  });
});

describe("the SSRF policy", () => {
  it.each([
    ["file:///etc/passwd", 'the address scheme "file:" is not http or https'],
    ["gopher://10.0.4.20:70/", 'the address scheme "gopher:" is not http or https'],
    ["ftp://10.0.4.20/models", 'the address scheme "ftp:" is not http or https'],
    // A host typed with no scheme in front of it — the commonest mistake there is. Its
    // "scheme" starts with a digit, so it does not parse at all.
    ["10.0.4.20:8000/v1", "the address is not a URL"],
  ])("refuses %s without opening a socket", async (baseUrl, detail) => {
    const spy = recordResponses(recordedListing());

    expect(
      await new OpenAiCompatibleAdapter().validate(
        { [BASE_URL_FIELD]: baseUrl },
        OPENAI_COMPATIBLE_SECRET,
      ),
    ).toEqual({ status: "failed", errorClass: "config", detail });
    // The assertion that matters: a refused scheme is refused *before* anything is fetched.
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses an address carrying a credential, and says where the key goes", async () => {
    // A pasted `http://key:secret@host/v1` would put a credential into
    // `provider_connections.config`, which is the one column designed to be readable.
    const spy = recordResponses(recordedListing());

    expect(
      await new OpenAiCompatibleAdapter().validate(
        { [BASE_URL_FIELD]: "http://user:hunter2@10.0.4.20:8000/v1" },
        null,
      ),
    ).toEqual({
      status: "failed",
      errorClass: "config",
      detail: "the address must not carry a credential — use the API key field",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ["http://10.0.4.20:8000/v1", "RFC-1918"],
    ["http://192.168.1.50:8000/v1", "RFC-1918"],
    ["http://172.16.0.9:8000/v1", "RFC-1918"],
    ["http://127.0.0.1:8000/v1", "loopback"],
    ["http://localhost:1234", "loopback"],
    ["http://ken-station.local:11434/v1", "a private name"],
  ])("accepts %s — %s is the use case, not the attack", async (baseUrl) => {
    // The deliberate allow, asserted rather than assumed. An adapter that quietly acquired a
    // private-range check would fail here, which is the only place that regression is visible
    // before somebody's self-hosted card stops connecting.
    recordResponses(recordedListing());

    const validation = await new OpenAiCompatibleAdapter().validate(
      { [BASE_URL_FIELD]: baseUrl },
      null,
    );

    expect(validation.status).toBe("ok");
    expect(validation.detail).toBe("200");
  });

  it.each([301, 302, 303, 307, 308])(
    "does not follow a %s, and classifies it as the connection's settings",
    async (status) => {
      const spy = recordResponses(recordedRedirect(status));

      expect(
        await new OpenAiCompatibleAdapter().validate(VLLM_CONFIG, OPENAI_COMPATIBLE_SECRET),
      ).toEqual({
        status: "failed",
        errorClass: "config",
        detail: `redirect not followed (${status.toString()})`,
      });

      // The whole rule, in two assertions: exactly one request was made, and it was not the
      // metadata service the redirect pointed at.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(recordedRequest(spy).url).toBe(VLLM_LISTING_URL);
    },
  );

  it("never prints where a redirect was trying to send it", async () => {
    // Echoing the Location would print wherever an endpoint tried to steer this service, which
    // is the exfiltration shape the no-redirect rule exists to close.
    recordResponses(recordedRedirect());

    const validation = await new OpenAiCompatibleAdapter().validate(VLLM_CONFIG, null);

    expect(validation.detail).not.toContain(SSRF_REDIRECT_TARGET);
    expect(validation.detail).not.toContain("169.254");
  });

  it("does not follow a redirect during discovery either", async () => {
    const spy = recordResponses(recordedRedirect());

    await expect(new OpenAiCompatibleAdapter().discoverModels(connection())).rejects.toMatchObject({
      errorClass: "config",
      detail: "redirect not followed (302)",
      httpStatus: 302,
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("refuses a body that declares itself past the cap, before reading one", async () => {
    recordResponses(recordedDeclaredOversize());

    await expect(new OpenAiCompatibleAdapter().discoverModels(connection())).rejects.toMatchObject({
      errorClass: "upstream",
      detail: `the response exceeded ${PROVIDER_MAX_RESPONSE_BYTES.toString()} bytes`,
    });
  });

  it("refuses a body that floods without declaring anything", async () => {
    // The enforcement half. A streamed body with no content-length is what a server answering
    // from a generator sends, and a declared-size check alone would miss it.
    recordResponses(recordedStreamedOversize());

    await expect(new OpenAiCompatibleAdapter().discoverModels(connection())).rejects.toMatchObject({
      errorClass: "upstream",
      detail: `the response exceeded ${PROVIDER_MAX_RESPONSE_BYTES.toString()} bytes`,
    });
  });
});

describe("validate", () => {
  it("answers the card foot's ✓ 200 · 12ms", async () => {
    recordResponses(recordedListing());

    const validation = await new OpenAiCompatibleAdapter().validate(
      VLLM_CONFIG,
      OPENAI_COMPATIBLE_SECRET,
    );

    expect(validation.status).toBe("ok");
    expect(validation.detail).toBe("200");
    // A whole, non-negative number of milliseconds — the shape the conformance kit requires and
    // the one the card appends to the glyph.
    expect(validation.status === "ok" && Number.isInteger(validation.latencyMs)).toBe(true);
  });

  it("measures the round trip rather than reporting a constant", async () => {
    const held = 40;
    jest.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(recordedListing());
          }, held);
        }),
    );

    const validation = await new OpenAiCompatibleAdapter().validate(VLLM_CONFIG, null);

    expect(validation.status).toBe("ok");
    expect(validation.status === "ok" && validation.latencyMs).toBeGreaterThanOrEqual(held - 5);
  });

  it.each([
    [401, "auth", "key rejected (401)"],
    [403, "auth", "key rejected (403)"],
    [429, "rate_limit", "rate limited (429)"],
    [500, "upstream", "500 upstream"],
    [503, "upstream", "503 upstream"],
    [408, "network", "timed out (408)"],
    [400, "config", "responded 400"],
    [404, "config", "responded 404"],
  ] as const)("maps %s onto the %s class", async (status, errorClass, detail) => {
    // The shared taxonomy rather than a second reading of it: `classifyHttpStatus` and
    // `describeHttpRefusal` are AC.1's, and this adapter forks neither.
    recordResponses(recordedRefusal(status));

    expect(
      await new OpenAiCompatibleAdapter().validate(VLLM_CONFIG, OPENAI_COMPATIBLE_SECRET),
    ).toEqual({ status: "failed", errorClass, detail });
  });

  it("reports an unreachable endpoint with the host echoed", async () => {
    // AC.3's second acceptance criterion. The host matters here in a way it does not for a
    // cloud adapter: an operator may run several, and *unreachable* alone does not say which.
    recordFailure();

    expect(await new OpenAiCompatibleAdapter().validate(VLLM_CONFIG, null)).toEqual({
      status: "failed",
      errorClass: "network",
      detail: "10.0.4.20:8000 unreachable (ECONNREFUSED)",
    });
  });

  it("surfaces no raw socket error, only a symbolic code", async () => {
    // The other half of the same criterion. The runtime's own message carries a resolved
    // address, a port and sometimes the request headers.
    const message = "connect ECONNREFUSED 10.0.4.20:8000 — no route from pod ouroboros-rest-7f9";
    recordFailure(new TypeError(message, { cause: { code: "ECONNREFUSED" } }));

    const validation = await new OpenAiCompatibleAdapter().validate(VLLM_CONFIG, null);

    expect(validation.detail).not.toContain(message);
    expect(validation.detail).not.toContain("no route");
  });

  it("names the deadline when a call runs out of time", async () => {
    recordFailure(recordedTimeout());

    expect(await new OpenAiCompatibleAdapter().validate(VLLM_CONFIG, null)).toEqual({
      status: "failed",
      errorClass: "network",
      detail: `10.0.4.20:8000 timed out after ${OPENAI_COMPATIBLE_TIMEOUT_MS.toString()} ms`,
    });
  });

  it("falls back to a bare phrase when the runtime hangs no code on it", async () => {
    recordFailure(new TypeError("fetch failed"));

    expect(await new OpenAiCompatibleAdapter().validate(VLLM_CONFIG, null)).toEqual({
      status: "failed",
      errorClass: "network",
      detail: "10.0.4.20:8000 unreachable",
    });
  });

  it("reports a connection with no address as config, before opening anything", async () => {
    // Not `network`: a missing address is something the adapter knows about without a socket,
    // and reporting it as a closed one sends somebody to check a firewall.
    const spy = recordResponses(recordedListing());

    expect(await new OpenAiCompatibleAdapter().validate({}, OPENAI_COMPATIBLE_SECRET)).toEqual({
      status: "failed",
      errorClass: "config",
      detail: "Base URL required",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("never rejects, whatever the endpoint does", async () => {
    // The contract the conformance kit checks in general, asserted here against the two shapes
    // this adapter can meet that a hosted one cannot: a refused socket and an unparseable body.
    recordFailure(recordedTransportFailure("EHOSTUNREACH"));
    await expect(new OpenAiCompatibleAdapter().validate(VLLM_CONFIG, null)).resolves.toMatchObject({
      status: "failed",
    });

    recordResponses(recordedBody("<html>vLLM</html>", "text/html"));
    await expect(new OpenAiCompatibleAdapter().validate(VLLM_CONFIG, null)).resolves.toMatchObject({
      status: "ok",
    });
  });
});

describe("the optional key, end to end", () => {
  it("connects to a keyless endpoint", async () => {
    // AC.3's fourth acceptance criterion, from the outside: no credential anywhere, and the
    // card reads connected.
    recordResponses(recordedListing());

    expect(
      await new OpenAiCompatibleAdapter().validate({ [BASE_URL_FIELD]: GENERIC_BASE_URL }, null),
    ).toMatchObject({ status: "ok", detail: "200" });
  });

  it("discovers from a keyless endpoint", async () => {
    recordResponses(recordedListing(GENERIC_MODEL_ENTRIES));

    expect(
      await new OpenAiCompatibleAdapter().discoverModels(
        connection({ [BASE_URL_FIELD]: GENERIC_BASE_URL }, null),
      ),
    ).toEqual(GENERIC_EXPECTED_MODELS);
  });

  it("does not report a missing key as a missing field", () => {
    // `missingConfiguration` is derived from `required`, and the key is not in it.
    expect(missingConfiguration({ [BASE_URL_FIELD]: VLLM_BASE_URL }, null)).toEqual([]);
  });

  it("names the address the way a card foot has to print it", () => {
    expect(missingConfiguration({}, OPENAI_COMPATIBLE_SECRET)).toEqual(["Base URL"]);
  });
});

describe("discoverModels", () => {
  it("normalizes the recorded vLLM listing exactly as recorded", async () => {
    recordResponses(recordedListing(VLLM_MODEL_ENTRIES));

    expect(await new OpenAiCompatibleAdapter().discoverModels(connection())).toEqual(
      VLLM_EXPECTED_MODELS,
    );
  });

  it("normalizes the recorded generic listing exactly as recorded", async () => {
    // The capture that proves the adapter is not vLLM-specific. Every context length is null,
    // which is the assertion that a server saying nothing produces nothing.
    recordResponses(recordedListing(GENERIC_MODEL_ENTRIES));

    expect(
      await new OpenAiCompatibleAdapter().discoverModels(
        connection({ [BASE_URL_FIELD]: GENERIC_BASE_URL }),
      ),
    ).toEqual(GENERIC_EXPECTED_MODELS);
  });

  it("gives every chip the local/ prefix and leaves every id alone", async () => {
    // The one that makes mockup 07's chips, and the rule that keeps a price join working:
    // `model_prices.match_model` is written against the server's own spelling.
    recordResponses(recordedListing());

    const models = await new OpenAiCompatibleAdapter().discoverModels(connection());

    expect(models.map((model) => model.display)).toEqual([
      "local/llama-4-maverick",
      "local/deepseek-v3.2",
    ]);
    expect(models.map((model) => model.id)).toEqual(["llama-4-maverick", "deepseek-v3.2"]);
    expect(models.every((model) => !model.id.startsWith(LOCAL_DISPLAY_PREFIX))).toBe(true);
  });

  it("reports the same ids on every run, which is what makes the upsert an upsert", async () => {
    // AE.4 (#230) writes `insert … on conflict (provider_connection_id, model_id)`. Ids that
    // varied between runs would double a card's chips rather than update them.
    recordResponses(recordedListing(), recordedListing());
    const adapter = new OpenAiCompatibleAdapter();

    const first = await adapter.discoverModels(connection());
    const second = await adapter.discoverModels(connection());

    expect(second.map((model) => model.id)).toEqual(first.map((model) => model.id));
  });

  it("treats an empty listing as an answer rather than a failure", async () => {
    // A server started with no model loaded is a real state, and it is not an error.
    recordResponses(recordedListing([]));

    expect(await new OpenAiCompatibleAdapter().discoverModels(connection())).toEqual([]);
  });

  it("drops the entries a listing has no chip for", async () => {
    recordResponses(
      recordedListing([
        null,
        "a string",
        { object: "model" },
        { id: "" },
        { id: "   " },
        { id: 7 },
        { id: "phi-4", object: "model" },
      ]),
    );

    expect(await new OpenAiCompatibleAdapter().discoverModels(connection())).toEqual([
      { id: "phi-4", display: "local/phi-4", contextLength: null, sizeBytes: null, tier: null },
    ]);
  });

  it("keeps ids unique, because two identical chips cannot be told apart", async () => {
    recordResponses(
      recordedListing([{ id: "phi-4" }, { id: "phi-4", max_model_len: 16_384 }, { id: "qwen3" }]),
    );

    expect(
      (await new OpenAiCompatibleAdapter().discoverModels(connection())).map((m) => m.id),
    ).toEqual(["phi-4", "qwen3"]);
  });

  it("preserves the server's own order", async () => {
    recordResponses(recordedListing([{ id: "zeta" }, { id: "alpha" }, { id: "mu" }]));

    expect(
      (await new OpenAiCompatibleAdapter().discoverModels(connection())).map((m) => m.id),
    ).toEqual(["zeta", "alpha", "mu"]);
  });

  it("reports no tier at all, because this wire format carries no entitlement signal", async () => {
    // Decision P8. A default here would make Anthropic's earned pill unreadable too, because a
    // person would have no way to tell an invented one from a real one.
    recordResponses(recordedListing());

    const models = await new OpenAiCompatibleAdapter().discoverModels(connection());

    expect(models.every((model) => model.tier === null)).toBe(true);
  });

  it.each([
    [
      "a body that is not JSON",
      recordedBody("<html><body>vLLM</body></html>", "text/html"),
      "the model listing was not JSON",
    ],
    [
      "a body that is not an object",
      recordedBody('"a string"'),
      "the model listing was not an object",
    ],
    ["a null body", recordedBody("null"), "the model listing was not an object"],
    // An array is an object, so it falls through to the shape check rather than the type one.
    ["a bare array", recordedBody("[]"), "the model listing carried no data array"],
    [
      "an object with no data",
      recordedBody('{"object":"list"}'),
      "the model listing carried no data array",
    ],
    [
      "a data that is not an array",
      recordedBody('{"data":{}}'),
      "the model listing carried no data array",
    ],
  ])("reports %s as upstream", async (_case, response, detail) => {
    // `upstream` rather than `config`: the address already answered 200 to a models route, so
    // something is at the other end and it is misbehaving — not a field anybody can correct.
    recordResponses(response);

    await expect(new OpenAiCompatibleAdapter().discoverModels(connection())).rejects.toMatchObject({
      errorClass: "upstream",
      detail,
    });
  });

  it.each([
    [401, "auth"],
    [429, "rate_limit"],
    [503, "upstream"],
    [404, "config"],
  ] as const)(
    "throws a %s refusal as the %s class, carrying the status",
    async (status, errorClass) => {
      recordResponses(recordedRefusal(status));

      const thrown = await new OpenAiCompatibleAdapter()
        .discoverModels(connection())
        .catch((error: unknown) => error);

      expect(ProviderAdapterError.is(thrown)).toBe(true);
      expect(thrown).toMatchObject({ errorClass, httpStatus: status });
    },
  );

  it("throws a transport failure as network, with the host echoed", async () => {
    recordFailure();

    await expect(new OpenAiCompatibleAdapter().discoverModels(connection())).rejects.toMatchObject({
      errorClass: "network",
      detail: "10.0.4.20:8000 unreachable (ECONNREFUSED)",
    });
  });

  it("refuses a connection with no address without opening anything", async () => {
    const spy = recordResponses(recordedListing());

    await expect(
      new OpenAiCompatibleAdapter().discoverModels(connection({})),
    ).rejects.toMatchObject({ errorClass: "config", detail: "Base URL required" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("normalizeModel", () => {
  it.each([
    ["max_model_len", { id: "m", max_model_len: 131_072 }, 131_072],
    ["context_length", { id: "m", context_length: 32_768 }, 32_768],
    ["context_window", { id: "m", context_window: 8_192 }, 8_192],
    ["max_model_len ahead of the others", { id: "m", max_model_len: 4, context_length: 9 }, 4],
  ])("reads a context window from %s", (_case, entry, expected) => {
    expect(normalizeModel(entry)?.contextLength).toBe(expected);
  });

  it.each([
    ["nothing at all", { id: "m" }],
    ["a zero", { id: "m", max_model_len: 0 }],
    ["a fraction", { id: "m", max_model_len: 8_192.5 }],
    ["a string", { id: "m", max_model_len: "8192" }],
    ["a negative", { id: "m", context_length: -1 }],
    ["a NaN", { id: "m", context_length: Number.NaN }],
  ])("answers null for %s, because null means the server did not say", (_case, entry) => {
    expect(normalizeModel(entry)?.contextLength).toBeNull();
  });

  it("never reports a size, because a served model has no file", () => {
    expect(normalizeModel({ id: "m", size: 19_000_000_000 })?.sizeBytes).toBeNull();
  });

  it("trims an id rather than accepting one that is only whitespace", () => {
    expect(normalizeModel({ id: "  phi-4  " })?.id).toBe("phi-4");
    expect(normalizeModel({ id: "   " })).toBeNull();
  });
});

describe("localDisplay", () => {
  it("prefixes an ordinary id", () => {
    expect(localDisplay("llama-4-maverick")).toBe("local/llama-4-maverick");
  });

  it("leaves an id that already says so alone", () => {
    // A deployment whose served-model-name is literally `local/mistral` is somebody being
    // explicit, not somebody to correct into `local/local/mistral`.
    expect(localDisplay("local/mistral")).toBe("local/mistral");
  });

  it("keeps a namespaced id readable", () => {
    expect(localDisplay("meta-llama/Llama-4-Maverick")).toBe("local/meta-llama/Llama-4-Maverick");
  });
});

describe("the address policy cannot be routed around", () => {
  /** This adapter's own source, with its prose stripped. */
  const code = readFileSync(join(__dirname, "openai-compatible.adapter.ts"), "utf8").replaceAll(
    /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
    "",
  );

  it("makes every request through one init, so the redirect rule is on all of them", () => {
    // A `fetch` here that forgot `redirect: PROVIDER_REDIRECT` would follow a redirect out of
    // the address the policy checked — the whole rule undone in one omitted property. Asserted
    // against the source rather than against a call, because what has to stay true is that
    // there is no *other* call.
    expect(code.match(/fetch\(/g)).toHaveLength(2);
    expect(code.match(/fetch\(endpoint\.url, requestInit\(/g)).toHaveLength(2);
  });

  it("reads the configured address in exactly one place, and validates it there", () => {
    // `listingEndpoint` is the only reader of the address field, and it hands the value
    // straight to the policy. A second reader building a URL of its own would be the scheme
    // allow-list quietly skipped.
    expect(code.match(/config\[BASE_URL_FIELD\]/g)).toHaveLength(1);
    expect(code).toContain("resolveProviderAddress(config[BASE_URL_FIELD])");
  });

  it("never spells the redirect policy out, so it cannot disagree with the module", () => {
    expect(code).toContain("redirect: PROVIDER_REDIRECT");
    expect(code).not.toContain('redirect: "manual"');
  });
});

describe("the adapter's credential discipline", () => {
  /** This adapter's own source, with its prose stripped. */
  const code = readFileSync(join(__dirname, "openai-compatible.adapter.ts"), "utf8").replaceAll(
    /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
    "",
  );

  it("has no logger at all, which is the only durable version of never logged", () => {
    // A test that watched one call would pass for an adapter that logs on a branch nobody
    // arranged; what makes the claim stay true is that there is nothing in the file to log with.
    expect(code).not.toContain("Logger");
    expect(code).not.toContain("console.");
  });

  it("holds no credential between calls", () => {
    // One instance serves every workspace. A field holding a plaintext key would be one
    // workspace's credential visible to the next request that touched this object.
    const adapter = new OpenAiCompatibleAdapter();

    expect(Object.values(adapter)).not.toContain(OPENAI_COMPATIBLE_SECRET);
    expect(JSON.stringify(adapter)).not.toContain("sk-vllm");
  });

  it("never puts a refusal's body in a detail, even when the body quotes the key", async () => {
    // The sharpest case in the suite. The recorded 401 really contains the credential, the way
    // these servers really answer — so an adapter that read the body would leak it here.
    recordResponses(recordedRefusal(401));

    const validation = await new OpenAiCompatibleAdapter().validate(
      VLLM_CONFIG,
      OPENAI_COMPATIBLE_SECRET,
    );

    expect(validation.detail).toBe("key rejected (401)");
    expect(validation.detail).not.toContain(OPENAI_COMPATIBLE_SECRET);
    expect(validation.detail).not.toContain("Incorrect API key");
  });

  it("leaves no refusal body unread on the socket", async () => {
    const refusal = recordedRefusal(503);
    recordResponses(refusal);

    await new OpenAiCompatibleAdapter().validate(VLLM_CONFIG, null);

    expect(refusal.bodyUsed || refusal.body?.locked).toBeTruthy();
  });
});

/**
 * `paramSchema` — what a model behind an OpenAI-compatible endpoint can be tuned with
 * ([#585](https://github.com/NobuData/ouroboros/issues/585)).
 */
describe("the OpenAI-compatible param schema", () => {
  const adapter = new OpenAiCompatibleAdapter();

  it("offers the three every implementation of the wire format honours", () => {
    expect(Object.keys(adapter.paramSchema("llama-4-maverick").properties)).toEqual([
      "max_output",
      "context_clamp",
      "temperature",
    ]);
  });

  it("offers no thinking control, because this format cannot say which models reason", () => {
    // Some models served this way reason and some do not, and there is no field in the
    // protocol that says which. A control offered on every one of them would be a control that
    // silently does nothing on most — decision R3's option 2-A is exactly this refusal.
    expect(adapter.paramSchema("llama-4-maverick").properties.thinking).toBeUndefined();
  });

  it("allows the full temperature range this format publishes", () => {
    // Two, unlike Anthropic's one. The difference between two adapters' ceilings is the reason
    // a range belongs in an adapter rather than in a shared constant.
    expect(adapter.paramSchema("llama-4-maverick").properties.temperature.maximum).toBe(2);
  });

  it("answers the same schema for every model, because the deployment is what differs", () => {
    expect(adapter.paramSchema("llama-4-maverick")).toEqual(
      adapter.paramSchema("openai/gpt-oss-120b"),
    );
  });

  it("answers a schema in the dialect that the column can store", () => {
    expect(paramSchemaViolations(adapter.paramSchema("llama-4-maverick"))).toEqual([]);
    expect(storageViolations(adapter.paramSchema("llama-4-maverick"))).toEqual([]);
  });

  it("hands out a fresh value every call", () => {
    const first = adapter.paramSchema("llama-4-maverick") as { title: string };
    first.title = "tampered";

    expect(adapter.paramSchema("llama-4-maverick").title).toBe(
      "OpenAI-compatible model parameters",
    );
  });
});
