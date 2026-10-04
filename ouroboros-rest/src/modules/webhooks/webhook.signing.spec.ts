import { FixtureReceiver, receivedHeaders } from "./webhook.receiver.fixture";
import {
  DELIVERY_HEADER,
  REPLAY_WINDOW_SECONDS,
  SECRET_PREFIX,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  mintSigningSecret,
  signatureOf,
  signedHeaders,
} from "./webhook.signing";

/**
 * The sender's half against the receiver's half (#487 acceptance criteria 1–2 and 7): a fixture
 * receiver written from `docs/WEBHOOKS.md`'s recipe — not from the signing code — accepts what
 * the sender signs, refuses a tampered body, refuses a replay outside the documented window, and
 * drops a second delivery of the same idempotency key.
 */

const SECRET = mintSigningSecret(Buffer.alloc(32, 7));
const SIGNED_AT = new Date("2026-10-04T12:00:00.000Z");
const BODY = JSON.stringify({
  id: "5f0c0000-0000-4000-8000-000000000001",
  type: "audit.provider.rotated",
  data: { subjectId: "conn-1" },
});

/** A request as the sender would make it, signed at {@link SIGNED_AT}. */
function signed(body = BODY, at = SIGNED_AT) {
  return {
    headers: receivedHeaders(
      signedHeaders({
        secret: SECRET,
        eventType: "audit.provider.rotated",
        deliveryKey: "5f0c0000-0000-4000-8000-000000000001",
        body,
        at,
      }),
    ),
    body,
  };
}

/** A receiver whose clock reads `offsetSeconds` after the signing instant. */
function receiverAt(offsetSeconds: number): FixtureReceiver {
  return new FixtureReceiver(SECRET, () => new Date(SIGNED_AT.getTime() + offsetSeconds * 1000));
}

describe("a signing secret", () => {
  it("is whsec_ and 32 random bytes in base64url", () => {
    const secret = mintSigningSecret();

    expect(secret.startsWith(SECRET_PREFIX)).toBe(true);
    expect(Buffer.from(secret.slice(SECRET_PREFIX.length), "base64url")).toHaveLength(32);
    expect(mintSigningSecret()).not.toBe(secret);
  });
});

describe("a signed attempt", () => {
  it("carries the event, the idempotency key, the timestamp and a v1 signature", () => {
    const headers = signedHeaders({
      secret: SECRET,
      eventType: "run.merged",
      deliveryKey: "key-1",
      body: BODY,
      at: SIGNED_AT,
    });

    expect(headers["X-Ouro-Event"]).toBe("run.merged");
    expect(headers[DELIVERY_HEADER]).toBe("key-1");
    expect(headers[TIMESTAMP_HEADER]).toBe(String(SIGNED_AT.getTime() / 1000));
    expect(headers[SIGNATURE_HEADER]).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("signs the timestamp with the body, so a changed timestamp breaks the signature", () => {
    expect(signatureOf(SECRET, 1_791_100_800, BODY)).not.toBe(
      signatureOf(SECRET, 1_791_100_801, BODY),
    );
  });

  it("never puts the secret in a header", () => {
    expect(JSON.stringify(signed().headers)).not.toContain(SECRET);
  });
});

describe("the documented receiver", () => {
  it("accepts what the sender signed", () => {
    const verdict = receiverAt(3).verify(signed());

    expect(verdict).toEqual({ accepted: true, event: JSON.parse(BODY) as unknown });
  });

  it("refuses a tampered body", () => {
    const request = signed();

    expect(
      receiverAt(3).verify({ ...request, body: request.body.replace("conn-1", "conn-2") }),
    ).toEqual({ accepted: false, reason: "bad_signature" });
  });

  it("refuses a signature made with another secret", () => {
    const forged = new FixtureReceiver(mintSigningSecret(), () => SIGNED_AT);

    expect(forged.verify(signed())).toEqual({ accepted: false, reason: "bad_signature" });
  });

  it("refuses a replay outside the window, either way, and accepts one just inside", () => {
    expect(receiverAt(REPLAY_WINDOW_SECONDS + 1).verify(signed())).toEqual({
      accepted: false,
      reason: "outside_replay_window",
    });
    expect(receiverAt(-(REPLAY_WINDOW_SECONDS + 1)).verify(signed())).toEqual({
      accepted: false,
      reason: "outside_replay_window",
    });
    expect(receiverAt(REPLAY_WINDOW_SECONDS).verify(signed()).accepted).toBe(true);
  });

  it("refuses a replay whose timestamp header was refreshed", () => {
    const request = signed();
    const refreshed = {
      ...request,
      headers: { ...request.headers, "x-ouro-timestamp": String(SIGNED_AT.getTime() / 1000 + 600) },
    };

    expect(receiverAt(600).verify(refreshed)).toEqual({
      accepted: false,
      reason: "bad_signature",
    });
  });

  it("drops a second delivery of the same idempotency key — at-least-once", () => {
    const receiver = receiverAt(1);

    expect(receiver.verify(signed()).accepted).toBe(true);
    // A retry is signed afresh, but carries the same X-Ouro-Delivery.
    expect(receiver.verify(signed(BODY, new Date(SIGNED_AT.getTime() + 1000)))).toEqual({
      accepted: false,
      reason: "duplicate",
    });
  });

  it("refuses a request with a header missing or a timestamp that is not a number", () => {
    const request = signed();
    const { "x-ouro-signature": _dropped, ...unsigned } = request.headers;

    expect(receiverAt(0).verify({ ...request, headers: unsigned })).toEqual({
      accepted: false,
      reason: "missing_headers",
    });
    expect(
      receiverAt(0).verify({
        ...request,
        headers: { ...request.headers, "x-ouro-timestamp": "soon" },
      }),
    ).toEqual({ accepted: false, reason: "bad_timestamp" });
  });
});
