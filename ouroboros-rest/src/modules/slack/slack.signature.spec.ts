import express from "express";
import request from "supertest";

import { captureSlackRawBody, type RawBodyRequest } from "./slack.raw-body";
import {
  SLACK_REPLAY_WINDOW_SECONDS,
  SLACK_SIGNATURE_HEADER,
  SLACK_TIMESTAMP_HEADER,
  slackSignature,
  verifySlackSignature,
} from "./slack.signature";

/**
 * The signature matrix (#535): valid, tampered body, tampered signature, stale timestamp, future
 * timestamp and missing headers — and the property the whole endpoint family stands on, that the
 * check is made over the **raw bytes** and not over a body some parser re-serialised.
 */

const SECRET = "8f742231b10e8888abcd99yyyzzz85a5";
const NOW = new Date("2026-10-12T14:07:00Z");
const TIMESTAMP = String(Math.floor(NOW.getTime() / 1000));
const BODY = Buffer.from('{"type":"event_callback","event_id":"Ev0PV52K21","team_id":"T024AB"}');

/** A correctly signed request, with whatever a case changes. */
function signed(overrides: Partial<Parameters<typeof verifySlackSignature>[0]> = {}) {
  return {
    signature: slackSignature(SECRET, TIMESTAMP, BODY),
    timestamp: TIMESTAMP,
    rawBody: BODY,
    ...overrides,
  };
}

describe("slackSignature", () => {
  it("is Slack's documented example: v0, the timestamp and the body, HMAC-SHA256, hex", () => {
    // The worked example from Slack's "Verifying requests from Slack".
    const body = Buffer.from(
      "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c",
    );

    expect(slackSignature("8f742231b10e8888abcd99yyyzzz85a5", "1531420618", body)).toBe(
      "v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503",
    );
  });
});

describe("verifySlackSignature — the matrix", () => {
  it("admits a request signed with the secret, now", () => {
    expect(verifySlackSignature(signed(), SECRET, NOW)).toEqual({ valid: true });
  });

  it("refuses a tampered body", () => {
    const tampered = Buffer.from(BODY.toString().replace("T024AB", "T0EVIL"));

    expect(verifySlackSignature(signed({ rawBody: tampered }), SECRET, NOW)).toEqual({
      valid: false,
      problem: "signature_mismatch",
    });
  });

  it("refuses a body that differs by one byte of whitespace — the bytes are what was signed", () => {
    const reserialised = Buffer.from(JSON.stringify(JSON.parse(BODY.toString()), null, 1));

    expect(verifySlackSignature(signed({ rawBody: reserialised }), SECRET, NOW)).toEqual({
      valid: false,
      problem: "signature_mismatch",
    });
  });

  it("refuses a tampered signature", () => {
    const signature = slackSignature(SECRET, TIMESTAMP, BODY).replace(/.$/, (last) =>
      last === "0" ? "1" : "0",
    );

    expect(verifySlackSignature(signed({ signature }), SECRET, NOW)).toEqual({
      valid: false,
      problem: "signature_mismatch",
    });
  });

  it("refuses a signature made with another secret", () => {
    const signature = slackSignature("another-secret-entirely-0123456789", TIMESTAMP, BODY);

    expect(verifySlackSignature(signed({ signature }), SECRET, NOW)).toEqual({
      valid: false,
      problem: "signature_mismatch",
    });
  });

  it("refuses a signature of another length without throwing", () => {
    expect(verifySlackSignature(signed({ signature: "v0=abc" }), SECRET, NOW)).toEqual({
      valid: false,
      problem: "signature_mismatch",
    });
  });

  it("refuses a stale timestamp, even correctly signed — a captured request stops working", () => {
    const stale = String(Number(TIMESTAMP) - SLACK_REPLAY_WINDOW_SECONDS - 1);

    expect(
      verifySlackSignature(
        signed({ timestamp: stale, signature: slackSignature(SECRET, stale, BODY) }),
        SECRET,
        NOW,
      ),
    ).toEqual({ valid: false, problem: "stale_timestamp" });
  });

  it("refuses a future timestamp, even correctly signed — a clock set ahead widens nothing", () => {
    const future = String(Number(TIMESTAMP) + SLACK_REPLAY_WINDOW_SECONDS + 1);

    expect(
      verifySlackSignature(
        signed({ timestamp: future, signature: slackSignature(SECRET, future, BODY) }),
        SECRET,
        NOW,
      ),
    ).toEqual({ valid: false, problem: "future_timestamp" });
  });

  it.each([
    ["five minutes ago", -SLACK_REPLAY_WINDOW_SECONDS],
    ["five minutes ahead", SLACK_REPLAY_WINDOW_SECONDS],
  ])("admits a timestamp exactly at the edge of the window: %s", (_label, skew) => {
    const edge = String(Number(TIMESTAMP) + skew);

    expect(
      verifySlackSignature(
        signed({ timestamp: edge, signature: slackSignature(SECRET, edge, BODY) }),
        SECRET,
        NOW,
      ),
    ).toEqual({ valid: true });
  });

  it.each([
    ["no signature header", { signature: undefined }, "missing_signature"],
    ["an empty signature header", { signature: "" }, "missing_signature"],
    ["no timestamp header", { timestamp: undefined }, "missing_timestamp"],
    ["an empty timestamp header", { timestamp: "" }, "missing_timestamp"],
    ["a timestamp that is not a whole number", { timestamp: "1e9" }, "malformed_timestamp"],
    ["a timestamp with a sign", { timestamp: `-${TIMESTAMP}` }, "malformed_timestamp"],
    ["no raw body kept", { rawBody: undefined }, "missing_body"],
  ])("refuses %s", (_label, overrides, problem) => {
    expect(verifySlackSignature(signed(overrides), SECRET, NOW)).toEqual({ valid: false, problem });
  });

  it("admits an empty body that was signed as empty", () => {
    const empty = Buffer.alloc(0);

    expect(
      verifySlackSignature(
        signed({ rawBody: empty, signature: slackSignature(SECRET, TIMESTAMP, empty) }),
        SECRET,
        NOW,
      ),
    ).toEqual({ valid: true });
  });
});

