import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CARD_SHAPES } from "../card.shapes.fixture";
import { validationPill, type ProviderConnectionContext } from "../provider.adapter";
import {
  CAPABILITY_NOTE_FIELD,
  CAPABILITY_NOTE_MAX_LENGTH,
  SECRET_ANNOTATION,
} from "../provider.config";
import { seatsIn } from "../provider.entitlements";
import { PROVIDER_ERROR_PILLS, ProviderAdapterError } from "../provider.errors";
import { partitionSubmission, toFormFields } from "../provider.forms";
import {
  CURSOR_API_KEY_FIELD,
  CURSOR_API_KEY_TITLE,
  CURSOR_MODEL_CONTEXT_TOKENS,
  CURSOR_MODEL_DISPLAY,
  CURSOR_MODEL_ID,
  CURSOR_TIMEOUT_MS,
  CursorAdapter,
  authorization,
  meUrl,
  missingConfiguration,
} from "./cursor.adapter";
import {
  CURSOR_CAPABILITY_NOTE,
  CURSOR_ME_URL,
  CURSOR_SECRET,
  recordedMe,
  recordedRefusal,
} from "./cursor.recordings.fixture";
import {
  recordFailure,
  recordResponses,
  recordedRequest,
  recordedTimeout,
  recordedTransportFailure,
} from "./http.recordings.fixture";

/**
 * The Cursor adapter, against recorded responses.
 *
 * `cursor.conformance.spec.ts` runs the kit, which is the contract every adapter shares. This
 * suite is what is true about *this* one: that it draws mockup 07's `CU` card, that it sends
 * the key the way Cursor's Admin API asks for it, that its catalog is declared rather than
 * discovered, and that it claims **no** entitlement — which is the assertion that keeps the
 * Copilot card's seat count meaningful.
 *
 * Everything is arranged from `cursor.recordings.fixture.ts`. Nothing opens a socket.
 */

/** The stored settings for a Cursor connection — a capability line, and nothing else. */
const CURSOR_CONFIG = { [CAPABILITY_NOTE_FIELD]: CURSOR_CAPABILITY_NOTE };

/** A connection context, as AD.2 would hand one over. */
function connection(
  config: Record<string, string> = CURSOR_CONFIG,
  secret: string | null = CURSOR_SECRET,
): ProviderConnectionContext {
  return { connectionId: "00000000-0000-4000-8000-000000000220", config, secret };
}

/** Mockup 07's Cursor card, from the fixture recorded before this adapter existed. */
const CURSOR_CARD = CARD_SHAPES.find((shape) => shape.kind === "cursor")!;

describe("the Cursor adapter's config schema", () => {
  const adapter = new CursorAdapter();

  it("renders mockup 07's card — a masked key row", () => {
    // `card.shapes.fixture.ts` asks each of AC.2–AC.5 to assert its real schema still renders
    // the card recorded there. The recorded shape is the *minimum*, which is what lets this
    // adapter add the capability note the fixture predates.
    const fields = toFormFields(adapter.configSchema());

    expect(fields.slice(0, CURSOR_CARD.fields.length)).toEqual(CURSOR_CARD.fields);
  });

  it("declares the key and the capability note, in that order", () => {
    const schema = adapter.configSchema();

    expect(Object.keys(schema.properties)).toEqual([CURSOR_API_KEY_FIELD, CAPABILITY_NOTE_FIELD]);
    expect(schema.required).toEqual([CURSOR_API_KEY_FIELD]);
  });

  it("marks the key as the credential and requires it", () => {
    // Unlike the OpenAI-compatible card's optional row: there is no keyless Cursor.
    const schema = adapter.configSchema();

    expect(schema.properties[CURSOR_API_KEY_FIELD][SECRET_ANNOTATION]).toBe(true);
    expect(toFormFields(schema)[0]).toMatchObject({
      widget: "secret",
      required: true,
      label: CURSOR_API_KEY_TITLE,
    });
  });

  it("bounds the capability note at what V017's constraint will store", () => {
    const note = adapter.configSchema().properties[CAPABILITY_NOTE_FIELD];

    expect(note.maxLength).toBe(CAPABILITY_NOTE_MAX_LENGTH);
    expect(adapter.configSchema().required).not.toContain(CAPABILITY_NOTE_FIELD);
  });

  it("round-trips the capability note as configuration, and the key to the vault", () => {
    // AC.5's sixth acceptance criterion: capability notes round-trip as connection metadata.
    // The note is `provider_connections.capability_note`; the key is never in `config` at all.
    const submission = partitionSubmission(adapter.configSchema(), {
      [CURSOR_API_KEY_FIELD]: CURSOR_SECRET,
      [CAPABILITY_NOTE_FIELD]: CURSOR_CAPABILITY_NOTE,
    });

    expect(submission).toEqual({
      config: { [CAPABILITY_NOTE_FIELD]: CURSOR_CAPABILITY_NOTE },
      secret: CURSOR_SECRET,
    });
    expect(JSON.stringify(submission.config)).not.toContain(CURSOR_SECRET);
  });

  it("hands out a fresh value the caller cannot mutate back in", () => {
    const tampered = adapter.configSchema().properties[CURSOR_API_KEY_FIELD] as { title: string };
    tampered.title = "tampered";

    expect(adapter.configSchema().properties[CURSOR_API_KEY_FIELD].title).toBe(
      CURSOR_API_KEY_TITLE,
    );
  });

  it("names the missing credential by its label rather than its field name", () => {
    expect(missingConfiguration({}, null)).toEqual([CURSOR_API_KEY_TITLE]);
    expect(missingConfiguration({}, CURSOR_SECRET)).toEqual([]);
  });
});

