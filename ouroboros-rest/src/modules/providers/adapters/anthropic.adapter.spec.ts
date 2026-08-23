import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ANTHROPIC_DEFAULT_BASE_URL, ANTHROPIC_VERSION } from "../../provider-health/checks";
import { CARD_SHAPES } from "../card.shapes.fixture";
import { SECRET_ANNOTATION } from "../provider.config";
import { ProviderAdapterError } from "../provider.errors";
import { toFormFields } from "../provider.forms";
import type { ProviderConnectionContext } from "../provider.adapter";
import {
  ANTHROPIC_API_KEY_FIELD,
  ANTHROPIC_PAGE_LIMIT,
  ANTHROPIC_PAGE_SIZE,
  ANTHROPIC_TIMEOUT_MS,
  AnthropicAdapter,
  PRIORITY_TIER,
  missingConfiguration,
  normalizeModel,
  priorityTierOf,
} from "./anthropic.adapter";
import {
  ANTHROPIC_EXPECTED_MODELS,
  ANTHROPIC_EXPECTED_PRIORITY_MODELS,
  ANTHROPIC_MODEL_ENTRIES,
  ANTHROPIC_PRIORITY_HEADERS,
  ANTHROPIC_SECRET,
  ANTHROPIC_STANDARD_HEADERS,
  recordFailure,
  recordRepeatedly,
  recordResponses,
  recordedListing,
  recordedRefusal,
  recordedRequest,
  recordedTimeout,
  recordedTransportFailure,
} from "./anthropic.recordings.fixture";

/**
 * The Anthropic adapter, against recorded responses.
 *
 * `anthropic.conformance.spec.ts` runs the kit, which is the contract every adapter shares.
 * This suite is what is true about *this* one: that it draws mockup 07's card, that its error
 * mapping is the ticket's table rather than a plausible reading of it, that its latency is
 * measured, and — the criterion with the most room to go quietly wrong — that the
 * `priority tier` pill appears only on a real entitlement signal.
 *
 * Every case is arranged from `anthropic.recordings.fixture.ts`. Nothing opens a socket.
 */

/** A connection context, as AD.2 would hand one over. */
function connection(secret: string | null = ANTHROPIC_SECRET): ProviderConnectionContext {
  return { connectionId: "00000000-0000-4000-8000-000000000217", config: {}, secret };
}

/** Mockup 07's Anthropic card, from the fixture recorded before this adapter existed. */
const ANTHROPIC_CARD = CARD_SHAPES.find((shape) => shape.kind === "anthropic")!;

describe("the Anthropic adapter's config schema", () => {
  const adapter = new AnthropicAdapter();

  it("renders mockup 07's card — a masked key row and nothing else", () => {
    // `card.shapes.fixture.ts` asks each of AC.2–AC.5 to assert its real schema still renders
    // the card recorded there. That is what gives the fixture a job after AC.1 rather than
    // leaving it to rot as a copy of something that has moved on.
    expect(toFormFields(adapter.configSchema())).toEqual(ANTHROPIC_CARD.fields);
  });

  it("declares exactly one field, and it is the credential", () => {
    const schema = adapter.configSchema();

    expect(Object.keys(schema.properties)).toEqual([ANTHROPIC_API_KEY_FIELD]);
    expect(schema.properties[ANTHROPIC_API_KEY_FIELD][SECRET_ANNOTATION]).toBe(true);
    expect(schema.required).toEqual([ANTHROPIC_API_KEY_FIELD]);
  });

  it("declares no address field, because the endpoint is fixed", () => {
    // The issue is explicit: no base URL, and the capability line is where `api.anthropic.com`
    // is shown. A configurable address is AC.3's (#218), and it comes with an SSRF policy.
    expect(adapter.configSchema().properties.baseUrl).toBeUndefined();
  });

  it("hands out a fresh value the caller cannot mutate back in", () => {
    // AE.5 holds this while somebody fills in a form. The cast is the point of the case: the
    // interface is readonly, and what is being checked is what happens when something that is
    // not TypeScript writes to it anyway.
    const tampered = adapter.configSchema().properties[ANTHROPIC_API_KEY_FIELD] as {
      title: string;
    };
    tampered.title = "tampered";

    expect(adapter.configSchema().properties[ANTHROPIC_API_KEY_FIELD].title).toBe("API key");
    expect(adapter.configSchema()).toEqual(ANTHROPIC_CARD.schema);
  });
});

