import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CARD_SHAPES } from "../card.shapes.fixture";
import {
  validationNote,
  validationPill,
  type ProviderConnectionContext,
} from "../provider.adapter";
import {
  CAPABILITY_NOTE_FIELD,
  CAPABILITY_NOTE_MAX_LENGTH,
  SECRET_ANNOTATION,
} from "../provider.config";
import { seatsIn } from "../provider.entitlements";
import { PROVIDER_ERROR_PILLS, ProviderAdapterError } from "../provider.errors";
import { partitionSubmission, toFormFields } from "../provider.forms";
import {
  COPILOT_MODEL_CONTEXT_TOKENS,
  COPILOT_MODEL_DISPLAY,
  COPILOT_MODEL_ID,
  COPILOT_ORGANIZATION_FIELD,
  COPILOT_ORGANIZATION_TITLE,
  COPILOT_RETRY_BACKOFF_MS,
  COPILOT_SLOW_MS,
  COPILOT_TIMEOUT_MS,
  COPILOT_TOKEN_FIELD,
  COPILOT_TOKEN_TITLE,
  COPILOT_VALIDATE_ATTEMPTS,
  COPILOT_VALIDATE_BUDGET_MS,
  CopilotAdapter,
  billingUrl,
  describeSlowUpstream,
  hasRetryBudget,
  isLatencyOutlier,
  missingConfiguration,
  resolveOrganization,
  userUrl,
} from "./copilot.adapter";
import {
  COPILOT_BILLING_URL,
  COPILOT_BILLING_WITHOUT_SEATS,
  COPILOT_CAPABILITY_NOTE,
  COPILOT_ORGANIZATION,
  COPILOT_SECRET,
  COPILOT_USER_URL,
  recordedBilling,
  recordedBody,
  recordedProxyChallenge,
  recordedRefusal,
  recordedUser,
} from "./copilot.recordings.fixture";
import {
  recordFailure,
  recordRepeatedly,
  recordResponses,
  recordedRequest,
  recordedTimeout,
  recordedTransportFailure,
} from "./http.recordings.fixture";
import { paramSchemaViolations, storageViolations } from "../provider.params";

/**
 * The Copilot adapter, against recorded responses.
 *
 * `copilot.conformance.spec.ts` runs the kit — three times, once per entitlement state — which
 * is the contract every adapter shares. This suite is what is true about *this* one, and it is
 * the three things AC.5 ([#220](https://github.com/NobuData/ouroboros/issues/220)) is actually
 * about:
 *
 * ```
 * seats          real entitlement data, or no suffix at all      decision P8, both fixtures
 * degraded       503 · slow answer  →  warn pill + △ … · retrying   through the taxonomy
 * bounded retry  at most two attempts, and only inside a budget    both bounds, asserted
 * ```
 *
 * Everything is arranged from `copilot.recordings.fixture.ts`. Nothing opens a socket, so this
 * runs in `yarn test` rather than in a suite gated on somebody having a GitHub token.
 */

/** The stored settings for a connection that names the org it bills through. */
const COPILOT_CONFIG = {
  [COPILOT_ORGANIZATION_FIELD]: COPILOT_ORGANIZATION,
  [CAPABILITY_NOTE_FIELD]: COPILOT_CAPABILITY_NOTE,
};

/** A connection context, as AD.2 would hand one over. */
function connection(
  config: Record<string, string> = COPILOT_CONFIG,
  secret: string | null = COPILOT_SECRET,
): ProviderConnectionContext {
  return { connectionId: "00000000-0000-4000-8000-000000000220", config, secret };
}

/**
 * Arrange the clock so one token check measures exactly `latencyMs`.
 *
 * The latency threshold is five seconds and a unit suite cannot wait five seconds, so the two
 * `performance.now()` readings one attempt takes are supplied instead. It is the smallest
 * possible stand-in: the adapter's own measurement code runs, and only the clock is arranged.
 *
 * @param latencyMs - What the attempt should appear to have taken.
 */
function measuring(latencyMs: number): void {
  const readings = [0, latencyMs];

  jest.spyOn(performance, "now").mockImplementation(() => readings.shift() ?? latencyMs);
}

/** Mockup 07's Copilot card, from the fixture recorded before this adapter existed. */
const COPILOT_CARD = CARD_SHAPES.find((shape) => shape.kind === "copilot")!;

