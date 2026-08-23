import { PROVIDER_CONNECTION_STATUSES } from "../db/schema";
import {
  CONNECTED_PILL,
  PROVIDER_ERROR_CLASSES,
  PROVIDER_ERROR_PILLS,
  PROVIDER_ERROR_RETRYABLE,
  PROVIDER_ERROR_STATUS,
  ProviderAdapterError,
  classifyHttpStatus,
  describeHttpRefusal,
  describeTransportFailure,
  isTimeout,
  pillFor,
} from "./provider.errors";

/**
 * The taxonomy, and AC.1's fourth acceptance criterion.
 *
 * *"The error taxonomy maps 1:1 onto the card status pills, documented as a table."* The table
 * is in `provider.errors.ts`'s header; what is asserted here is the property the table claims —
 * that the mapping is **total and injective**, so no class is unrenderable and no two classes
 * are indistinguishable on a card.
 *
 * The classifier's cases are driven from a table rather than written as one `it` per status,
 * because the interesting content is the *boundaries* — `407` beside `408`, `429` beside `430`,
 * `499` beside `500` — and a reader should see them adjacent.
 */

describe("the taxonomy and the pills", () => {
  it("gives every class a pill", () => {
    expect(Object.keys(PROVIDER_ERROR_PILLS).sort()).toEqual([...PROVIDER_ERROR_CLASSES].sort());
  });

  it("gives no two classes the same pill", () => {
    // The 1:1 the acceptance criterion asks for. Two classes sharing a label would make a card
    // that cannot tell an operator whether to rotate a key or check a firewall.
    const labels = PROVIDER_ERROR_CLASSES.map(
      (errorClass) => PROVIDER_ERROR_PILLS[errorClass].label,
    );

    expect(new Set(labels).size).toBe(PROVIDER_ERROR_CLASSES.length);
  });

  it("keeps the connected pill out of the error table", () => {
    // Success is not an error class. A sixth entry called `none` would be a value every
    // consumer iterating the taxonomy had to remember to exclude.
    const labels = PROVIDER_ERROR_CLASSES.map(
      (errorClass) => PROVIDER_ERROR_PILLS[errorClass].label,
    );

    expect(labels).not.toContain(CONNECTED_PILL.label);
  });

  it("uses only the three tones mockup 07 defines", () => {
    const tones = PROVIDER_ERROR_CLASSES.map((errorClass) => PROVIDER_ERROR_PILLS[errorClass].tone);

    expect(new Set([...tones, CONNECTED_PILL.tone])).toEqual(new Set(["ok", "warn", "err"]));
  });

  it("renders mockup 07's own two pills verbatim", () => {
    // The page was drawn before the taxonomy was named, and these two labels are on it: the
    // Anthropic card's `connected` and the Copilot card's `degraded upstream`. If either
    // changes here, the page and the product stop agreeing.
    expect(CONNECTED_PILL).toEqual({ tone: "ok", label: "connected" });
    expect(PROVIDER_ERROR_PILLS.upstream).toEqual({ tone: "warn", label: "degraded upstream" });
  });

  it("answers the connected pill for a check that passed", () => {
    expect(pillFor(null)).toBe(CONNECTED_PILL);
    expect(pillFor("auth")).toBe(PROVIDER_ERROR_PILLS.auth);
  });

  it("refuses a retry only where a retry cannot help", () => {
    // A refused credential stays refused and a wrong address stays wrong; the other three are
    // states that pass on their own.
    expect(PROVIDER_ERROR_RETRYABLE).toEqual({
      auth: false,
      network: true,
      upstream: true,
      rate_limit: true,
      config: false,
    });
  });

  it("coarsens every class to a status V015 actually has", () => {
    for (const errorClass of PROVIDER_ERROR_CLASSES) {
      expect(PROVIDER_CONNECTION_STATUSES).toContain(PROVIDER_ERROR_STATUS[errorClass]);
    }
  });

  it("never coarsens a failure to a status that would keep routing to it", () => {
    // The deliberate flattening `provider.errors.ts` argues for: V015 has no *working, but
    // throttled*, so a rate limit must not read as `active` to Z.1's chain walk.
    const statuses = PROVIDER_ERROR_CLASSES.map((errorClass) => PROVIDER_ERROR_STATUS[errorClass]);

    expect(new Set(statuses)).toEqual(new Set(["error"]));
  });
});

