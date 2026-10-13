/**
 * Signatures, replay and redelivery, against the listening application (BZ.6,
 * [#540](https://github.com/NobuData/ouroboros/issues/540)).
 *
 * `slack.signature.spec.ts` proves the function. This proves it is **load-bearing**: that the
 * three inbound routes are behind it in the application as it is actually assembled — global
 * guards, body parsers and all — and that a request it refuses changes nothing. The raw-body
 * cases are the ones a middleware reorder breaks silently: the bytes verified must be the bytes
 * that arrived, not a re-serialisation of what a parser made of them.
 *
 * **Negative control.** With `SlackSignatureGuard.canActivate` made to return `true`, every
 * *refuses* case here goes red (#540's first mutation).
 */

import { ACME, ChatBench } from "../../testing/chatops.bench.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import {
  SLACK_APP,
  SLACK_COMMANDS,
  SLACK_EVENTS,
  SLACK_INTERACTIVITY,
  type Tamper,
} from "../../testing/slack.harness.fixture";
import { COMMAND_ACK } from "./slack.inbound.service";
import { SLACK_REPLAY_WINDOW_SECONDS, slackSignature } from "./slack.signature";

/** Epoch seconds, offset from now. */
function secondsFromNow(offset: number): string {
  return String(Math.floor(Date.now() / 1000) + offset);
}

/** Every way a request can fail to be Slack's, by name. */
const REFUSED: readonly (readonly [string, Tamper])[] = [
  ["a tampered body", { sentBody: "team_id=T0ACME&user_id=U0KEN&text=pause+all+confirm" }],
  ["a tampered signature", { signature: `v0=${"0".repeat(64)}` }],
  ["a signature made with another secret", { secret: "some-other-apps-signing-secret-0001" }],
  ["a signature of the wrong shape", { signature: "v0=abc" }],
  ["no signature header", { omit: ["signature"] }],
  ["no timestamp header", { omit: ["timestamp"] }],
  ["neither header", { omit: ["signature", "timestamp"] }],
  ["a stale timestamp", { timestamp: secondsFromNow(-(SLACK_REPLAY_WINDOW_SECONDS + 30)) }],
  ["a future timestamp", { timestamp: secondsFromNow(SLACK_REPLAY_WINDOW_SECONDS + 30) }],
  ["a timestamp that is not one", { timestamp: "1e9" }],
];