describe("the Cursor adapter's capabilities", () => {
  it("claims none of the four", () => {
    // The catalog is declared, nothing pulls a hosted model onto a machine, `/v0/me` says
    // nothing about a seat or an allowance, and `invocation` is AF.2's reservation.
    expect(new CursorAdapter().capabilities()).toEqual({
      discovery: false,
      pull: false,
      entitlements: false,
      invocation: false,
    });
  });

  it("keys on V015's cursor kind", () => {
    expect(new CursorAdapter().kind).toBe("cursor");
  });
});

describe("how the Cursor adapter presents its key", () => {
  it("sends it as HTTP Basic with an empty password, which is Cursor's own convention", () => {
    // Its Admin API is documented as `curl -u API_KEY:` rather than as a bearer token. This is
    // the one line that knows the scheme, so a vendor that moves is a one-line change.
    expect(authorization(CURSOR_SECRET)).toBe(
      `Basic ${Buffer.from(`${CURSOR_SECRET}:`, "utf8").toString("base64")}`,
    );
    expect(Buffer.from(authorization("abc").slice("Basic ".length), "base64").toString()).toBe(
      "abc:",
    );
  });

  it("asks Cursor's own host, built from nothing a caller supplied", async () => {
    const spy = recordResponses(recordedMe());

    await new CursorAdapter().validate(CURSOR_CONFIG, CURSOR_SECRET);

    const { url, init } = recordedRequest(spy);

    expect(meUrl()).toBe(CURSOR_ME_URL);
    expect(url).toBe(CURSOR_ME_URL);
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({
      accept: "application/json",
      authorization: authorization(CURSOR_SECRET),
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("testing a Cursor connection", () => {
  it("reports the status and a measured latency", async () => {
    recordResponses(recordedMe());

    const validation = await new CursorAdapter().validate(CURSOR_CONFIG, CURSOR_SECRET);

    expect(validation).toMatchObject({ status: "ok", detail: "200" });
    expect(validation.status === "ok" && validation.latencyMs).toBeGreaterThanOrEqual(0);
    expect(validationPill(validation)).toMatchObject({ tone: "ok", label: "connected" });
  });

  it("measures a real round trip rather than reporting a constant", async () => {
    const held = 40;
    jest.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(recordedMe());
          }, held);
        }),
    );

    const validation = await new CursorAdapter().validate(CURSOR_CONFIG, CURSOR_SECRET);

    expect(validation.status).toBe("ok");
    expect(validation.status === "ok" && validation.latencyMs).toBeGreaterThanOrEqual(held - 5);
  });

  it("reports no entitlement, because there is none to report", async () => {
    // The other half of decision P8: the Copilot card beside this one shows a real seat count,
    // and it is readable only while nothing invents one.
    recordResponses(recordedMe());

    const validation = await new CursorAdapter().validate(CURSOR_CONFIG, CURSOR_SECRET);

    expect(seatsIn(validation.detail)).toBeNull();
    expect(validation.detail).toBe("200");
  });

  it("refuses before opening a socket when there is no key", async () => {
    const spy = recordResponses(recordedMe());

    const validation = await new CursorAdapter().validate(CURSOR_CONFIG, null);

    expect(validation).toEqual({
      status: "failed",
      errorClass: "config",
      detail: `${CURSOR_API_KEY_TITLE} required`,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    [401, "auth", "key rejected (401)"],
    [403, "auth", "key rejected (403)"],
    [404, "config", "responded 404"],
    [429, "rate_limit", "rate limited (429)"],
    [500, "upstream", "500 upstream"],
    [503, "upstream", "503 upstream"],
  ])("classifies a %i through the shared taxonomy", async (status, errorClass, detail) => {
    recordResponses(recordedRefusal(status));

    const validation = await new CursorAdapter().validate(CURSOR_CONFIG, CURSOR_SECRET);

    expect(validation).toEqual({ status: "failed", errorClass, detail });
  });

  it("renders a 503 as the same degraded pill the Copilot card draws", async () => {
    // One taxonomy, five adapters. Nothing about the pill or its tone is this provider's.
    recordResponses(recordedRefusal(503));

    const validation = await new CursorAdapter().validate(CURSOR_CONFIG, CURSOR_SECRET);

    expect(validationPill(validation)).toBe(PROVIDER_ERROR_PILLS.upstream);
  });

  it("does not retry, because nothing here asked it to", async () => {
    // The bounded retry is the Copilot adapter's, for a provider whose degraded state the
    // mockup actually draws. A retry every adapter did would be a policy nobody decided.
    const spy = recordResponses(recordedRefusal(503));

    await new CursorAdapter().validate(CURSOR_CONFIG, CURSOR_SECRET);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("reports a refused socket as unreachable, saying nothing about the key", async () => {
    recordFailure(recordedTransportFailure("ECONNREFUSED"));

    const validation = await new CursorAdapter().validate(CURSOR_CONFIG, CURSOR_SECRET);

    expect(validation).toEqual({
      status: "failed",
      errorClass: "network",
      detail: "unreachable (ECONNREFUSED)",
    });
  });

  it("reports a deadline as a timeout that names it", async () => {
    recordFailure(recordedTimeout());

    const validation = await new CursorAdapter().validate(CURSOR_CONFIG, CURSOR_SECRET);

    expect(validation).toEqual({
      status: "failed",
      errorClass: "network",
      detail: `timed out after ${CURSOR_TIMEOUT_MS.toString()} ms`,
    });
  });

  it("never quotes the provider's body, which really contains the key", async () => {
    // The recorded `401` quotes the rejected key back, the way a gateway does to tell you which
    // credential it refused. An adapter that read a refusal's body would print it on a card.
    recordResponses(recordedRefusal(401));

    const validation = await new CursorAdapter().validate(CURSOR_CONFIG, CURSOR_SECRET);

    expect(validation.detail).toBe("key rejected (401)");
    expect(validation.detail).not.toContain(CURSOR_SECRET);
  });
});

describe("the Cursor adapter's fixed catalog", () => {
  it("answers mockup 07's chip without opening a socket", async () => {
    const spy = recordResponses(recordedMe());

    const models = await new CursorAdapter().discoverModels(connection());

    expect(models).toEqual([
      {
        id: CURSOR_MODEL_ID,
        display: CURSOR_MODEL_DISPLAY,
        contextLength: CURSOR_MODEL_CONTEXT_TOKENS,
        sizeBytes: null,
        tier: null,
      },
    ]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("carries the provider's own id and the mockup's display separately", () => {
    // `model_aliases.model` and `model_prices.match_model` are written against the id. These
    // are the same two spellings `R__dev_seed_providers.sql` writes for the seeded connection.
    expect(CURSOR_MODEL_ID).toBe("composer-2");
    expect(CURSOR_MODEL_DISPLAY).toBe("cursor/composer-2");
  });

  it("answers the same rows every time, which is what makes the upsert an upsert", async () => {
    const adapter = new CursorAdapter();

    const first = await adapter.discoverModels(connection());
    const second = await adapter.discoverModels(connection());

    expect(first).toEqual(second);
    expect(new Set(first.map((model) => model.id)).size).toBe(first.length);
  });

  it("hands out fresh objects rather than the module's own constant", async () => {
    const adapter = new CursorAdapter();

    const first = await adapter.discoverModels(connection());
    (first[0] as { display: string }).display = "tampered";

    expect((await adapter.discoverModels(connection()))[0].display).toBe(CURSOR_MODEL_DISPLAY);
  });

  it("refuses a connection with no credential", async () => {
    await expect(
      new CursorAdapter().discoverModels(connection(CURSOR_CONFIG, null)),
    ).rejects.toThrow(ProviderAdapterError);
    await expect(
      new CursorAdapter().discoverModels(connection(CURSOR_CONFIG, null)),
    ).rejects.toMatchObject({ errorClass: "config", detail: `${CURSOR_API_KEY_TITLE} required` });
  });

  it("rejects rather than throwing synchronously", async () => {
    const answer = new CursorAdapter().discoverModels(connection(CURSOR_CONFIG, null));

    expect(answer).toBeInstanceOf(Promise);
    await expect(answer).rejects.toBeInstanceOf(ProviderAdapterError);
  });
});

describe("what the Cursor adapter's source may not contain", () => {
  const code = readFileSync(join(__dirname, "cursor.adapter.ts"), "utf8").replaceAll(
    /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
    "",
  );

  it("has no logger at all, which is the only durable version of never logged", () => {
    expect(code).not.toContain("Logger");
    expect(code).not.toContain("console.");
  });

  it("holds no credential between calls", () => {
    const adapter = new CursorAdapter();

    expect(Object.values(adapter)).not.toContain(CURSOR_SECRET);
    expect(JSON.stringify(adapter)).not.toContain("key_cur");
  });

  it("reads no response body at all", () => {
    // The only question this adapter asks is *did the key work*, and the answer is a status.
    // Nothing here parses anything a provider sent, which is the strongest version of *no
    // response body reaches a detail*.
    expect(code).not.toContain("response.json()");
    expect(code).not.toContain("response.text()");
  });
});
