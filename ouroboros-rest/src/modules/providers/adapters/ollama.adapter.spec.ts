import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CARD_SHAPES } from "../card.shapes.fixture";
import type { ModelPullProgress, ProviderConnectionContext } from "../provider.adapter";
import { supportsPull } from "../provider.adapter";
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
import { secretFieldName, toFormFields } from "../provider.forms";
import {
  recordFailure,
  recordResponses,
  recordedRequest,
  recordedTimeout,
  recordedTransportFailure,
} from "./http.recordings.fixture";
import {
  OLLAMA_API_SEGMENT,
  OLLAMA_HOST_TITLE,
  OLLAMA_PULL_MAX_LINE_CHARS,
  OLLAMA_PULL_PATH,
  OLLAMA_STATUS_MAX_LENGTH,
  OLLAMA_TAGS_PATH,
  OLLAMA_TIMEOUT_MS,
  OLLAMA_VERSION_PATH,
  OllamaAdapter,
  daemonUrl,
  missingConfiguration,
  normalizeModel,
  normalizeProgress,
  readPullStream,
  sanitizeStatus,
} from "./ollama.adapter";
import {
  OLLAMA_CAPABILITY_NOTE,
  OLLAMA_EXPECTED_MODELS,
  OLLAMA_HOST,
  OLLAMA_PULLED_MODEL,
  OLLAMA_PULL_LINES,
  OLLAMA_PULL_URL,
  OLLAMA_REDIRECT_TARGET,
  OLLAMA_RESUMED_PULL_LINES,
  OLLAMA_TAGS_URL,
  OLLAMA_TAG_ENTRIES,
  OLLAMA_VERSION_URL,
  recordedBody,
  recordedNdjson,
  recordedPull,
  recordedRedirect,
  recordedRefusal,
  recordedSilentPull,
  recordedTags,
  recordedVersion,
} from "./ollama.recordings.fixture";

/**
 * The Ollama adapter, against recorded responses.
 *
 * `ollama.conformance.spec.ts` runs the kit — twice, once per recorded pull — which is the
 * contract every adapter shares. This suite is what is true about *this* one:
 *
 *   * that it draws mockup 07's `OL` card, **with no key row anywhere on it**,
 *   * that `/api/tags`' sizes reach a card unchanged, in bytes, which is the one field no cloud
 *     adapter can fill in,
 *   * that a **stopped daemon** produces the designed `network` state rather than a hung request,
 *   * that it enforces AC.3's address policy rather than describing it,
 *   * and — the half with the most room to go quietly wrong — that its **pull stream** survives
 *     the things a line-delimited protocol over TCP actually does: an object split across two
 *     reads, a multi-byte character split across two reads, a body with no trailing newline, a
 *     failure announced mid-transfer, and a daemon that simply stops talking.
 *
 * Every case is arranged from `ollama.recordings.fixture.ts`. Nothing opens a socket.
 */

/** Mockup 07's Ollama card, from the fixture recorded before this adapter existed. */
const OLLAMA_CARD = CARD_SHAPES.find((shape) => shape.kind === "ollama")!;

/** The stored settings the recorded daemon is reached with. */
const OLLAMA_CONFIG = {
  [BASE_URL_FIELD]: OLLAMA_HOST,
  [CAPABILITY_NOTE_FIELD]: OLLAMA_CAPABILITY_NOTE,
};

/**
 * A connection context, as AD.2 would hand one over.
 *
 * @param config - The stored settings. Defaults to the recorded daemon's.
 * @returns The context. `secret` is always null — this adapter's schema declares no credential,
 *   so there is never one to open.
 */
function connection(config: Record<string, string> = OLLAMA_CONFIG): ProviderConnectionContext {
  return { connectionId: "00000000-0000-4000-8000-000000000219", config, secret: null };
}

/**
 * Everything an async iterable produced.
 *
 * @param events - The stream.
 * @returns The events, in order.
 */
async function collect(events: AsyncIterable<ModelPullProgress>): Promise<ModelPullProgress[]> {
  const collected: ModelPullProgress[] = [];

  for await (const event of events) {
    collected.push(event);
  }

  return collected;
}

describe("the Ollama adapter's config schema", () => {
  const adapter = new OllamaAdapter();

  it("renders mockup 07's card — a Host field and no key row", () => {
    // `card.shapes.fixture.ts` asks each of AC.2–AC.5 to assert its real schema still renders the
    // card recorded there. The recorded shape is the *minimum*, which is what lets an adapter add
    // a field the fixture predates — so the recorded row is checked exactly, and the note beside
    // it rather than instead of it.
    const fields = toFormFields(adapter.configSchema());

    expect(fields.slice(0, OLLAMA_CARD.fields.length)).toEqual(OLLAMA_CARD.fields);
  });

  it("labels the address Host, which is the whole reserved-name argument in one line", () => {
    // The same `baseUrl` property the vLLM card collects, under a different title. If the two
    // adapters had each named the field after their own vendor's word, a card would need to know
    // which vendor it was rendering in order to find the address.
    const vllm = CARD_SHAPES.find((shape) => shape.kind === "openai_compatible")!;

    expect(adapter.configSchema().properties[BASE_URL_FIELD].title).toBe(OLLAMA_HOST_TITLE);
    expect(vllm.schema.properties[BASE_URL_FIELD].title).toBe("Base URL");
    expect(OLLAMA_HOST_TITLE).not.toBe("Base URL");
  });

  it("declares the host and the capability note, in that order", () => {
    const schema = adapter.configSchema();

    expect(Object.keys(schema.properties)).toEqual([BASE_URL_FIELD, CAPABILITY_NOTE_FIELD]);
    expect(schema.required).toEqual([BASE_URL_FIELD]);
  });

  it("marks no field as a credential at all", () => {
    // AC.4's sixth acceptance criterion. Not *an optional key row* — none: a local daemon needs no
    // credential, and a blank field somebody has to leave blank is a question the product should
    // not be asking.
    const schema = adapter.configSchema();

    expect(secretFieldName(schema)).toBeNull();
    expect(
      Object.values(schema.properties).some((field) => field[SECRET_ANNOTATION] === true),
    ).toBe(false);
    expect(toFormFields(schema).every((field) => field.widget !== "secret")).toBe(true);
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
    // interface is readonly, and what is checked is what happens when something that is not
    // TypeScript writes to it anyway.
    const tampered = adapter.configSchema().properties[BASE_URL_FIELD] as { title: string };
    tampered.title = "tampered";

    expect(adapter.configSchema().properties[BASE_URL_FIELD].title).toBe(OLLAMA_HOST_TITLE);
  });
});