describe("the Anthropic adapter's capabilities", () => {
  it("discovers, does not pull, and does not promise entitlements in validate's detail", () => {
    // `entitlements` is a promise about `detail` — AC.1 names AC.5 (#220) as the adapter that
    // sets it. This card's tier signal travels the other road: per model, through discovery,
    // into `provider_models.meta.tier`.
    expect(new AnthropicAdapter().capabilities()).toEqual({
      discovery: true,
      pull: false,
      entitlements: false,
      invocation: false,
    });
  });

  it("keys on V015's anthropic kind", () => {
    expect(new AnthropicAdapter().kind).toBe("anthropic");
  });
});

describe("validate's request", () => {
  it("is a GET of one listing row, with no body", async () => {
    const spy = recordResponses(recordedListing());

    await new AnthropicAdapter().validate({}, ANTHROPIC_SECRET);

    const { url, init } = recordedRequest(spy);
    expect(url).toBe(`${ANTHROPIC_DEFAULT_BASE_URL}/v1/models?limit=1`);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("presents the credential and the API version", async () => {
    const spy = recordResponses(recordedListing());

    await new AnthropicAdapter().validate({}, ANTHROPIC_SECRET);

    expect(recordedRequest(spy).init.headers).toEqual({
      accept: "application/json",
      "x-api-key": ANTHROPIC_SECRET,
      "anthropic-version": ANTHROPIC_VERSION,
    });
  });

  it("carries a deadline, so a card cannot be held open by one slow vendor", async () => {
    const spy = recordResponses(recordedListing());

    await new AnthropicAdapter().validate({}, ANTHROPIC_SECRET);

    expect(recordedRequest(spy).init.signal).toBeInstanceOf(AbortSignal);
  });

  it("opens nothing at all when no credential was configured", async () => {
    const spy = recordResponses(recordedListing());

    const validation = await new AnthropicAdapter().validate({}, null);

    expect(validation).toEqual({
      status: "failed",
      errorClass: "config",
      detail: "API key required",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("treats a blank credential as no credential", async () => {
    // An untouched key row submits `""`, and `partitionSubmission` already turns that into
    // null. This is the belt for the braces: a connection sealing an empty string would look
    // configured and fail at first use.
    const spy = recordResponses(recordedListing());

    expect(await new AnthropicAdapter().validate({}, "")).toEqual({
      status: "failed",
      errorClass: "config",
      detail: "API key required",
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("validate's answer", () => {
  it("reads a success as the card foot's ✓ 200 · …ms", async () => {
    recordResponses(recordedListing());

    const validation = await new AnthropicAdapter().validate({}, ANTHROPIC_SECRET);

    expect(validation.status).toBe("ok");
    expect(validation).toMatchObject({ detail: "200" });
  });

  it("measures a real round trip rather than reporting a constant", async () => {
    // AC.2's fifth acceptance criterion. A provider held for 40ms must read as at least
    // roughly that; a fabricated or cached number could not. The floor is generous because a
    // loaded CI machine may add to the wait but cannot subtract from it.
    const held = 40;
    jest.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(recordedListing());
          }, held);
        }),
    );

    const validation = await new AnthropicAdapter().validate({}, ANTHROPIC_SECRET);

    expect(validation.status).toBe("ok");
    expect(validation.status === "ok" && validation.latencyMs).toBeGreaterThanOrEqual(held - 5);
  });

  it("measures each call separately, so nothing is cached between them", async () => {
    const adapter = new AnthropicAdapter();
    let held = 0;
    jest.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(recordedListing());
          }, held);
        }),
    );

    const quick = await adapter.validate({}, ANTHROPIC_SECRET);
    held = 60;
    const slow = await adapter.validate({}, ANTHROPIC_SECRET);

    expect(quick.status === "ok" && slow.status === "ok").toBe(true);
    if (quick.status === "ok" && slow.status === "ok") {
      expect(slow.latencyMs).toBeGreaterThan(quick.latencyMs);
    }
  });

  it.each([
    [401, "auth", "key rejected (401)"],
    [403, "auth", "key rejected (403)"],
    [429, "rate_limit", "rate limited (429)"],
    [500, "upstream", "500 upstream"],
    [503, "upstream", "503 upstream"],
    [529, "upstream", "529 upstream"],
    [408, "network", "timed out (408)"],
    [400, "config", "responded 400"],
    [404, "config", "responded 404"],
  ] as const)("maps %s onto the %s class", async (status, errorClass, detail) => {
    recordResponses(recordedRefusal(status));

    expect(await new AnthropicAdapter().validate({}, ANTHROPIC_SECRET)).toEqual({
      status: "failed",
      errorClass,
      detail,
    });
  });

  it("reads a refused socket as unreachable, saying nothing about the key", async () => {
    recordFailure(recordedTransportFailure());

    expect(await new AnthropicAdapter().validate({}, ANTHROPIC_SECRET)).toEqual({
      status: "failed",
      errorClass: "network",
      detail: "unreachable (ECONNREFUSED)",
    });
  });

  it("reads a deadline as a timeout that names the deadline", async () => {
    // An `AbortSignal.timeout` abort arrives as a `DOMException`, which Node does not make an
    // `instanceof Error`. A check written against `Error` would report every timed-out test
    // connection as a plain failure.
    recordFailure(recordedTimeout());

    expect(await new AnthropicAdapter().validate({}, ANTHROPIC_SECRET)).toEqual({
      status: "failed",
      errorClass: "network",
      detail: `timed out after ${ANTHROPIC_TIMEOUT_MS.toString()} ms`,
    });
  });

  it("never rejects, whatever the provider does", async () => {
    // The contract the card depends on: a provider being down is a state to draw, not an
    // exception to catch. Asserted over every arranged failure rather than a representative
    // one, because the branch that throws would be the one nobody wrote a case for.
    const adapter = new AnthropicAdapter();

    for (const status of [401, 429, 500, 404, 302]) {
      recordResponses(recordedRefusal(status));
      await expect(adapter.validate({}, ANTHROPIC_SECRET)).resolves.toMatchObject({
        status: "failed",
      });
    }

    recordFailure(recordedTransportFailure("ECONNRESET"));
    await expect(adapter.validate({}, ANTHROPIC_SECRET)).resolves.toMatchObject({
      status: "failed",
    });

    recordFailure("a string, because a runtime may throw anything");
    await expect(adapter.validate({}, ANTHROPIC_SECRET)).resolves.toEqual({
      status: "failed",
      errorClass: "network",
      detail: "unreachable",
    });
  });

  it("puts neither the credential nor the vendor's error body in what a card prints", async () => {
    // AC.2's third acceptance criterion. The recorded 401 body carries a request id and a
    // message naming the header, which is exactly what an adapter that echoed a provider's
    // error would leak.
    recordResponses(recordedRefusal(401));

    const validation = await new AnthropicAdapter().validate({}, ANTHROPIC_SECRET);

    expect(validation.detail).not.toContain(ANTHROPIC_SECRET);
    expect(validation.detail).not.toContain("invalid x-api-key");
    expect(validation.detail).not.toContain("req_011CQ");
  });

  it("gives a refusal's socket back unread", async () => {
    // An unread body keeps its connection checked out of undici's pool until the collector
    // gets to it — a slow leak of sockets against a vendor for every failed test connection.
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"error":"…"}'));
        controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });

    jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status: 401 }));

    await new AnthropicAdapter().validate({}, ANTHROPIC_SECRET);

    expect(cancelled).toBe(true);
  });
});