describe("the raw body, through the real parsers", () => {
  /** An app whose parsers carry the hook exactly as `auth/auth.module.ts` gives it to them. */
  /** What the echo route answered. */
  function bodyOf(response: { body: unknown }): { kept: boolean; verdict: unknown } {
    return response.body as { kept: boolean; verdict: unknown };
  }

  function app(): express.Express {
    const server = express();

    server.use(express.json({ verify: captureSlackRawBody }));
    server.use(express.urlencoded({ extended: true, verify: captureSlackRawBody }));
    server.post(/.*/, (req, res) => {
      const raw = (req as RawBodyRequest).rawBody;

      res.json({
        kept: raw !== undefined,
        verdict: verifySlackSignature(
          {
            signature: req.header(SLACK_SIGNATURE_HEADER),
            timestamp: req.header(SLACK_TIMESTAMP_HEADER),
            rawBody: raw,
          },
          SECRET,
          NOW,
        ),
        // What a handler that re-serialised the parsed body would have verified instead.
        reserialisedMatches: raw?.toString() === JSON.stringify(req.body),
      });
    });

    return server;
  }

  it("verifies a JSON event over the bytes Slack sent, though they do not survive a re-serialise", async () => {
    // Slack's own spacing and key order — not what JSON.stringify would produce.
    const sent = '{ "type":"event_callback",  "team_id" : "T024AB","event_id":"Ev1" }';

    const response = await request(app())
      .post("/api/v1/slack/events")
      .set("content-type", "application/json")
      .set(SLACK_TIMESTAMP_HEADER, TIMESTAMP)
      .set(SLACK_SIGNATURE_HEADER, slackSignature(SECRET, TIMESTAMP, Buffer.from(sent)))
      .send(sent);

    expect(response.body).toEqual({
      kept: true,
      verdict: { valid: true },
      reserialisedMatches: false,
    });
  });

  it("verifies a form-encoded slash command — the urlencoded parser carries the hook too", async () => {
    const sent =
      "team_id=T024AB&user_id=U07KEN&command=%2Fouro&text=link&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2F1";

    const response = await request(app())
      .post("/api/v1/slack/commands")
      .set("content-type", "application/x-www-form-urlencoded")
      .set(SLACK_TIMESTAMP_HEADER, TIMESTAMP)
      .set(SLACK_SIGNATURE_HEADER, slackSignature(SECRET, TIMESTAMP, Buffer.from(sent)))
      .send(sent);

    expect(bodyOf(response).kept).toBe(true);
    expect(bodyOf(response).verdict).toEqual({ valid: true });
  });

  it("refuses a form whose bytes were changed after signing", async () => {
    const signedFor = "team_id=T024AB&user_id=U07KEN&text=link";

    const response = await request(app())
      .post("/api/v1/slack/commands")
      .set("content-type", "application/x-www-form-urlencoded")
      .set(SLACK_TIMESTAMP_HEADER, TIMESTAMP)
      .set(SLACK_SIGNATURE_HEADER, slackSignature(SECRET, TIMESTAMP, Buffer.from(signedFor)))
      .send("team_id=T024AB&user_id=U07MAYA&text=link");

    expect(bodyOf(response).verdict).toEqual({ valid: false, problem: "signature_mismatch" });
  });

  it("keeps no raw body for a request outside the Slack family", async () => {
    const response = await request(app())
      .post("/api/v1/workflows")
      .set("content-type", "application/json")
      .send('{"name":"x"}');

    expect(bodyOf(response).kept).toBe(false);
  });
});