describe("the Copilot adapter's config schema", () => {
  const adapter = new CopilotAdapter();

  it("renders mockup 07's card — a masked token row, org-billed", () => {
    // `card.shapes.fixture.ts` asks each of AC.2–AC.5 to assert its real schema still renders
    // the card recorded there. The recorded shape is the *minimum*, which is what lets an
    // adapter add a field the fixture predates — so the recorded row is checked exactly, and
    // the two this ticket adds are checked beside it rather than instead of it.
    const fields = toFormFields(adapter.configSchema());

    expect(fields.slice(0, COPILOT_CARD.fields.length)).toEqual(COPILOT_CARD.fields);
  });

  it("declares the token, the organization and the capability note, in that order", () => {
    const schema = adapter.configSchema();

    expect(Object.keys(schema.properties)).toEqual([
      COPILOT_TOKEN_FIELD,
      COPILOT_ORGANIZATION_FIELD,
      CAPABILITY_NOTE_FIELD,
    ]);
    // The credential is the only required row: a Copilot token is usable by somebody who is
    // not an administrator of the organization paying for it.
    expect(schema.required).toEqual([COPILOT_TOKEN_FIELD]);
  });

  it("marks the token as the credential and renders it masked", () => {
    const schema = adapter.configSchema();

    expect(schema.properties[COPILOT_TOKEN_FIELD][SECRET_ANNOTATION]).toBe(true);
    expect(toFormFields(schema)[0]).toMatchObject({
      widget: "secret",
      required: true,
      label: COPILOT_TOKEN_TITLE,
    });
  });

  it("accepts a blank organization row, because the row is optional", () => {
    // An untouched optional input submits an empty string rather than nothing, and
    // `partitionSubmission` stores what the form sent. A pattern that only matched a login
    // would fail an add-form on a field nobody filled in.
    const pattern = new RegExp(
      adapter.configSchema().properties[COPILOT_ORGANIZATION_FIELD].pattern!,
    );

    expect(pattern.test("")).toBe(true);
    expect(pattern.test(COPILOT_ORGANIZATION)).toBe(true);
    expect(pattern.test("acme robotics")).toBe(false);
    expect(pattern.test("-acme")).toBe(false);
    expect(pattern.test("acme-")).toBe(false);
    expect(pattern.test("a".repeat(40))).toBe(false);
  });

  it("bounds the capability note at what V017's constraint will store", () => {
    // `provider_connections_capability_note_present` refuses anything longer. A schema with no
    // maxLength would render a form whose valid-looking submission fails at the insert.
    const note = adapter.configSchema().properties[CAPABILITY_NOTE_FIELD];

    expect(note.maxLength).toBe(CAPABILITY_NOTE_MAX_LENGTH);
    expect(adapter.configSchema().required).not.toContain(CAPABILITY_NOTE_FIELD);
  });

  it("round-trips the note and the org as configuration, and the token to the vault", () => {
    // AC.5's sixth acceptance criterion: capability notes round-trip as connection metadata.
    // The note is `provider_connections.capability_note` and the organization is an ordinary
    // setting; the token is never in `config` at all, which is the split `partitionSubmission`
    // exists to make.
    const submission = partitionSubmission(adapter.configSchema(), {
      [COPILOT_TOKEN_FIELD]: COPILOT_SECRET,
      [COPILOT_ORGANIZATION_FIELD]: COPILOT_ORGANIZATION,
      [CAPABILITY_NOTE_FIELD]: COPILOT_CAPABILITY_NOTE,
    });

    expect(submission).toEqual({ config: COPILOT_CONFIG, secret: COPILOT_SECRET });
    expect(JSON.stringify(submission.config)).not.toContain(COPILOT_SECRET);
  });

  it("hands out a fresh value the caller cannot mutate back in", () => {
    // AE.5 holds this while somebody fills in a form. The cast is the point of the case: the
    // interface is readonly, and what is being checked is what happens when something that is
    // not TypeScript writes to it anyway.
    const tampered = adapter.configSchema().properties[COPILOT_TOKEN_FIELD] as { title: string };
    tampered.title = "tampered";

    expect(adapter.configSchema().properties[COPILOT_TOKEN_FIELD].title).toBe(COPILOT_TOKEN_TITLE);
  });

  it("names the missing credential by its label rather than its field name", () => {
    // The sentence is printed on a card foot. `token required` is a field name leaking into a
    // page.
    expect(missingConfiguration({}, null)).toEqual([COPILOT_TOKEN_TITLE]);
    expect(missingConfiguration({}, COPILOT_SECRET)).toEqual([]);
  });
});