describe("discoverModels", () => {
  it("normalizes the card's four chips, ids unchanged", async () => {
    recordResponses(recordedListing());

    const models = await new AnthropicAdapter().discoverModels(connection());

    expect(models).toEqual(ANTHROPIC_EXPECTED_MODELS);
    expect(models.map((model) => model.id)).toEqual([
      "claude-fable-5",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5",
    ]);
  });

  it("answers the same ids every run, which is what makes the upsert an upsert", async () => {
    // AC.2's second acceptance criterion, as far as an adapter can carry it: `provider_models`
    // upserts on `(provider_connection_id, model_id)`, so a second discovery that spelled an
    // id differently would double every chip on the card.
    const adapter = new AnthropicAdapter();
    recordResponses(recordedListing());
    const first = await adapter.discoverModels(connection());
    recordResponses(recordedListing());
    const second = await adapter.discoverModels(connection());

    expect(second).toEqual(first);
  });

  it("asks for a full page and sends the connection id nowhere", async () => {
    const spy = recordResponses(recordedListing());

    await new AnthropicAdapter().discoverModels(connection());

    const { url, init } = recordedRequest(spy);
    expect(url).toBe(
      `${ANTHROPIC_DEFAULT_BASE_URL}/v1/models?limit=${ANTHROPIC_PAGE_SIZE.toString()}`,
    );
    expect(init.method).toBe("GET");
    // A workspace's internal identifier is not a provider's business, and a recorded fixture
    // is where sending one would show up.
    expect(url).not.toContain("000000000217");
  });

  it("falls back to the id when a model publishes no display name", async () => {
    recordResponses(
      recordedListing({ entries: [{ type: "model", id: "claude-opus-5", created_at: "x" }] }),
    );

    const [model] = await new AnthropicAdapter().discoverModels(connection());

    expect(model.display).toBe("claude-opus-5");
  });

  it("treats an empty catalog as an answer rather than a failure", async () => {
    recordResponses(recordedListing({ entries: [] }));

    await expect(new AnthropicAdapter().discoverModels(connection())).resolves.toEqual([]);
  });

  it("drops entries a chip could not be made from", async () => {
    // A provider is not a source of types: a null in the array, an entry with no id, and an id
    // that is not a string are all cases this has to survive rather than cases that cannot
    // happen.
    recordResponses(
      recordedListing({
        entries: [null, 7, { type: "model" }, { id: 42 }, { id: "  " }, ANTHROPIC_MODEL_ENTRIES[0]],
      }),
    );

    const models = await new AnthropicAdapter().discoverModels(connection());

    expect(models.map((model) => model.id)).toEqual(["claude-fable-5"]);
  });

  it("reads a context length only where one is published", async () => {
    // Anthropic's model object carries none today, which is why every recorded chip is null.
    // The field is read rather than assumed absent, so the day it appears a chip gains its
    // context length without a release here — and a zero or a fraction is still nothing.
    recordResponses(
      recordedListing({
        entries: [
          { id: "with-window", display_name: "With", context_window: 200_000 },
          { id: "zero-window", display_name: "Zero", context_window: 0 },
          { id: "silly-window", display_name: "Silly", context_window: 1.5 },
          { id: "no-window", display_name: "None" },
        ],
      }),
    );

    expect(
      (await new AnthropicAdapter().discoverModels(connection())).map(
        (model) => model.contextLength,
      ),
    ).toEqual([200_000, null, null, null]);
  });

  it("reports no on-disk size, because a hosted model has none", async () => {
    recordResponses(recordedListing());

    for (const model of await new AnthropicAdapter().discoverModels(connection())) {
      expect(model.sizeBytes).toBeNull();
    }
  });
});

