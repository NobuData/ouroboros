import type { AppConfigService } from "../config/config.service";
import { FakeSlackApi, slackConfig } from "./slack.fixture";
import { COMMAND_ACK, type SlackInboundService } from "./slack.inbound.service";
import {
  RECONNECT_MIN_MS,
  type SlackSocket,
  SlackSocketMode,
  acknowledge,
} from "./slack.socket-mode";

/**
 * Socket Mode (#535) — the development transport: the same handlers, a socket instead of three
 * URLs, every envelope acknowledged, and a reconnect when Slack closes the connection.
 */

/** A socket a test drives by hand. */
class FakeSocket implements SlackSocket {
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners: Record<string, ((data: { toString(): string }) => void)[]> = {};

  on(event: string, listener: (data: { toString(): string }) => void): this {
    (this.listeners[event] ??= []).push(listener);

    return this;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.emit("close", "");
  }

  /** Deliver something from Slack. */
  emit(event: string, data: unknown): void {
    for (const listener of this.listeners[event] ?? []) {
      listener({ toString: () => (typeof data === "string" ? data : JSON.stringify(data)) });
    }
  }
}

/** Handlers that record what they were given. */
function handlers() {
  return {
    event: jest.fn().mockReturnValue({}),
    command: jest.fn().mockReturnValue(COMMAND_ACK),
    interaction: jest.fn().mockReturnValue({}),
  };
}

/** A transport over fakes. */
function setup(
  config: Record<string, unknown> = { slackSocketMode: true, slackAppToken: "xapp-1-A0-1-abc" },
) {
  const slack = new FakeSlackApi();
  const inbound = handlers();
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  const transport = new SlackSocketMode(
    slackConfig(config) as unknown as AppConfigService,
    slack,
    inbound as unknown as SlackInboundService,
    (url) => {
      const socket = new FakeSocket();

      urls.push(url);
      sockets.push(socket);

      return socket;
    },
  );

  return { transport, slack, inbound, sockets, urls };
}

describe("acknowledge", () => {
  it("hands an event to the events handler and acknowledges its envelope", () => {
    const inbound = handlers();
    const payload = { type: "event_callback", event_id: "Ev1" };

    expect(acknowledge(inbound, { envelope_id: "e1", type: "events_api", payload })).toEqual({
      envelope_id: "e1",
    });
    expect(inbound.event).toHaveBeenCalledWith(payload);
  });

  it("acknowledges a slash command with the same honest ack the HTTP endpoint returns", () => {
    const inbound = handlers();

    expect(
      acknowledge(inbound, {
        envelope_id: "e2",
        type: "slash_commands",
        payload: { text: "link" },
      }),
    ).toEqual({
      envelope_id: "e2",
      payload: COMMAND_ACK,
    });
    expect(inbound.command).toHaveBeenCalledWith({ text: "link" });
  });

  it("hands an interaction's payload object to the interactivity handler", () => {
    const inbound = handlers();

    expect(
      acknowledge(inbound, {
        envelope_id: "e3",
        type: "interactive",
        payload: { type: "block_actions" },
      }),
    ).toEqual({
      envelope_id: "e3",
    });
    expect(inbound.interaction).toHaveBeenCalledWith({ type: "block_actions" });
  });

  it("acknowledges an envelope type it does not know, so Slack stops redelivering it", () => {
    expect(acknowledge(handlers(), { envelope_id: "e4", type: "something_new" })).toEqual({
      envelope_id: "e4",
    });
  });

  it("answers nothing to a message that is not an envelope", () => {
    expect(acknowledge(handlers(), { type: "hello" })).toBeUndefined();
  });
});

describe("SlackSocketMode", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("stays off unless the deployment turned it on", async () => {
    const { transport, sockets } = setup({ slackSocketMode: false });

    transport.onApplicationBootstrap();
    await Promise.resolve();

    expect(sockets).toEqual([]);
  });

  it("opens a connection with the app-level token and connects to the URL Slack gives", async () => {
    const { transport, urls } = setup();

    await transport.connect();

    expect(urls).toEqual(["wss://wss.slack.example/link"]);
  });

  it("acknowledges each envelope over the socket it arrived on", async () => {
    const { transport, sockets, inbound } = setup();
    await transport.connect();

    sockets[0].emit("message", { type: "hello" });
    sockets[0].emit("message", {
      envelope_id: "e1",
      type: "slash_commands",
      payload: { text: "link" },
    });

    expect(sockets[0].sent.map((message) => JSON.parse(message) as unknown)).toEqual([
      { envelope_id: "e1", payload: COMMAND_ACK },
    ]);
    expect(inbound.command).toHaveBeenCalledTimes(1);
  });

  it("ignores a message that is not JSON", async () => {
    const { transport, sockets } = setup();
    await transport.connect();

    expect(() => sockets[0].emit("message", "not json")).not.toThrow();
    expect(sockets[0].sent).toEqual([]);
  });

  it("reconnects when Slack asks it to disconnect", async () => {
    jest.useFakeTimers();
    const { transport, sockets } = setup();
    await transport.connect();

    sockets[0].emit("message", { type: "disconnect", reason: "refresh_requested" });
    expect(sockets[0].closed).toBe(true);

    await jest.advanceTimersByTimeAsync(RECONNECT_MIN_MS);

    expect(sockets).toHaveLength(2);
  });

  it("backs off and tries again when Slack will not open a connection", async () => {
    jest.useFakeTimers();
    const { transport, slack, sockets } = setup();
    slack.socket = { ok: false, error: "invalid_auth" };

    await transport.connect();
    expect(sockets).toEqual([]);

    slack.socket = { ok: true, url: "wss://wss.slack.example/again" };
    await jest.advanceTimersByTimeAsync(RECONNECT_MIN_MS);

    expect(sockets).toHaveLength(1);
  });

  it("closes the socket and stops reconnecting at shutdown", async () => {
    jest.useFakeTimers();
    const { transport, sockets } = setup();
    await transport.connect();

    transport.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(sockets[0].closed).toBe(true);
    expect(sockets).toHaveLength(1);
  });
});