describe("the Copilot adapter's capabilities", () => {
  it("declares entitlements, and does not claim discovery", () => {
    // The adapter AC.1 named as the one that sets `entitlements`. `discovery` is false because
    // the catalog is declared — not because the member is missing, which is the distinction
    // AE.4 hides its refresh affordance on.
    expect(new CopilotAdapter().capabilities()).toEqual({
      discovery: false,
      pull: false,
      entitlements: true,
      invocation: false,
    });
  });

  it("keys on V015's copilot kind", () => {
    expect(new CopilotAdapter().kind).toBe("copilot");
  });
});

describe("where the Copilot adapter sends its requests", () => {
  it("asks GitHub's own host, and builds it from nothing a caller supplied", () => {
    expect(userUrl()).toBe(COPILOT_USER_URL);
    expect(billingUrl(COPILOT_ORGANIZATION)).toBe(COPILOT_BILLING_URL);
  });

  it("encodes the organization into the path", () => {
    // The pattern is what makes traversal impossible and this is what makes it impossible
    // twice. A login cannot contain any of these — `resolveOrganization` refuses them before a
    // URL is built — and the encoding is what keeps that true if the pattern is ever loosened.
    expect(billingUrl("a/b")).toBe("https://api.github.com/orgs/a%2Fb/copilot/billing");
    expect(billingUrl("..")).toBe("https://api.github.com/orgs/../copilot/billing");
  });

  it("sends the token as a bearer, with GitHub's accept and version headers", async () => {
    const spy = recordResponses(recordedUser(), recordedBilling());

    await new CopilotAdapter().validate(COPILOT_CONFIG, COPILOT_SECRET);

    const { url, init } = recordedRequest(spy);

    expect(url).toBe(COPILOT_USER_URL);
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({
      accept: "application/vnd.github+json",
      authorization: `Bearer ${COPILOT_SECRET}`,
      "x-github-api-version": "2022-11-28",
    });
  });

  it("gives every attempt its own deadline", async () => {
    const spy = recordResponses(recordedUser(), recordedBilling());

    await new CopilotAdapter().validate(COPILOT_CONFIG, COPILOT_SECRET);

    // A shared signal would make the entitlement lookup inherit whatever was left of the token
    // check's ten seconds, which is a deadline that shortens as a provider gets slower.
    expect(recordedRequest(spy, 0).init.signal).not.toBe(recordedRequest(spy, 1).init.signal);
    expect(recordedRequest(spy, 0).init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("testing a Copilot connection", () => {
  it("reports the status and a measured latency", async () => {
    recordResponses(recordedUser(), recordedBilling());

    const validation = await new CopilotAdapter().validate(COPILOT_CONFIG, COPILOT_SECRET);

    expect(validation.status).toBe("ok");
    expect(validation.status === "ok" && validation.latencyMs).toBeGreaterThanOrEqual(0);
    expect(validationPill(validation)).toMatchObject({ tone: "ok", label: "connected" });
  });

  it("measures a real round trip rather than reporting a constant", async () => {
    // A provider held for 40ms must read as at least roughly that; a fabricated or cached
    // number could not. The floor is generous because a loaded CI machine may add to the wait
    // but cannot subtract from it.
    const held = 40;
    jest.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(recordedUser());
          }, held);
        }),
    );

    const validation = await new CopilotAdapter().validate({}, COPILOT_SECRET);

    expect(validation.status).toBe("ok");
    expect(validation.status === "ok" && validation.latencyMs).toBeGreaterThanOrEqual(held - 5);
  });

  it("refuses before opening a socket when there is no token", async () => {
    const spy = recordResponses(recordedUser());

    const validation = await new CopilotAdapter().validate(COPILOT_CONFIG, null);

    expect(validation).toEqual({
      status: "failed",
      errorClass: "config",
      detail: `${COPILOT_TOKEN_TITLE} required`,
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
    // Not one branch of this is Copilot's: `classifyHttpStatus` and `describeHttpRefusal` are
    // the same two functions every adapter calls, which is what stops five adapters growing
    // five readings of a `403`.
    recordRepeatedly(() => recordedRefusal(status));

    const validation = await new CopilotAdapter().validate(COPILOT_CONFIG, COPILOT_SECRET);

    expect(validation).toEqual({ status: "failed", errorClass, detail });
  });

  it("reports a refused socket as unreachable, saying nothing about the token", async () => {
    recordFailure(recordedTransportFailure("ECONNREFUSED"));

    const validation = await new CopilotAdapter().validate(COPILOT_CONFIG, COPILOT_SECRET);

    expect(validation).toEqual({
      status: "failed",
      errorClass: "network",
      detail: "unreachable (ECONNREFUSED)",
    });
  });

  it("reports a deadline as a timeout that names it", async () => {
    recordFailure(recordedTimeout());

    const validation = await new CopilotAdapter().validate(COPILOT_CONFIG, COPILOT_SECRET);

    expect(validation).toEqual({
      status: "failed",
      errorClass: "network",
      detail: `timed out after ${COPILOT_TIMEOUT_MS.toString()} ms`,
    });
  });

  it("never puts the token in a detail, whatever the provider answered", async () => {
    // The recorded `401` is a proxy's page that really quotes the `authorization` header. An
    // adapter that read a refusal's body would leak the token onto a card.
    recordResponses(recordedProxyChallenge());

    const validation = await new CopilotAdapter().validate(COPILOT_CONFIG, COPILOT_SECRET);

    expect(validation.detail).not.toContain(COPILOT_SECRET);
    expect(validation.detail).toBe("key rejected (401)");
  });
});

describe("the organization, before it reaches a URL", () => {
  it("reads a blank field as no organization rather than as an error", () => {
    // The ordinary state of a connection whose owner is not an org administrator.
    expect(resolveOrganization({})).toEqual({ ok: true, login: null });
    expect(resolveOrganization({ [COPILOT_ORGANIZATION_FIELD]: "   " })).toEqual({
      ok: true,
      login: null,
    });
  });

  it("takes a login, trimmed", () => {
    expect(
      resolveOrganization({ [COPILOT_ORGANIZATION_FIELD]: ` ${COPILOT_ORGANIZATION} ` }),
    ).toEqual({ ok: true, login: COPILOT_ORGANIZATION });
  });

  it.each([
    ["a path separator", "acme/robotics"],
    ["a traversal", ".."],
    ["a dotted segment", "acme.robotics"],
    ["an encoded separator", "acme%2Frobotics"],
    ["a query", "acme?x=1"],
    ["a space", "acme robotics"],
    ["a leading hyphen", "-acme"],
    ["a trailing hyphen", "acme-"],
    ["a double hyphen", "acme--robotics"],
    ["something far too long", "a".repeat(40)],
  ])("refuses %s", (_description, supplied) => {
    // The value reaches a URL path, so a form annotation is not the check. Every one of these
    // is a `config` failure with an actionable sentence rather than a silently-skipped lookup.
    expect(resolveOrganization({ [COPILOT_ORGANIZATION_FIELD]: supplied })).toEqual({
      ok: false,
      violation: `${COPILOT_ORGANIZATION_TITLE} is not a GitHub login`,
    });
  });

  it("does not echo what somebody typed", () => {
    // Not a credential, but a `detail` is rendered on a page, and quoting back whatever was
    // pasted is a habit that eventually quotes the wrong field.
    const outcome = resolveOrganization({ [COPILOT_ORGANIZATION_FIELD]: "some/thing" });

    expect(outcome.ok).toBe(false);

    if (!outcome.ok) {
      expect(outcome.violation).not.toContain("some/thing");
    }
  });

  it("fails the validation before any socket is opened", async () => {
    const spy = recordResponses(recordedUser());

    const validation = await new CopilotAdapter().validate(
      { [COPILOT_ORGANIZATION_FIELD]: "acme/robotics" },
      COPILOT_SECRET,
    );

    expect(validation).toEqual({
      status: "failed",
      errorClass: "config",
      detail: `${COPILOT_ORGANIZATION_TITLE} is not a GitHub login`,
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("the seat count, and decision P8", () => {
  it("reports the seats GitHub published", async () => {
    const spy = recordResponses(recordedUser(), recordedBilling());

    const validation = await new CopilotAdapter().validate(COPILOT_CONFIG, COPILOT_SECRET);

    expect(validation.detail).toBe("200 · 4 seats");
    // What AE.6's cap line reads back — mockup 07's `$76.00 of $95 cap · 4 seats`.
    expect(seatsIn(validation.detail)).toBe(4);
    expect(recordedRequest(spy, 1).url).toBe(COPILOT_BILLING_URL);
  });

  it("omits the suffix entirely when the plan reports no breakdown", async () => {
    // AC.5's fourth acceptance criterion, and the fixture it names: the same adapter, the same
    // code path, and no seat suffix rather than a guessed one.
    recordResponses(recordedUser(), recordedBilling(COPILOT_BILLING_WITHOUT_SEATS));

    const validation = await new CopilotAdapter().validate(COPILOT_CONFIG, COPILOT_SECRET);

    expect(validation.detail).toBe("200");
    expect(seatsIn(validation.detail)).toBeNull();
  });

  it("reports a published zero, because zero is a state an organization can be in", async () => {
    recordResponses(recordedUser(), recordedBilling({ seat_breakdown: { total: 0 } }));

    const validation = await new CopilotAdapter().validate(COPILOT_CONFIG, COPILOT_SECRET);

    expect(validation.detail).toBe("200 · 0 seats");
  });

  it("does not ask about seats at all when no organization is configured", async () => {
    const spy = recordResponses(recordedUser());

    const validation = await new CopilotAdapter().validate(
      { [CAPABILITY_NOTE_FIELD]: COPILOT_CAPABILITY_NOTE },
      COPILOT_SECRET,
    );

    expect(validation.detail).toBe("200");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a 403 — the token has no manage_billing:copilot scope", () => recordedRefusal(403)],
    ["a 404 — an organization this token cannot see", () => recordedRefusal(404)],
    ["a 500 — GitHub having a moment", () => recordedRefusal(500)],
    ["a body that is not JSON", () => recordedBody("<html>proxy</html>", "text/html")],
    ["a body that is not an object", () => recordedBody("[]")],
    ["a breakdown that is not an object", () => recordedBilling({ seat_breakdown: 4 })],
    ["a total that is a string", () => recordedBilling({ seat_breakdown: { total: "4" } })],
    ["a total that is a fraction", () => recordedBilling({ seat_breakdown: { total: 4.5 } })],
  ])("keeps the connection healthy and drops the suffix for %s", async (_description, billing) => {
    // The entitlement lookup is a supplement, made only after the token has already been
    // accepted. Reporting a good token as broken because a billing endpoint was unavailable
    // would be this adapter's curiosity rendered as an operator's outage.
    recordResponses(recordedUser(), billing());

    const validation = await new CopilotAdapter().validate(COPILOT_CONFIG, COPILOT_SECRET);

    expect(validation.status).toBe("ok");
    expect(validation.detail).toBe("200");
  });

  it("keeps the connection healthy when the billing call never answers", async () => {
    let call = 0;
    // The stand-in answers a recorded response and throws a recorded failure — nothing to await.
    // eslint-disable-next-line @typescript-eslint/require-await
    jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
      call += 1;

      if (call === 1) {
        return recordedUser();
      }

      throw recordedTransportFailure("ECONNRESET");
    });

    const validation = await new CopilotAdapter().validate(COPILOT_CONFIG, COPILOT_SECRET);

    expect(validation).toMatchObject({ status: "ok", detail: "200" });
  });

  it("never lets the entitlement lookup see a failed token check", async () => {
    // The order matters: a `401` from `/user` must not be followed by a billing request made
    // with a credential GitHub has already refused.
    const spy = recordRepeatedly(() => recordedRefusal(401));

    await new CopilotAdapter().validate(COPILOT_CONFIG, COPILOT_SECRET);

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("the degraded-upstream state, end to end", () => {
  it("draws mockup 07's pill and note from a recorded 503", async () => {
    // AC.5's second acceptance criterion. Every step is the shared taxonomy: the class is
    // `classifyHttpStatus`', the pill is `PROVIDER_ERROR_PILLS`', and the note — including the
    // `· retrying` — is `validationNote`'s. Nothing on this path names Copilot.
    recordRepeatedly(() => recordedRefusal(503));

    const validation = await new CopilotAdapter().validate(COPILOT_CONFIG, COPILOT_SECRET);

    expect(validation).toEqual({
      status: "failed",
      errorClass: "upstream",
      detail: "503 upstream",
    });
    expect(validationPill(validation)).toBe(PROVIDER_ERROR_PILLS.upstream);
    expect(validationPill(validation)).toMatchObject({ tone: "warn", label: "degraded upstream" });
    expect(`△ ${validationNote(validation)}`).toBe("△ 503 upstream · retrying");
  });

  it("reports an answer that arrived far too late as the same degraded state", async () => {
    // It answered, and what it answered took six seconds. A `200` that slow describes a
    // provider in trouble, and the pill is the one the mockup already draws for that.
    recordResponses(recordedUser(), recordedBilling());
    measuring(6_000);

    const validation = await new CopilotAdapter().validate(COPILOT_CONFIG, COPILOT_SECRET);

    expect(validation).toEqual({
      status: "failed",
      errorClass: "upstream",
      detail: describeSlowUpstream(6_000),
    });
    expect(validationPill(validation)).toBe(PROVIDER_ERROR_PILLS.upstream);
    expect(validationNote(validation)).toBe("slow upstream (6000 ms) · retrying");
  });

  it("leaves an answer inside the threshold alone", async () => {
    recordResponses(recordedUser(), recordedBilling());
    measuring(COPILOT_SLOW_MS);

    const validation = await new CopilotAdapter().validate(COPILOT_CONFIG, COPILOT_SECRET);

    // Exactly at the threshold is not past it. A boundary a reader has to guess at is a
    // boundary that gets re-guessed at every call site.
    expect(validation).toMatchObject({ status: "ok", detail: "200 · 4 seats" });
    expect(isLatencyOutlier(COPILOT_SLOW_MS)).toBe(false);
    expect(isLatencyOutlier(COPILOT_SLOW_MS + 1)).toBe(true);
  });

  it("names the measurement rather than the threshold", () => {
    // An operator reading `slow upstream (6210 ms)` can tell how bad it was. A sentence quoting
    // the threshold would say the same thing about every slow call there has ever been.
    expect(describeSlowUpstream(6_210)).toBe("slow upstream (6210 ms)");
  });
});

describe("the bounded auto-retry", () => {
  it("converts a transient 503 into a healthy connection", async () => {
    // The case the retry exists for: a load balancer answering `503` while a node rotates.
    const responses = [recordedRefusal(503), recordedUser(), recordedBilling()];
    const spy = jest
      .spyOn(globalThis, "fetch")
      // One recorded response per call, in order, and nothing to await while doing it.
      // eslint-disable-next-line @typescript-eslint/require-await
      .mockImplementation(async () => responses.shift() ?? recordedUser());

    const validation = await new CopilotAdapter().validate(COPILOT_CONFIG, COPILOT_SECRET);

    expect(validation).toMatchObject({ status: "ok", detail: "200 · 4 seats" });
    // Two token checks and one billing lookup.
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("stops at the attempt bound rather than hammering a struggling upstream", async () => {
    // The first bound, and the one the ticket is explicit about: unbounded retry against a
    // provider that is already failing is how a status indicator becomes a denial-of-service
    // contribution.
    const spy = recordRepeatedly(() => recordedRefusal(503));

    const validation = await new CopilotAdapter().validate(COPILOT_CONFIG, COPILOT_SECRET);

    expect(spy).toHaveBeenCalledTimes(COPILOT_VALIDATE_ATTEMPTS);
    expect(validation).toMatchObject({ errorClass: "upstream" });
  });

  it("waits before asking again, so the retry is not part of the same burst", async () => {
    recordRepeatedly(() => recordedRefusal(503));

    const started = performance.now();
    await new CopilotAdapter().validate(COPILOT_CONFIG, COPILOT_SECRET);

    expect(performance.now() - started).toBeGreaterThanOrEqual(COPILOT_RETRY_BACKOFF_MS - 5);
  });

  it.each([
    ["a refused credential", 401],
    ["an address the provider does not serve", 404],
    ["a rate limit", 429],
  ])("does not retry %s", async (_description, status) => {
    // The retry condition is *the taxonomy said upstream*, which is what keeps this file from
    // holding a list of statuses of its own. A `429` is retryable in the table and still not
    // retried here — the next window is seconds away, and a second request inside it is the
    // thing the limit is asking for less of.
    const spy = recordRepeatedly(() => recordedRefusal(status));

    await new CopilotAdapter().validate(COPILOT_CONFIG, COPILOT_SECRET);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not retry a closed socket", async () => {
    const spy = recordFailure();

    await new CopilotAdapter().validate(COPILOT_CONFIG, COPILOT_SECRET);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not retry an attempt that was slow enough to spend the budget", async () => {
    // The second bound, and the interaction that makes the first one worth having: a failure
    // that came back fast leaves room for another attempt, and one that came back slowly has
    // already spent the budget. Doubling somebody's wait to re-ask a merely-slow server
    // converts nothing.
    const spy = recordRepeatedly(() => recordedUser());
    measuring(9_000);

    const validation = await new CopilotAdapter().validate(COPILOT_CONFIG, COPILOT_SECRET);

    expect(validation).toMatchObject({ errorClass: "upstream" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("bounds the whole call rather than only the attempt count", () => {
    // The budget charges the next attempt at its *deadline* rather than at what it will
    // probably take, because a bound that assumes the good case is not a bound.
    expect(hasRetryBudget(0)).toBe(true);
    expect(
      hasRetryBudget(COPILOT_VALIDATE_BUDGET_MS - COPILOT_RETRY_BACKOFF_MS - COPILOT_TIMEOUT_MS),
    ).toBe(true);
    expect(
      hasRetryBudget(
        COPILOT_VALIDATE_BUDGET_MS - COPILOT_RETRY_BACKOFF_MS - COPILOT_TIMEOUT_MS + 1,
      ),
    ).toBe(false);
    expect(hasRetryBudget(COPILOT_VALIDATE_BUDGET_MS)).toBe(false);
  });

  it("bounds the call more tightly than the attempt count alone would", () => {
    // Attempts alone would allow two full deadlines and the back-off between them. The budget
    // is deliberately below that, which is what makes the second bound do work rather than
    // restate the first.
    const worstCase =
      COPILOT_VALIDATE_ATTEMPTS * COPILOT_TIMEOUT_MS +
      (COPILOT_VALIDATE_ATTEMPTS - 1) * COPILOT_RETRY_BACKOFF_MS;

    expect(hasRetryBudget(worstCase)).toBe(false);
    expect(COPILOT_VALIDATE_BUDGET_MS).toBeLessThan(worstCase);
  });
});

describe("the Copilot adapter's fixed catalog", () => {
  it("answers mockup 07's chip without opening a socket", async () => {
    const spy = recordResponses(recordedUser());

    const models = await new CopilotAdapter().discoverModels(connection());

    expect(models).toEqual([
      {
        id: COPILOT_MODEL_ID,
        display: COPILOT_MODEL_DISPLAY,
        contextLength: COPILOT_MODEL_CONTEXT_TOKENS,
        sizeBytes: null,
        tier: null,
      },
    ]);
    // The whole point of a fixed catalog: there is nothing to ask.
    expect(spy).not.toHaveBeenCalled();
  });

  it("carries the provider's own id and the mockup's display separately", () => {
    // `model_aliases.model` and `model_prices.match_model` are written against the id, so an
    // adapter that prefixed it would break the join that makes a chip's price real. These are
    // the same two spellings `R__dev_seed_providers.sql` writes for the seeded connection.
    expect(COPILOT_MODEL_ID).toBe("gpt-5-codex");
    expect(COPILOT_MODEL_DISPLAY).toBe("copilot/gpt-5-codex");
  });

  it("publishes no tier, because Copilot publishes no per-model entitlement", async () => {
    // Decision P8. The Anthropic card's `priority tier` pill is earned from real response
    // headers; inventing a plausible-looking one here would make that pill unreadable too.
    const models = await new CopilotAdapter().discoverModels(connection());

    expect(models.every((model) => model.tier === null)).toBe(true);
  });

  it("answers the same rows every time, which is what makes the upsert an upsert", async () => {
    const adapter = new CopilotAdapter();

    const first = await adapter.discoverModels(connection());
    const second = await adapter.discoverModels(connection());

    expect(first).toEqual(second);
    expect(new Set(first.map((model) => model.id)).size).toBe(first.length);
  });

  it("hands out fresh objects rather than the module's own constant", async () => {
    const adapter = new CopilotAdapter();

    const first = await adapter.discoverModels(connection());
    (first[0] as { display: string }).display = "tampered";

    expect((await adapter.discoverModels(connection()))[0].display).toBe(COPILOT_MODEL_DISPLAY);
  });

  it("refuses a connection with no credential", async () => {
    // A connection nobody has finished configuring reaches no models, and answering a catalog
    // for one would put chips on a card that cannot be used.
    await expect(
      new CopilotAdapter().discoverModels(connection(COPILOT_CONFIG, null)),
    ).rejects.toThrow(ProviderAdapterError);
    await expect(
      new CopilotAdapter().discoverModels(connection(COPILOT_CONFIG, null)),
    ).rejects.toMatchObject({ errorClass: "config", detail: `${COPILOT_TOKEN_TITLE} required` });
  });

  it("rejects rather than throwing synchronously", async () => {
    // `@throws` on a member that answers a promise means the promise rejects. A synchronous
    // throw would be invisible to a caller holding the promise rather than awaiting it.
    const answer = new CopilotAdapter().discoverModels(connection(COPILOT_CONFIG, null));

    expect(answer).toBeInstanceOf(Promise);
    await expect(answer).rejects.toBeInstanceOf(ProviderAdapterError);
  });

  it("does not care about the organization, which discovery never reads", async () => {
    // Failing a discovery over a field discovery never reads would be inventing a dependency.
    // `validate` is where a malformed organization is reported.
    const models = await new CopilotAdapter().discoverModels(
      connection({ [COPILOT_ORGANIZATION_FIELD]: "acme/robotics" }),
    );

    expect(models).toHaveLength(1);
  });
});

describe("what the Copilot adapter's source may not contain", () => {
  const code = readFileSync(join(__dirname, "copilot.adapter.ts"), "utf8").replaceAll(
    /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
    "",
  );

  it("has no logger at all, which is the only durable version of never logged", () => {
    // AC.5's last acceptance criterion. A test that watched one call would pass for an adapter
    // that logs on a branch nobody arranged; what makes the claim stay true is that there is
    // nothing in the file to log with.
    expect(code).not.toContain("Logger");
    expect(code).not.toContain("console.");
  });

  it("holds no credential between calls", () => {
    // One instance serves every workspace. A field holding a plaintext token would be one
    // workspace's credential visible to the next request that touched this object. It is also
    // why the latency threshold is a constant: a per-connection baseline would be state.
    const adapter = new CopilotAdapter();

    expect(Object.values(adapter)).not.toContain(COPILOT_SECRET);
    expect(JSON.stringify(adapter)).not.toContain("ghu_");
  });

  it("reads exactly one response body, and it is the billing one", () => {
    // The token check reads none — the question was the status — and every refusal is
    // discarded. A second `response.json()` appearing in this file is a review conversation.
    expect(code.match(/response\.json\(\)/g)).toHaveLength(1);
  });
});

/**
 * `paramSchema` — CH.2's ([#585](https://github.com/NobuData/ouroboros/issues/585))
 * fixed-catalog case: *"minimal or empty tunables, stated as such rather than faked"*.
 */
describe("the Copilot param schema", () => {
  const adapter = new CopilotAdapter();

  it("offers nothing at all", () => {
    // Mockup 21's `coder-fallback` row draws `—` in its Params column, and this is why: Copilot
    // is a fixed catalog reached through a seat licence rather than a parameterised API.
    expect(Object.keys(adapter.paramSchema("gpt-5-codex").properties)).toEqual([]);
  });

  it("says why, rather than leaving an empty box", () => {
    // The rule the dialect enforces: an empty form that cannot explain itself is
    // indistinguishable from one that failed to load.
    expect(adapter.paramSchema("gpt-5-codex").description).toContain("fixed catalog");
  });

  it("mentions that the alias's restrictions still apply", () => {
    // The other half of the honest answer: a restriction is what this workspace allows the
    // alias to be used for, and it is offered on every alias whatever the provider publishes.
    expect(adapter.paramSchema("gpt-5-codex").description).toContain("Restrictions");
  });

  it("answers a schema in the dialect that the column can store", () => {
    expect(paramSchemaViolations(adapter.paramSchema("gpt-5-codex"))).toEqual([]);
    expect(storageViolations(adapter.paramSchema("gpt-5-codex"))).toEqual([]);
  });

  it("hands out a fresh value every call", () => {
    const first = adapter.paramSchema("gpt-5-codex") as { title: string };
    first.title = "tampered";

    expect(adapter.paramSchema("gpt-5-codex").title).toBe("GitHub Copilot model parameters");
  });
});