describe("the priority tier signal", () => {
  it("reports the tier when the response really carried the allowance headers", async () => {
    recordResponses(recordedListing({ headers: ANTHROPIC_PRIORITY_HEADERS }));

    expect(await new AnthropicAdapter().discoverModels(connection())).toEqual(
      ANTHROPIC_EXPECTED_PRIORITY_MODELS,
    );
  });

  it("reports nothing when the response carried only the standard allowances", async () => {
    // Decision P8: the pill renders on a real signal and is simply absent otherwise. The
    // standard `anthropic-ratelimit-…` family is the near-miss a careless prefix match would
    // report as an entitlement.
    recordResponses(recordedListing({ headers: ANTHROPIC_STANDARD_HEADERS }));

    for (const model of await new AnthropicAdapter().discoverModels(connection())) {
      expect(model.tier).toBeNull();
    }
  });

  it("reports nothing when there are no headers at all", async () => {
    recordResponses(recordedListing({ headers: {} }));

    for (const model of await new AnthropicAdapter().discoverModels(connection())) {
      expect(model.tier).toBeNull();
    }
  });

  it.each([
    ["a positive allowance", { "anthropic-priority-input-tokens-limit": "500000" }, PRIORITY_TIER],
    ["a zero allowance", { "anthropic-priority-input-tokens-limit": "0" }, null],
    ["an unparseable allowance", { "anthropic-priority-input-tokens-limit": "n/a" }, null],
    ["an empty allowance", { "anthropic-priority-input-tokens-limit": "" }, null],
    ["a remaining, but no limit", { "anthropic-priority-input-tokens-remaining": "9" }, null],
    ["only the standard family", { "anthropic-ratelimit-requests-limit": "4000" }, null],
    ["a similar prefix", { "anthropic-priority": "yes" }, null],
  ])("reads %s as %s", (_case, headers, expected) => {
    expect(priorityTierOf(new Headers(headers))).toBe(expected);
  });

  it("is a fact about the credential, so every model in one answer agrees", () => {
    // The card draws one pill beside the chips rather than one per chip, and an entitlement is
    // a property of the organization the key belongs to.
    expect(normalizeModel({ id: "a" }, PRIORITY_TIER)).toMatchObject({ tier: PRIORITY_TIER });
    expect(normalizeModel({ id: "b" }, null)).toMatchObject({ tier: null });
  });
});