describe("the Ollama adapter's capabilities", () => {
  it("is the one adapter that pulls", () => {
    expect(new OllamaAdapter().capabilities()).toEqual({
      discovery: true,
      pull: true,
      entitlements: false,
      invocation: false,
    });
  });

  it("keys on V015's ollama kind", () => {
    expect(new OllamaAdapter().kind).toBe("ollama");
  });

  it("opens the capability gate that `supportsPull` narrows on", () => {
    // AC.1's fifth acceptance criterion from the other side: until this adapter, nothing that
    // ships answered `true`, so nothing that ships could reach `pullModel` at all.
    const adapter = new OllamaAdapter();

    expect(supportsPull(adapter)).toBe(true);
    expect(supportsPull(adapter) && typeof adapter.pullModel).toBe("function");
  });
});

describe("where a daemon's routes are looked for", () => {
  it.each([
    // Mockup 07's own field: a bare host, which is how Ollama itself spells OLLAMA_HOST.
    [OLLAMA_HOST, OLLAMA_TAGS_URL],
    // Trailing slashes are the commonest paste artefact, and a double slash is answered by some
    // servers and refused by others.
    ["http://ken-station.local:11434/", OLLAMA_TAGS_URL],
    ["http://ken-station.local:11434///", OLLAMA_TAGS_URL],
    // Somebody who pasted the API root they saw in a README, rather than the host.
    ["http://ken-station.local:11434/api", OLLAMA_TAGS_URL],
    ["http://ken-station.local:11434/api/", OLLAMA_TAGS_URL],
    // A daemon behind a reverse proxy under a prefix. The prefix is *kept* — "correcting" it
    // would break the deployment the address policy exists to support.
    ["https://gpu.internal/ollama", "https://gpu.internal/ollama/api/tags"],
    // A path that merely ends in the letters `api` is not the segment.
    ["https://gpu.internal/myapi", "https://gpu.internal/myapi/api/tags"],
    // A query string is not part of an API root, and carrying one through would send an
    // operator's stray `?` to a stranger's server.
    ["http://ken-station.local:11434?debug=1", OLLAMA_TAGS_URL],
    ["http://ken-station.local:11434#models", OLLAMA_TAGS_URL],
    // https keeps its implicit port off the URL, the way a browser writes it.
    ["https://ollama.example.com", "https://ollama.example.com/api/tags"],
  ])("joins %s onto %s", (host, expected) => {
    // Through `resolveProviderAddress`, because that is the only way an adapter ever gets a root
    // — a test that hand-built one would not be exercising the join the adapter makes.
    const address = resolveProviderAddress(host);

    expect(address.ok && daemonUrl(address.root, OLLAMA_TAGS_PATH)).toBe(expected);
  });

  it("joins all three routes the same way", () => {
    // One function for all three, so a fourth route added later cannot acquire its own idea of
    // where the daemon is.
    const address = resolveProviderAddress(`${OLLAMA_HOST}${OLLAMA_API_SEGMENT}/`);

    expect(address.ok && daemonUrl(address.root, OLLAMA_VERSION_PATH)).toBe(OLLAMA_VERSION_URL);
    expect(address.ok && daemonUrl(address.root, OLLAMA_TAGS_PATH)).toBe(OLLAMA_TAGS_URL);
    expect(address.ok && daemonUrl(address.root, OLLAMA_PULL_PATH)).toBe(OLLAMA_PULL_URL);
  });

  it("never doubles the api segment", async () => {
    const spy = recordResponses(recordedTags());

    await new OllamaAdapter().discoverModels(
      connection({ [BASE_URL_FIELD]: `${OLLAMA_HOST}${OLLAMA_API_SEGMENT}` }),
    );

    expect(recordedRequest(spy).url).toBe(OLLAMA_TAGS_URL);
    expect(recordedRequest(spy).url).not.toContain("/api/api");
  });
});