describe("classifyHttpStatus", () => {
  it.each([
    [301, "config", "a redirect is an address one level above the API"],
    [400, "config", "the request was understood and rejected on its merits"],
    [401, "auth", "the classic expired key"],
    [403, "auth", "a key that is valid and not entitled"],
    [404, "config", "a base URL missing its /v1"],
    [407, "auth", "a proxy demanding its own credential"],
    [408, "network", "a server-side timeout is the same fact as a client-side one"],
    [418, "config", "any other 4xx"],
    [429, "rate_limit", "the only status this class has"],
    [500, "upstream", "the provider's own failure"],
    [503, "upstream", "mockup 07's Copilot card"],
    [599, "upstream", "anything else in the range"],
  ])("reads %i as %s — %s", (status, expected) => {
    expect(classifyHttpStatus(status)).toBe(expected);
  });

  it("refuses to classify a success", () => {
    // Returning a plausible-looking `upstream` for a 200 would let a bug at a call site turn
    // into a card that says the provider is degraded.
    expect(() => classifyHttpStatus(200)).toThrow(RangeError);
  });
});

describe("describeHttpRefusal", () => {
  it.each([
    [401, "key rejected (401)"],
    [403, "key rejected (403)"],
    [429, "rate limited (429)"],
    [503, "503 upstream"],
    [404, "responded 404"],
    [408, "timed out (408)"],
  ])("renders %i as %s", (status, expected) => {
    expect(describeHttpRefusal(status)).toBe(expected);
  });

  it("shares mockup 06's vocabulary for a rejected key", () => {
    // `provider-health/probe.client.ts` already prints this exact phrase on the health strip.
    // A person moving between the two pages should not have to learn that they mean the same
    // thing.
    expect(describeHttpRefusal(401)).toBe("key rejected (401)");
  });

  it("leaves the retry half of the note to the card", () => {
    // Mockup 07 draws `△ 503 upstream · retrying`. The `· retrying` comes from
    // PROVIDER_ERROR_RETRYABLE at render time, so an adapter cannot bake a layout decision into
    // a network client.
    expect(describeHttpRefusal(503)).not.toContain("retrying");
  });
});

describe("describeTransportFailure", () => {
  it("names the deadline when one was reached", () => {
    const timeout = new DOMException("aborted", "TimeoutError");

    expect(describeTransportFailure(timeout, 5000)).toBe("timed out after 5000 ms");
  });

  it("recognises a timeout that is not an Error", () => {
    // Node's abort arrives as a DOMException, which is not `instanceof Error` — the trap both
    // probe clients in this service document. A check written against Error would report every
    // timed-out call as a plain failure.
    expect(new DOMException("aborted", "TimeoutError")).not.toBeInstanceOf(Error);
    expect(isTimeout(new DOMException("aborted", "TimeoutError"))).toBe(true);
  });

  it("reads the code fetch hides in the cause", () => {
    const refused = new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });

    expect(describeTransportFailure(refused, 5000)).toBe("unreachable (ECONNREFUSED)");
  });

  it("prints no code when what is there is a message in disguise", () => {
    // A `code` of "connect ECONNREFUSED 10.0.4.20:8000" carries an internal address to a page
    // in a browser. The pattern is what keeps a symbol a symbol.
    const chatty = new Error("nope", { cause: { code: "connect ECONNREFUSED 10.0.4.20:8000" } });

    expect(describeTransportFailure(chatty, 5000)).toBe("unreachable");
  });

  it("survives a thrown value that is not an object", () => {
    expect(describeTransportFailure("nope", 5000)).toBe("unreachable");
  });
});

describe("ProviderAdapterError", () => {
  it("carries the class and the phrase, and reads as itself in a log", () => {
    const error = new ProviderAdapterError("upstream", "503 upstream", 503);

    expect(error.errorClass).toBe("upstream");
    expect(error.detail).toBe("503 upstream");
    expect(error.httpStatus).toBe(503);
    expect(error.message).toBe("503 upstream");
    expect(error.name).toBe("ProviderAdapterError");
  });

  it("has no status for a failure that never reached a provider", () => {
    expect(new ProviderAdapterError("network", "unreachable").httpStatus).toBeNull();
  });

  it("recognises one built by a different copy of this module", () => {
    // Duck-typed on purpose — a plugin adapter compiled against its own copy would fail an
    // `instanceof` while being exactly the thing a consumer needs to recognise.
    expect(ProviderAdapterError.is({ errorClass: "auth", detail: "key rejected (401)" })).toBe(
      true,
    );
    expect(ProviderAdapterError.is(new ProviderAdapterError("auth", "key rejected (401)"))).toBe(
      true,
    );
  });

  it.each<[string, unknown]>([
    ["an ordinary error", new Error("plain")],
    ["a class outside the taxonomy", { errorClass: "teapot", detail: "nope" }],
    ["no detail", { errorClass: "auth" }],
    ["null", null],
    ["a string", "auth"],
  ])("does not recognise %s", (_description, candidate) => {
    expect(ProviderAdapterError.is(candidate)).toBe(false);
  });
});