describe("discoverModels' pagination", () => {
  it("follows has_more and merges the pages", async () => {
    const spy = recordResponses(
      recordedListing({
        entries: ANTHROPIC_MODEL_ENTRIES.slice(0, 2),
        hasMore: true,
        lastId: "claude-opus-5",
      }),
      recordedListing({ entries: ANTHROPIC_MODEL_ENTRIES.slice(2) }),
    );

    const models = await new AnthropicAdapter().discoverModels(connection());

    expect(models).toEqual(ANTHROPIC_EXPECTED_MODELS);
    expect(recordedRequest(spy, 1).url).toContain("after_id=claude-opus-5");
  });

  it("stops when a page claims more but names no cursor", async () => {
    // A `has_more` with no `last_id` is a page this cannot ask for. Stopping with what was
    // found beats asking for page one again forever.
    recordResponses(recordedListing({ hasMore: true, lastId: null }));

    await expect(new AnthropicAdapter().discoverModels(connection())).resolves.toEqual(
      ANTHROPIC_EXPECTED_MODELS,
    );
  });

  it("does not repeat a model that appears on two pages", async () => {
    recordResponses(
      recordedListing({ hasMore: true, lastId: "claude-haiku-4-5" }),
      recordedListing({ entries: ANTHROPIC_MODEL_ENTRIES.slice(0, 1) }),
    );

    expect(await new AnthropicAdapter().discoverModels(connection())).toEqual(
      ANTHROPIC_EXPECTED_MODELS,
    );
  });

  it("refuses a listing that never ends, rather than looping", async () => {
    // Built fresh per request: a body may be read once, and what is under test is the loop
    // rather than a second read of the same object.
    const spy = recordRepeatedly(() => recordedListing({ hasMore: true, lastId: "cursor" }));

    await expect(new AnthropicAdapter().discoverModels(connection())).rejects.toThrow(
      `model listing did not end after ${ANTHROPIC_PAGE_LIMIT.toString()} pages`,
    );
    expect(spy).toHaveBeenCalledTimes(ANTHROPIC_PAGE_LIMIT);
  });
});