describe("the request a daemon sees", () => {
  it("asks /api/version to test the connection, and reads no body", async () => {
    // A version ping rather than a listing, which is what makes the mockup's `✓ 200 · 4ms`
    // honest: a listing walks a manifest directory and reports a latency that grows with how many
    // models somebody has.
    const spy = recordResponses(recordedVersion());

    await new OllamaAdapter().validate(OLLAMA_CONFIG, null);

    const { url, init } = recordedRequest(spy);
    expect(url).toBe(OLLAMA_VERSION_URL);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("asks /api/tags to discover", async () => {
    const spy = recordResponses(recordedTags());

    await new OllamaAdapter().discoverModels(connection());

    expect(recordedRequest(spy).url).toBe(OLLAMA_TAGS_URL);
    expect(recordedRequest(spy).init.method).toBe("GET");
  });

  it("posts the model name and asks for a stream", async () => {
    const spy = recordResponses(recordedPull());

    await collect(new OllamaAdapter().pullModel(connection(), OLLAMA_PULLED_MODEL));

    const { url, init } = recordedRequest(spy);
    expect(url).toBe(OLLAMA_PULL_URL);
    expect(init.method).toBe("POST");
    // `stream: true` is Ollama's default and is stated anyway: a daemon configured otherwise
    // would answer one object at the end, which is a progress bar that only ever reads 100%.
    // The body is a `BodyInit`, which is eight things — narrowed here rather than stringified,
    // because `String(a Blob)` is `[object Object]` and would make this pass for the wrong reason.
    expect(typeof init.body).toBe("string");
    expect(JSON.parse(init.body as string)).toEqual({
      model: OLLAMA_PULLED_MODEL,
      stream: true,
    });
  });

  it("sends no Authorization header on any call, because there is no credential", async () => {
    // The card's whole point. An empty bearer would make a proxy answer 401 and render *key
    // rejected* on a card with no key row to fix.
    const version = recordResponses(recordedVersion());
    await new OllamaAdapter().validate(OLLAMA_CONFIG, null);
    expect(recordedRequest(version).init.headers).toEqual({ accept: "application/json" });

    const tags = recordResponses(recordedTags());
    await new OllamaAdapter().discoverModels(connection());
    expect(recordedRequest(tags).init.headers).toEqual({ accept: "application/json" });

    const pull = recordResponses(recordedPull());
    await collect(new OllamaAdapter().pullModel(connection(), OLLAMA_PULLED_MODEL));
    expect(recordedRequest(pull).init.headers).toEqual({
      accept: "application/x-ndjson",
      "content-type": "application/json",
    });
  });

  it("carries a ten-second deadline on the two calls somebody is watching", async () => {
    const version = recordResponses(recordedVersion());
    await new OllamaAdapter().validate(OLLAMA_CONFIG, null);
    expect(recordedRequest(version).init.signal).toBeInstanceOf(AbortSignal);

    const tags = recordResponses(recordedTags());
    await new OllamaAdapter().discoverModels(connection());
    expect(recordedRequest(tags).init.signal).toBeInstanceOf(AbortSignal);

    expect(OLLAMA_TIMEOUT_MS).toBe(10_000);
  });

  it("gives a pull a controller instead, because a transfer is bounded by silence", async () => {
    // A total deadline is the wrong instrument for something that is *supposed* to take twenty
    // minutes. What the signal here is for is closing the socket when the consumer stops.
    const spy = recordResponses(recordedPull());

    await collect(new OllamaAdapter().pullModel(connection(), OLLAMA_PULLED_MODEL));

    const signal = recordedRequest(spy).init.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    // `AbortSignal.timeout` is already firing when a request is made; a controller's is not, and
    // stays not for as long as the transfer lasts.
    expect(signal?.aborted).toBe(true);
  });

  it("refuses to follow a redirect, on every call it makes", async () => {
    // Rule 2 of the address policy, asserted on the request rather than only on the outcome: a
    // `fetch` here that forgot the property would follow a redirect out of the address the policy
    // checked, which is the whole rule undone in one omitted line.
    const version = recordResponses(recordedVersion());
    await new OllamaAdapter().validate(OLLAMA_CONFIG, null);
    expect(recordedRequest(version).init.redirect).toBe(PROVIDER_REDIRECT);

    const tags = recordResponses(recordedTags());
    await new OllamaAdapter().discoverModels(connection());
    expect(recordedRequest(tags).init.redirect).toBe("manual");

    const pull = recordResponses(recordedPull());
    await collect(new OllamaAdapter().pullModel(connection(), OLLAMA_PULLED_MODEL));
    expect(recordedRequest(pull).init.redirect).toBe("manual");
  });
});

describe("the SSRF policy, shared with AC.3", () => {
  it.each([
    ["file:///etc/passwd", 'the address scheme "file:" is not http or https'],
    ["gopher://ken-station.local:70/", 'the address scheme "gopher:" is not http or https'],
    // A host typed with no scheme in front of it — the commonest mistake there is, and the one an
    // Ollama user is most likely to make because `OLLAMA_HOST` is often written that way. The two
    // spellings fail differently and both messages are diagnoses: a name parses as a URL whose
    // "scheme" is the name, and an address starting with a digit does not parse at all.
    ["ken-station.local:11434", 'the address scheme "ken-station.local:" is not http or https'],
    ["127.0.0.1:11434", "the address is not a URL"],
  ])("refuses %s without opening a socket", async (host, detail) => {
    const spy = recordResponses(recordedVersion());

    expect(await new OllamaAdapter().validate({ [BASE_URL_FIELD]: host }, null)).toEqual({
      status: "failed",
      errorClass: "config",
      detail,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses an address carrying a credential", async () => {
    const spy = recordResponses(recordedVersion());

    expect(
      await new OllamaAdapter().validate(
        { [BASE_URL_FIELD]: "http://user:hunter2@ken-station.local:11434" },
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
    ["http://127.0.0.1:11434", "loopback — Ollama's own default"],
    ["http://localhost:11434", "loopback by name"],
    ["http://10.0.4.20:11434", "RFC-1918"],
    ["http://192.168.1.50:11434", "RFC-1918"],
    ["http://ken-station.local:11434", "a private name — the mockup's own field"],
  ])("accepts %s — %s is the use case, not the attack", async (host) => {
    // The deliberate allow, asserted rather than assumed. An adapter that quietly acquired a
    // private-range check would fail here, which is the only place that regression is visible
    // before somebody's own workstation stops connecting.
    recordResponses(recordedVersion());

    expect(await new OllamaAdapter().validate({ [BASE_URL_FIELD]: host }, null)).toMatchObject({
      status: "ok",
      detail: "200",
    });
  });

  it.each([301, 302, 303, 307, 308])(
    "does not follow a %s, and classifies it as the connection's settings",
    async (status) => {
      const spy = recordResponses(recordedRedirect(status));

      expect(await new OllamaAdapter().validate(OLLAMA_CONFIG, null)).toEqual({
        status: "failed",
        errorClass: "config",
        detail: `redirect not followed (${status.toString()})`,
      });

      // The whole rule, in two assertions: exactly one request was made, and it was not the
      // metadata service the redirect pointed at.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(recordedRequest(spy).url).toBe(OLLAMA_VERSION_URL);
    },
  );

  it("never prints where a redirect was trying to send it", async () => {
    recordResponses(recordedRedirect());

    const validation = await new OllamaAdapter().validate(OLLAMA_CONFIG, null);

    expect(validation.detail).not.toContain(OLLAMA_REDIRECT_TARGET);
    expect(validation.detail).not.toContain("169.254");
  });

  it("does not follow a redirect during discovery or a pull either", async () => {
    const discovering = recordResponses(recordedRedirect());
    await expect(new OllamaAdapter().discoverModels(connection())).rejects.toMatchObject({
      errorClass: "config",
      detail: "redirect not followed (302)",
      httpStatus: 302,
    });
    expect(discovering).toHaveBeenCalledTimes(1);

    const pulling = recordResponses(recordedRedirect());
    await expect(
      collect(new OllamaAdapter().pullModel(connection(), OLLAMA_PULLED_MODEL)),
    ).rejects.toMatchObject({ errorClass: "config", detail: "redirect not followed (302)" });
    expect(pulling).toHaveBeenCalledTimes(1);
  });

  it("refuses a listing that floods, declared or not", async () => {
    recordResponses(
      new Response('{"models":[]}', {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": (PROVIDER_MAX_RESPONSE_BYTES + 1).toString(),
        },
      }),
    );

    await expect(new OllamaAdapter().discoverModels(connection())).rejects.toMatchObject({
      errorClass: "upstream",
      detail: `the response exceeded ${PROVIDER_MAX_RESPONSE_BYTES.toString()} bytes`,
    });
  });
});

describe("validate", () => {
  it("answers the card foot's ✓ 200 · 4ms", async () => {
    recordResponses(recordedVersion());

    const validation = await new OllamaAdapter().validate(OLLAMA_CONFIG, null);

    expect(validation.status).toBe("ok");
    expect(validation.detail).toBe("200");
    expect(validation.status === "ok" && Number.isInteger(validation.latencyMs)).toBe(true);
  });

  it("measures the round trip rather than reporting a constant", async () => {
    const held = 40;
    jest.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(recordedVersion());
          }, held);
        }),
    );

    const validation = await new OllamaAdapter().validate(OLLAMA_CONFIG, null);

    expect(validation.status === "ok" && validation.latencyMs).toBeGreaterThanOrEqual(held - 5);
  });

  it("leaves the version body unread, because a build number is not a card's business", async () => {
    const version = recordedVersion();
    recordResponses(version);

    await new OllamaAdapter().validate(OLLAMA_CONFIG, null);

    expect(version.bodyUsed || version.body?.locked).toBeTruthy();
  });

  it.each([
    [401, "auth", "key rejected (401)"],
    [403, "auth", "key rejected (403)"],
    [429, "rate_limit", "rate limited (429)"],
    [500, "upstream", "500 upstream"],
    [503, "upstream", "503 upstream"],
    [408, "network", "timed out (408)"],
    [404, "config", "responded 404"],
  ] as const)("maps %s onto the %s class", async (status, errorClass, detail) => {
    // The shared taxonomy rather than a second reading of it: `classifyHttpStatus` and
    // `describeHttpRefusal` are AC.1's, and this adapter forks neither.
    recordResponses(recordedRefusal(status));

    expect(await new OllamaAdapter().validate(OLLAMA_CONFIG, null)).toEqual({
      status: "failed",
      errorClass,
      detail,
    });
  });

  it("reports a stopped daemon as network, with the host echoed", async () => {
    // AC.4's eighth acceptance criterion: *a stopped Ollama produces the designed network state
    // rather than a hung request.* The host matters because an operator may run several.
    recordFailure();

    expect(await new OllamaAdapter().validate(OLLAMA_CONFIG, null)).toEqual({
      status: "failed",
      errorClass: "network",
      detail: "ken-station.local:11434 unreachable (ECONNREFUSED)",
    });
  });

  it("surfaces no raw socket error, only a symbolic code", async () => {
    const message =
      "connect ECONNREFUSED 192.168.1.42:11434 — no route from pod ouroboros-rest-7f9";
    recordFailure(new TypeError(message, { cause: { code: "ECONNREFUSED" } }));

    const validation = await new OllamaAdapter().validate(OLLAMA_CONFIG, null);

    expect(validation.detail).not.toContain(message);
    expect(validation.detail).not.toContain("no route");
  });

  it("names the deadline when a call runs out of time", async () => {
    recordFailure(recordedTimeout());

    expect(await new OllamaAdapter().validate(OLLAMA_CONFIG, null)).toEqual({
      status: "failed",
      errorClass: "network",
      detail: `ken-station.local:11434 timed out after ${OLLAMA_TIMEOUT_MS.toString()} ms`,
    });
  });

  it("reports a connection with no host as config, before opening anything", async () => {
    const spy = recordResponses(recordedVersion());

    expect(await new OllamaAdapter().validate({}, null)).toEqual({
      status: "failed",
      errorClass: "config",
      detail: "Host required",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("names the address the way a card foot has to print it", () => {
    // `Host required`, not `baseUrl required` — a field name leaking into a page.
    expect(missingConfiguration({})).toEqual([OLLAMA_HOST_TITLE]);
    expect(missingConfiguration(OLLAMA_CONFIG)).toEqual([]);
  });

  it("ignores a credential it is handed, rather than sending one", async () => {
    // Nothing should pass one — the schema declares none — but AD.2 handing a stray value over
    // must not turn into an `Authorization` header on somebody's own machine.
    const spy = recordResponses(recordedVersion());

    await new OllamaAdapter().validate(OLLAMA_CONFIG, "sk-not-a-thing-here");

    expect(recordedRequest(spy).init.headers).toEqual({ accept: "application/json" });
  });

  it("never rejects, whatever the host does", async () => {
    recordFailure(recordedTransportFailure("EHOSTUNREACH"));
    await expect(new OllamaAdapter().validate(OLLAMA_CONFIG, null)).resolves.toMatchObject({
      status: "failed",
    });

    recordResponses(recordedBody("<html>router login</html>", "text/html"));
    await expect(new OllamaAdapter().validate(OLLAMA_CONFIG, null)).resolves.toMatchObject({
      status: "ok",
    });
  });
});

describe("discoverModels", () => {
  it("normalizes the recorded listing exactly as recorded", async () => {
    recordResponses(recordedTags());

    expect(await new OllamaAdapter().discoverModels(connection())).toEqual(OLLAMA_EXPECTED_MODELS);
  });

  it("reports the sizes /api/tags reported, in bytes and unchanged", async () => {
    // AC.4's fifth acceptance criterion. The mockup's `19 GB`, `63 GB` and `9.1 GB` are these
    // numbers formatted, and the formatting is AE.4's — a number is a fact and a unit is a
    // rendering decision.
    recordResponses(recordedTags());

    const models = await new OllamaAdapter().discoverModels(connection());
    const recorded = OLLAMA_TAG_ENTRIES.map((entry) => (entry as { size: number }).size);

    expect(models.map((model) => model.sizeBytes)).toEqual(recorded);
  });

  it("prints the tag itself, with no prefix added", async () => {
    // Unlike AC.3's `local/` chips: an Ollama tag already says what it is, and the mockup's
    // pull-list draws `qwen3-coder:32b` in mono with nothing in front of it.
    recordResponses(recordedTags());

    const models = await new OllamaAdapter().discoverModels(connection());

    expect(models.map((model) => model.display)).toEqual([
      "qwen3-coder:32b",
      "llama4:scout",
      "phi4:14b",
    ]);
    expect(models.every((model) => model.display === model.id)).toBe(true);
  });

  it("reports no tier and no context length, because /api/tags publishes neither", async () => {
    // Decision P8. A plausible default here would make Anthropic's earned pill unreadable too.
    recordResponses(recordedTags());

    const models = await new OllamaAdapter().discoverModels(connection());

    expect(models.every((model) => model.tier === null)).toBe(true);
    expect(models.every((model) => model.contextLength === null)).toBe(true);
  });

  it("reports the same ids on every run, which is what makes the upsert an upsert", async () => {
    recordResponses(recordedTags(), recordedTags());
    const adapter = new OllamaAdapter();

    const first = await adapter.discoverModels(connection());
    const second = await adapter.discoverModels(connection());

    expect(second.map((model) => model.id)).toEqual(first.map((model) => model.id));
  });

  it("treats a freshly installed daemon's empty list as an answer", async () => {
    // A daemon that has pulled nothing is a real state, and it is the one this adapter's own
    // `pullModel` exists to change.
    recordResponses(recordedTags([]));

    expect(await new OllamaAdapter().discoverModels(connection())).toEqual([]);
  });

  it("drops the entries a pull-list has no row for", async () => {
    recordResponses(
      recordedTags([
        null,
        "a string",
        { size: 12 },
        { name: "" },
        { name: "   " },
        { name: 7 },
        // The newer key, read when the older one is absent.
        { model: "gemma3:27b", size: 17_400_000_000 },
        { name: "phi4:14b", size: 9_053_116_800 },
      ]),
    );

    expect(await new OllamaAdapter().discoverModels(connection())).toEqual([
      {
        id: "gemma3:27b",
        display: "gemma3:27b",
        contextLength: null,
        tier: null,
        sizeBytes: 17_400_000_000,
      },
      {
        id: "phi4:14b",
        display: "phi4:14b",
        contextLength: null,
        tier: null,
        sizeBytes: 9_053_116_800,
      },
    ]);
  });

  it("keeps ids unique, because two identical rows cannot be told apart", async () => {
    // Two rows with the same tag become two **Pull latest** buttons a person cannot choose
    // between, and an alias resolving against the catalog then has two candidates.
    recordResponses(
      recordedTags([
        { name: "phi4:14b", size: 9_053_116_800 },
        { name: "phi4:14b", size: 1 },
        { name: "gemma3:27b", size: 17_400_000_000 },
      ]),
    );

    expect((await new OllamaAdapter().discoverModels(connection())).map((m) => m.id)).toEqual([
      "phi4:14b",
      "gemma3:27b",
    ]);
  });

  it("preserves the daemon's own order", async () => {
    recordResponses(recordedTags([{ name: "zeta" }, { name: "alpha" }, { name: "mu" }]));

    expect((await new OllamaAdapter().discoverModels(connection())).map((m) => m.id)).toEqual([
      "zeta",
      "alpha",
      "mu",
    ]);
  });

  it.each([
    [
      "a body that is not JSON",
      recordedBody("<html><body>router</body></html>", "text/html"),
      "the model listing was not JSON",
    ],
    [
      "a body that is not an object",
      recordedBody('"a string"'),
      "the model listing was not an object",
    ],
    ["a null body", recordedBody("null"), "the model listing was not an object"],
    ["a bare array", recordedBody("[]"), "the model listing carried no models array"],
    // The commonest real cause: a Host field pointed at an OpenAI-compatible server, which
    // answers a listing under `data` rather than `models`.
    [
      "an OpenAI-shaped listing",
      recordedBody('{"object":"list","data":[]}'),
      "the model listing carried no models array",
    ],
    [
      "a models that is not an array",
      recordedBody('{"models":{}}'),
      "the model listing carried no models array",
    ],
  ])("reports %s as upstream", async (_case, response, detail) => {
    recordResponses(response);

    await expect(new OllamaAdapter().discoverModels(connection())).rejects.toMatchObject({
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

      const thrown = await new OllamaAdapter()
        .discoverModels(connection())
        .catch((error: unknown) => error);

      expect(ProviderAdapterError.is(thrown)).toBe(true);
      expect(thrown).toMatchObject({ errorClass, httpStatus: status });
    },
  );

  it("throws a stopped daemon as network, with the host echoed", async () => {
    recordFailure();

    await expect(new OllamaAdapter().discoverModels(connection())).rejects.toMatchObject({
      errorClass: "network",
      detail: "ken-station.local:11434 unreachable (ECONNREFUSED)",
    });
  });

  it("refuses a connection with no host without opening anything", async () => {
    const spy = recordResponses(recordedTags());

    await expect(new OllamaAdapter().discoverModels(connection({}))).rejects.toMatchObject({
      errorClass: "config",
      detail: "Host required",
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("pullModel", () => {
  it("streams the recorded cold pull from manifest to success", async () => {
    recordResponses(recordedPull());

    const events = await collect(new OllamaAdapter().pullModel(connection(), OLLAMA_PULLED_MODEL));

    expect(events[0]).toEqual({
      status: "pulling manifest",
      // Null rather than zero. The daemon does not know the size until it has the manifest, and
      // `0 of 0` is a claim about a transfer nothing has measured.
      completedBytes: null,
      totalBytes: null,
      done: false,
    });
    expect(events.at(-1)).toEqual({
      status: "success",
      completedBytes: null,
      totalBytes: null,
      done: true,
    });
    expect(events.filter((event) => event.done)).toHaveLength(1);
    expect(events.map((event) => event.status)).toEqual(
      OLLAMA_PULL_LINES.map((line) => (line as { status: string }).status),
    );
  });

  it("reports a resumed pull at the percentage the daemon starts it from", async () => {
    // The partial-then-resumed sequence AC.4 asks for by name. A `completedBytes` computed as
    // *bytes seen since we started* would read 0 on the first event here and then leap, which is
    // precisely the lie a progress bar exists not to tell.
    recordResponses(recordedPull(OLLAMA_RESUMED_PULL_LINES));

    const events = await collect(new OllamaAdapter().pullModel(connection(), OLLAMA_PULLED_MODEL));

    expect(events[0].completedBytes).toBe(38_412_152_474);
    expect(events[0].totalBytes).toBe(62_970_741_760);
    expect(events.at(-1)?.done).toBe(true);
  });

  it("reassembles an object split across two reads", async () => {
    // NDJSON is line-delimited and TCP is not. An adapter that assumed one read is one line would
    // pass a whole-body fixture and fail against a real daemon on its first slow layer.
    recordResponses(recordedPull(OLLAMA_PULL_LINES, { chunkBytes: 3 }));

    const events = await collect(new OllamaAdapter().pullModel(connection(), OLLAMA_PULLED_MODEL));

    expect(events).toHaveLength(OLLAMA_PULL_LINES.length);
    expect(events.at(-1)?.done).toBe(true);
  });

  it("reassembles a multi-byte character split across two reads", async () => {
    // `stream: true` on the decoder. Without it a status carrying a non-ASCII character — which a
    // localized daemon really sends — is replaced with U+FFFD wherever a chunk boundary lands.
    const line = JSON.stringify({ status: "téléchargement…" });
    recordResponses(recordedNdjson(`${line}\n{"status":"success"}\n`, 1));

    const events = await collect(new OllamaAdapter().pullModel(connection(), OLLAMA_PULLED_MODEL));

    expect(events[0].status).toBe("téléchargement…");
  });

  it("survives a stream whose last line has no newline after it", async () => {
    recordResponses(recordedPull(OLLAMA_PULL_LINES, { trailingNewline: false }));

    const events = await collect(new OllamaAdapter().pullModel(connection(), OLLAMA_PULLED_MODEL));

    expect(events.at(-1)).toMatchObject({ status: "success", done: true });
  });

  it("skips a line that says nothing this product renders", async () => {
    recordResponses(
      recordedNdjson('{"digest":"sha256:abc"}\n\n{"status":""}\n{"status":"success"}\n'),
    );

    const events = await collect(new OllamaAdapter().pullModel(connection(), OLLAMA_PULLED_MODEL));

    expect(events).toEqual([
      { status: "success", completedBytes: null, totalBytes: null, done: true },
    ]);
  });

  it("stops at the terminal event rather than reading past it", async () => {
    recordResponses(recordedNdjson('{"status":"success"}\n{"status":"pulling again"}\n'));

    const events = await collect(new OllamaAdapter().pullModel(connection(), OLLAMA_PULLED_MODEL));

    expect(events).toHaveLength(1);
    expect(events[0].done).toBe(true);
  });

  it("reports a failure announced mid-stream as upstream, without quoting it", async () => {
    // The daemon really does answer `200` and then report the failure in the body. The message it
    // sends is not carried through — see the adapter's header on why a `detail` never quotes a
    // body from an address a person typed.
    const secretish = "no space left on device: /var/lib/ollama/models/blobs";
    recordResponses(
      recordedNdjson(`{"status":"pulling manifest"}\n${JSON.stringify({ error: secretish })}\n`),
    );

    const thrown = await collect(
      new OllamaAdapter().pullModel(connection(), OLLAMA_PULLED_MODEL),
    ).catch((error: unknown) => error);

    expect(thrown).toMatchObject({
      errorClass: "upstream",
      detail: "the host reported the pull failed",
    });
    expect((thrown as Error).message).not.toContain(secretish);
  });

  it("reports a body that is not NDJSON as upstream", async () => {
    recordResponses(recordedNdjson("<html><body>who knows</body></html>\n"));

    await expect(
      collect(new OllamaAdapter().pullModel(connection(), OLLAMA_PULLED_MODEL)),
    ).rejects.toMatchObject({ errorClass: "upstream", detail: "the pull stream was not NDJSON" });
  });

  it.each([
    // The line that never terminates: no newline anywhere, so the buffer would grow forever.
    [
      "a line with no delimiter in it at all",
      `{"status":"${"x".repeat(OLLAMA_PULL_MAX_LINE_CHARS)}"}`,
    ],
    // The line that *does* terminate, and arrives complete in one read. Splitting first and
    // checking only the tail would hand this straight to `JSON.parse`.
    [
      "a complete over-long line",
      `{"status":"${"x".repeat(OLLAMA_PULL_MAX_LINE_CHARS)}"}\n{"status":"success"}\n`,
    ],
  ])("refuses %s", async (_case, body) => {
    // A `200` whose body is one endless line is how a stranger's endpoint would grow this buffer
    // until the process died. `PROVIDER_MAX_RESPONSE_BYTES` cannot bound a pull, because a pull is
    // unbounded by design — so what is bounded is a line.
    recordResponses(recordedNdjson(body));

    await expect(
      collect(new OllamaAdapter().pullModel(connection(), OLLAMA_PULLED_MODEL)),
    ).rejects.toMatchObject({
      errorClass: "upstream",
      detail: `a pull stream line exceeded ${OLLAMA_PULL_MAX_LINE_CHARS.toString()} characters`,
    });
  });

  it("does not mistake many short lines in one read for one long one", async () => {
    // A fast local transfer really does deliver several hundred progress lines in a single read,
    // and a cap applied to the whole buffer rather than to each line would refuse a daemon that
    // is working perfectly.
    const chatty = Array.from({ length: 800 }, (_unused, index) => ({
      status: `pulling c6a2f1e3287b ${index.toString()}`,
      total: 62_970_741_760,
      completed: index * 78_713_427,
    }));
    recordResponses(recordedPull([...chatty, { status: "success" }]));

    const events = await collect(new OllamaAdapter().pullModel(connection(), OLLAMA_PULLED_MODEL));

    expect(events).toHaveLength(chatty.length + 1);
    expect(events.at(-1)?.done).toBe(true);
  });

  it("reports a stream that stops without succeeding, rather than calling it done", async () => {
    // A daemon restarted half way through. Completion is a statement the stream makes, and a
    // consumer that inferred it from the iterator finishing would report a model as present that
    // is not there.
    recordResponses(recordedPull(OLLAMA_PULL_LINES.slice(0, 3)));

    await expect(
      collect(new OllamaAdapter().pullModel(connection(), OLLAMA_PULLED_MODEL)),
    ).rejects.toMatchObject({
      errorClass: "upstream",
      detail: "the pull ended before the host reported success",
    });
  });

  it.each([
    [404, "config"],
    [500, "upstream"],
    [429, "rate_limit"],
  ] as const)("throws a %s refusal to start as the %s class", async (status, errorClass) => {
    recordResponses(recordedRefusal(status));

    await expect(
      collect(new OllamaAdapter().pullModel(connection(), OLLAMA_PULLED_MODEL)),
    ).rejects.toMatchObject({ errorClass, httpStatus: status });
  });

  it("throws a stopped daemon as network", async () => {
    recordFailure();

    await expect(
      collect(new OllamaAdapter().pullModel(connection(), OLLAMA_PULLED_MODEL)),
    ).rejects.toMatchObject({
      errorClass: "network",
      detail: "ken-station.local:11434 unreachable (ECONNREFUSED)",
    });
  });

  it.each([["   "], [""]])("refuses a model named %p before opening anything", async (modelId) => {
    const spy = recordResponses(recordedPull());

    await expect(
      collect(new OllamaAdapter().pullModel(connection(), modelId)),
    ).rejects.toMatchObject({ errorClass: "config", detail: "no model named" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a connection with no host before opening anything", async () => {
    const spy = recordResponses(recordedPull());

    await expect(
      collect(new OllamaAdapter().pullModel(connection({}), OLLAMA_PULLED_MODEL)),
    ).rejects.toMatchObject({ errorClass: "config", detail: "Host required" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("closes the socket when a consumer stops reading", async () => {
    // How a pull is abandoned: `provider.pulls.ts` breaks out of its `for await`, which runs the
    // generator's `finally`, which cancels the body. Without it, a 63 GB transfer would keep
    // running with nobody reading it.
    let cancelled = false;
    const encoded = new TextEncoder().encode('{"status":"pulling manifest"}\n');
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoded);
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status: 200, headers: { "content-type": "application/x-ndjson" } },
    );
    recordResponses(response);

    for await (const event of new OllamaAdapter().pullModel(connection(), OLLAMA_PULLED_MODEL)) {
      expect(event.status).toBe("pulling manifest");

      break;
    }

    expect(cancelled).toBe(true);
  });
});

describe("readPullStream's stall deadline", () => {
  it("gives up on a daemon that stops reporting", async () => {
    // Exercised directly with a short deadline, because a suite that waited a real minute to see
    // this path is a suite nobody runs. What it stands for is a machine that went to sleep
    // mid-transfer: the socket is open, and nothing is ever coming.
    await expect(
      collect(
        readPullStream(recordedSilentPull(), { host: "ken-station.local:11434", stallMs: 20 }),
      ),
    ).rejects.toMatchObject({
      errorClass: "network",
      detail: "ken-station.local:11434 stopped reporting progress after 20 ms",
    });
  });

  it("does not give up on a daemon that is slow but talking", async () => {
    // The distinction the whole design turns on. This stream takes four times the deadline in
    // total and never goes quiet for more than a fraction of it.
    const lines = ['{"status":"pulling manifest"}\n', '{"status":"success"}\n'];
    let index = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (index >= lines.length) {
            controller.close();

            return;
          }

          const line = lines[index++];

          await new Promise((resolve) => setTimeout(resolve, 15));
          controller.enqueue(new TextEncoder().encode(line));
        },
      }),
      { status: 200, headers: { "content-type": "application/x-ndjson" } },
    );

    const events = await collect(
      readPullStream(response, { host: "ken-station.local:11434", stallMs: 200 }),
    );

    expect(events.at(-1)?.done).toBe(true);
  });
});

describe("normalizeModel", () => {
  it("reads a size the daemon published", () => {
    expect(normalizeModel({ name: "m", size: 9_053_116_800 })?.sizeBytes).toBe(9_053_116_800);
  });

  it.each([
    ["nothing at all", { name: "m" }],
    // V017's `provider_models_size_bytes_positive` refuses a zero, and a zero-byte model would
    // render as a tag claiming a model that takes no space.
    ["a zero", { name: "m", size: 0 }],
    ["a fraction", { name: "m", size: 1.5 }],
    ["a string", { name: "m", size: "9053116800" }],
    ["a negative", { name: "m", size: -1 }],
    ["a NaN", { name: "m", size: Number.NaN }],
  ])("answers null for %s, because null means the daemon did not say", (_case, entry) => {
    expect(normalizeModel(entry)?.sizeBytes).toBeNull();
  });

  it("trims a name rather than accepting one that is only whitespace", () => {
    expect(normalizeModel({ name: "  phi4:14b  " })?.id).toBe("phi4:14b");
    expect(normalizeModel({ name: "   " })).toBeNull();
  });

  it("prefers name over model when a daemon sends both", () => {
    expect(normalizeModel({ name: "phi4:14b", model: "other" })?.id).toBe("phi4:14b");
  });
});

describe("normalizeProgress", () => {
  it("clamps a completed count that exceeds its own total", () => {
    // A bar cannot go past its own end, and the conformance kit refuses the shape outright.
    expect(normalizeProgress({ status: "pulling", completed: 12, total: 10 })).toEqual({
      status: "pulling",
      completedBytes: 10,
      totalBytes: 10,
      done: false,
    });
  });

  it("keeps a completed count with no total, because a byte count is still a fact", () => {
    expect(normalizeProgress({ status: "pulling", completed: 12 })).toMatchObject({
      completedBytes: 12,
      totalBytes: null,
    });
  });

  it("accepts a zero, which is a real reading at the start of a layer", () => {
    expect(normalizeProgress({ status: "pulling", completed: 0, total: 10 })).toMatchObject({
      completedBytes: 0,
      totalBytes: 10,
    });
  });

  it.each([[null], ["a string"], [{}], [{ status: "" }], [{ status: 7 }]])(
    "answers null for %p",
    (chunk) => {
      expect(normalizeProgress(chunk)).toBeNull();
    },
  );

  it("marks done only on the daemon's own success line", () => {
    expect(normalizeProgress({ status: "success" })?.done).toBe(true);
    expect(normalizeProgress({ status: "writing manifest" })?.done).toBe(false);
    expect(normalizeProgress({ status: "Success" })?.done).toBe(false);
  });
});

describe("sanitizeStatus", () => {
  it("takes control characters out, because a card draws this in a text node", () => {
    expect(sanitizeStatus("pulling\r\nmanifest")).toBe("pulling  manifest");
  });

  it("bounds what a body can put on a page", () => {
    expect(sanitizeStatus("x".repeat(500))).toHaveLength(OLLAMA_STATUS_MAX_LENGTH);
  });

  it("answers the empty string for anything that is not one", () => {
    expect(sanitizeStatus(7)).toBe("");
    expect(sanitizeStatus(undefined)).toBe("");
    expect(sanitizeStatus("   ")).toBe("");
  });
});

describe("the address policy cannot be routed around", () => {
  /** This adapter's own source, with its prose stripped and its whitespace collapsed. */
  const code = readFileSync(join(__dirname, "ollama.adapter.ts"), "utf8")
    .replaceAll(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
    .replaceAll(/\s+/g, " ");

  it("makes every request through one init, so the redirect rule is on all of them", () => {
    // Asserted against the source rather than against a call, because what has to stay true is
    // that there is no *other* call.
    expect(code.match(/fetch\(/g)).toHaveLength(3);
    expect(code.match(/fetch\( ?daemonUrl\([^)]+\), ?requestInit\(/g)).toHaveLength(3);
  });

  it("reads the configured address in exactly one place, and validates it there", () => {
    // A second reader building a URL of its own would be the scheme allow-list quietly skipped.
    expect(code.match(/config\[BASE_URL_FIELD\]/g)).toHaveLength(1);
    expect(code).toContain("resolveProviderAddress(config[BASE_URL_FIELD])");
  });

  it("never spells the redirect policy out, so it cannot disagree with the module", () => {
    expect(code).toContain("redirect: PROVIDER_REDIRECT");
    expect(code).not.toContain('redirect: "manual"');
  });

  it("has no logger at all, which is the only durable version of never logged", () => {
    // An operator's internal address is the thing worth not writing to a log here, and a test
    // that watched one call would pass for an adapter that logs on a branch nobody arranged.
    expect(code).not.toContain("Logger");
    expect(code).not.toContain("console.");
  });

  it("holds nothing about a connection between calls", () => {
    // One instance serves every workspace.
    expect(Object.keys(new OllamaAdapter())).toEqual(["kind"]);
  });
});