describe("Slack's signature, on the listening application", () => {
  let bench: ChatBench;

  beforeAll(async () => {
    bench = await ChatBench.start();
  });

  afterAll(() => bench.close());
  afterEach(() => bench.reset());

  describe.each(REFUSED)("%s", (_name, tamper) => {
    it("is refused on the commands route, and nothing runs", async () => {
      const { owner } = await bench.connected();
      await bench.link(ACME, "U0KEN", owner);
      bench.slack.replies.length = 0;

      const emitted = await bench.slack.emitCommand(
        { team: ACME.id, user: "U0KEN", text: "status" },
        tamper,
      );

      expect(emitted.response.status).toBe(401);
      expect(bodyOf<{ code: string }>(emitted.response).code).toBe("slack_signature_invalid");

      await bench.idle();

      expect(bench.slack.replies).toEqual([]);
      expect(await bench.rows("chat_commands")).toEqual([]);
    });

    it("is refused on the events and interactivity routes", async () => {
      // A body swapped after signing is swapped for one the route's own parser accepts, so the
      // refusal is the guard's and not a parse error's.
      const swapped = (sentBody: string): Tamper =>
        tamper.sentBody === undefined ? tamper : { ...tamper, sentBody };
      const event = await bench.slack.emitEvent(
        {
          type: "event_callback",
          team_id: ACME.id,
          event_id: "Ev1",
          event: { type: "app_uninstalled" },
        },
        swapped(JSON.stringify({ type: "url_verification", challenge: "forged" })),
      );
      const press = await bench.slack.emitPress(
        { team: ACME.id, user: "U0KEN", action: { actionId: "x", value: "y" }, message: null },
        swapped("payload=%7B%22type%22%3A%22block_actions%22%7D"),
      );

      expect(event.response.status).toBe(401);
      expect(press.response.status).toBe(401);
    });
  });

  it("says nothing about which check failed", async () => {
    const stale = await bench.slack.emitCommand(
      { team: ACME.id, user: "U0KEN", text: "status" },
      { timestamp: secondsFromNow(-3600) },
    );
    const forged = await bench.slack.emitCommand(
      { team: ACME.id, user: "U0KEN", text: "status" },
      { signature: `v0=${"f".repeat(64)}` },
    );

    expect(stale.response.body).toEqual(forged.response.body);
  });

  it("admits a request signed as Slack signs it, on each route", async () => {
    const command = await bench.slack.emitCommand({ team: ACME.id, user: "U0KEN", text: "help" });
    const event = await bench.slack.emitEvent({ type: "event_callback", team_id: ACME.id });
    const press = await bench.slack.emitPress({
      team: ACME.id,
      user: "U0KEN",
      action: { actionId: "x", value: "y" },
      message: null,
    });

    expect(command.response.status).toBe(200);
    expect(command.response.body).toEqual(COMMAND_ACK);
    expect(event.response.status).toBe(200);
    expect(press.response.status).toBe(200);
  });

  it("verifies the bytes that arrived, not a re-serialisation of them", async () => {
    // The same JSON value, three ways: a parser makes one object of all of them, and only the
    // bytes tell them apart.
    const spaced = '{ "type" : "url_verification" ,\n  "challenge" : "c-1" ,"token":"t" }';
    const compact = JSON.stringify(JSON.parse(spaced));
    const escaped = '{"type":"url_verification","challenge":"c\\u002d1","token":"t"}';

    for (const body of [spaced, compact, escaped]) {
      const honest = await bench.slack.send(SLACK_EVENTS, body, "application/json");

      expect(honest.response.status).toBe(200);
      expect(honest.response.body).toEqual({ challenge: "c-1" });
    }

    // Signed over one serialisation, sent as another: the value is identical, the bytes are not.
    const swapped = await bench.slack.send(SLACK_EVENTS, spaced, "application/json", {
      sentBody: compact,
    });

    expect(swapped.response.status).toBe(401);
  });

  it("verifies a form body byte for byte too", async () => {
    const plus = "team_id=T0ACME&user_id=U0KEN&text=help+status&response_url=";
    const percent = "team_id=T0ACME&user_id=U0KEN&text=help%20status&response_url=";

    for (const path of [SLACK_COMMANDS, SLACK_INTERACTIVITY]) {
      const honest = await bench.slack.send(path, plus, "application/x-www-form-urlencoded");
      const swapped = await bench.slack.send(path, plus, "application/x-www-form-urlencoded", {
        sentBody: percent,
      });

      expect(honest.response.status).toBe(200);
      expect(swapped.response.status).toBe(401);
    }
  });

  it("answers the URL-verification handshake with the challenge", async () => {
    const emitted = await bench.slack.emitEvent({
      type: "url_verification",
      challenge: "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P",
      token: "legacy-verification-token",
    });

    expect(emitted.response.status).toBe(200);
    expect(emitted.response.body).toEqual({
      challenge: "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P",
    });
  });

  it("refuses an unsigned handshake: the challenge is not an oracle", async () => {
    const emitted = await bench.slack.emitEvent(
      { type: "url_verification", challenge: "c" },
      { omit: ["signature"] },
    );

    expect(emitted.response.status).toBe(401);
    expect(emitted.response.body).not.toHaveProperty("challenge");
  });

  it("refuses a captured request replayed after the window, signature intact", async () => {
    const timestamp = secondsFromNow(-(SLACK_REPLAY_WINDOW_SECONDS + 5));
    const body = JSON.stringify({ type: "url_verification", challenge: "replayed" });
    const replayed = await bench.slack.send(SLACK_EVENTS, body, "application/json", {
      timestamp,
      // Exactly what Slack sent, five minutes ago.
      signature: slackSignature(SLACK_APP.signingSecret, timestamp, Buffer.from(body)),
    });

    expect(replayed.response.status).toBe(401);
  });

  it("acts on an event once, however often Slack redelivers it", async () => {
    const { owner, workspace } = await bench.connected();
    const status = async () =>
      (
        await bench.rows<{ status: string }>("chat_connections", "organization_id = $1", [
          workspace.id,
        ])
      ).map((row) => row.status);
    const uninstalled = (eventId: string) => ({
      type: "event_callback",
      team_id: ACME.id,
      event_id: eventId,
      event: { type: "app_uninstalled" },
    });

    expect((await bench.slack.emitEvent(uninstalled("Ev0FIRST"))).response.status).toBe(200);
    await bench.idle();
    expect(await status()).toEqual(["revoked"]);

    // Installed again. A redelivery of the old event is about the install that is over.
    await bench.install(owner, workspace, ACME);
    expect(await status()).toEqual(["active"]);

    for (let again = 0; again < 3; again += 1) {
      // Acknowledged every time, so Slack stops; acted on never again.
      expect((await bench.slack.redeliver()).response.status).toBe(200);
    }
    await bench.idle();
    expect(await status()).toEqual(["active"]);

    // The control: a *new* event of the same kind does act.
    await bench.slack.emitEvent(uninstalled("Ev0SECOND"));
    await bench.idle();
    expect(await status()).toEqual(["revoked"]);
  });
});