describe("discoverModels' failures", () => {
  it("throws the taxonomy rather than answering a short list", async () => {
    recordResponses(recordedRefusal(401));

    await expect(new AnthropicAdapter().discoverModels(connection())).rejects.toMatchObject({
      name: "ProviderAdapterError",
      errorClass: "auth",
      detail: "key rejected (401)",
      httpStatus: 401,
    });
  });

  it.each([
    [429, "rate_limit"],
    [529, "upstream"],
    [404, "config"],
  ] as const)("maps a %s onto %s", async (status, errorClass) => {
    recordResponses(recordedRefusal(status));

    await expect(new AnthropicAdapter().discoverModels(connection())).rejects.toMatchObject({
      errorClass,
    });
  });

  it("reports a refused socket as network", async () => {
    recordFailure(recordedTransportFailure());

    await expect(new AnthropicAdapter().discoverModels(connection())).rejects.toMatchObject({
      errorClass: "network",
      detail: "unreachable (ECONNREFUSED)",
    });
  });

  it("refuses a connection with no credential before opening anything", async () => {
    const spy = recordResponses(recordedListing());

    await expect(new AnthropicAdapter().discoverModels(connection(null))).rejects.toMatchObject({
      errorClass: "config",
      detail: "API key required",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ["a body that is not JSON", new Response("<html>maintenance</html>", { status: 200 })],
    ["a body that is not an object", Response.json(null, { status: 200 })],
    ["a body with no data array", Response.json({ models: [] }, { status: 200 })],
  ])("reports %s as upstream", async (_case, response) => {
    // `upstream` rather than `config`: the address is this adapter's own constant, so there is
    // no setting anybody could correct.
    recordResponses(response);

    await expect(new AnthropicAdapter().discoverModels(connection())).rejects.toMatchObject({
      errorClass: "upstream",
    });
  });

  it("puts neither the credential nor the vendor's error body in what it throws", async () => {
    recordResponses(recordedRefusal(401));

    await new AnthropicAdapter().discoverModels(connection()).catch((error: unknown) => {
      expect(ProviderAdapterError.is(error)).toBe(true);
      expect((error as ProviderAdapterError).detail).not.toContain(ANTHROPIC_SECRET);
      expect((error as Error).message).not.toContain(ANTHROPIC_SECRET);
      expect((error as ProviderAdapterError).detail).not.toContain("invalid x-api-key");
    });

    expect.hasAssertions();
  });
});

describe("missingConfiguration", () => {
  it("looks for the credential where it actually travels", () => {
    // The key is never in `config` — `partitionSubmission` routes it to the vault — so a
    // required-field check that looked for it there would report every good connection as
    // unconfigured.
    expect(missingConfiguration({}, ANTHROPIC_SECRET)).toEqual([]);
    expect(missingConfiguration({ apiKey: ANTHROPIC_SECRET }, null)).toEqual(["API key"]);
  });

  it("names the field the way a card foot has to print it", () => {
    expect(missingConfiguration({}, null)).toEqual(["API key"]);
  });
});

describe("the adapter's credential discipline", () => {
  /** This adapter's own source, with its prose stripped. */
  const code = readFileSync(join(__dirname, "anthropic.adapter.ts"), "utf8").replaceAll(
    /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
    "",
  );

  it("has no logger at all, which is the only durable version of never logged", () => {
    // AC.2's sixth acceptance criterion. A test that watched one call would pass for an adapter
    // that logs on a branch nobody arranged; what makes the claim stay true is that there is
    // nothing in the file to log with.
    expect(code).not.toContain("Logger");
    expect(code).not.toContain("console.");
  });

  it("holds no credential between calls", () => {
    // One instance serves every workspace. A field holding a plaintext key would be one
    // workspace's credential visible to the next request that touched this object.
    const adapter = new AnthropicAdapter();

    expect(Object.values(adapter)).not.toContain(ANTHROPIC_SECRET);
    expect(JSON.stringify(adapter)).not.toContain("sk-ant");
  });

  it("reads no response body it has not first classified", () => {
    // The one call that reads a body is the successful listing's. Every refusal is discarded,
    // which is asserted behaviourally above and pinned here as a property of the source: a
    // second `response.json()` appearing in this file is a review conversation.
    expect(code.match(/response\.json\(\)/g)).toHaveLength(1);
  });
});
