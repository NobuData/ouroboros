import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { channels, chatRoutes, connection, onCall } from "../helpers/chatops";
import { grammar } from "../helpers/console";

/**
 * The Chat Ops page's reads (#541): the connection and the channels together, a failed channel
 * list kept as a value so it costs only the lists — for the first paint and for the poll alike.
 */

const readConnection = vi.fn();
const readChannels = vi.fn();
const readGrammar = vi.fn();
const readRoutes = vi.fn();
const readOnCall = vi.fn();
const anonymous = { anonymous: true };

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/server", () => ({ anonymousApi: () => anonymous }));
vi.mock("@/app/api/chatops", () => ({
  chatops: {
    connection: (client: unknown, signal: unknown) => readConnection(client, signal),
    channels: (client: unknown, signal: unknown) => readChannels(client, signal),
    onCall: (client: unknown, signal: unknown) => readOnCall(client, signal),
  },
}));
vi.mock("@/app/api/console", () => ({
  consoleApi: { grammar: (client: unknown, signal: unknown) => readGrammar(client, signal) },
}));
vi.mock("@/app/api/settings-integrations", () => ({
  settingsIntegrations: { routes: (client: unknown, signal: unknown) => readRoutes(client, signal) },
}));

const { loadChatOps, readChatOps } = await import("@/app/chatops/chatops-data");
const { readChatOpsPage } = await import("@/app/api/chatops-page");
const { GET } = await import("@/app/api/chatops/route");

beforeEach(() => {
  readConnection.mockReset().mockResolvedValue(connection());
  readChannels.mockReset().mockResolvedValue(channels());
  readGrammar.mockReset().mockResolvedValue(grammar());
  readRoutes.mockReset().mockResolvedValue(chatRoutes());
  readOnCall.mockReset().mockResolvedValue(onCall());
});

/** The three readings #543 added, as they stand when each read answered. */
const BESIDE = {
  grammar: { ok: true, value: grammar() },
  routes: { ok: true, value: chatRoutes() },
  onCall: { ok: true, value: onCall() },
};

describe("the first paint", () => {
  it("reads the connection and the channels, and stamps when", async () => {
    const readings = await readChatOps();

    expect(readings.page).toEqual({
      ok: true,
      value: { connection: connection(), channels: { ok: true, value: channels() }, ...BESIDE },
    });
    expect(Number.isNaN(Date.parse(readings.readAt))).toBe(false);
  });

  it("keeps a refused channel list as a value beside the connection", async () => {
    readChannels.mockRejectedValueOnce(new ApiError(502, "slack_unavailable", "Slack did not answer."));

    expect(await loadChatOps()).toEqual({
      connection: connection(),
      channels: { ok: false, reason: "Slack did not answer." },
      ...BESIDE,
    });
  });

  it("keeps a refused grammar, routes or on-call read as a value of its own (#543)", async () => {
    readGrammar.mockRejectedValueOnce(new ApiError(500, "internal", "The grammar could not be loaded."));
    readRoutes.mockRejectedValueOnce(new ApiError(500, "internal", "The routes could not be loaded."));
    readOnCall.mockRejectedValueOnce(new ApiError(404, "not_found", "No such route."));

    expect(await loadChatOps()).toEqual({
      connection: connection(),
      channels: { ok: true, value: channels() },
      grammar: { ok: false, reason: "The grammar could not be loaded." },
      routes: { ok: false, reason: "The routes could not be loaded." },
      onCall: { ok: false, reason: "No such route." },
    });
  });

  it("is a failed reading, with the service's sentence, when the connection is refused", async () => {
    readConnection.mockRejectedValueOnce(new ApiError(500, "internal", "The connection could not be loaded."));

    expect((await readChatOps()).page).toEqual({ ok: false, reason: "The connection could not be loaded." });
  });
});

describe("the poll's read", () => {
  it("answers the page through the anonymous client, asking to be asked again in 15 s", async () => {
    const answer = await readChatOpsPage();

    expect(answer).toMatchObject({ state: "fresh", pollAfterSeconds: 15 });
    expect(readConnection.mock.calls[0]![0]).toBe(anonymous);
    expect(readConnection.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
    for (const read of [readGrammar, readRoutes, readOnCall]) {
      expect(read.mock.calls[0]![0]).toBe(anonymous);
      expect(read.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
    }
  });

  it("reports a session that ended as gone, and any other refusal in the service's words", async () => {
    readConnection.mockRejectedValueOnce(new ApiError(401, "unauthenticated", "Sign in."));
    expect(await readChatOpsPage()).toEqual({ state: "gone" });

    readConnection.mockRejectedValueOnce(new ApiError(500, "internal", "The connection could not be loaded."));
    expect(await readChatOpsPage()).toMatchObject({
      state: "failed",
      reason: "The connection could not be loaded.",
      pollAfterSeconds: 15,
    });
  });

  it("is served at this origin's route, with its cadence in the header", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Ouro-Poll-After")).toBe("15");
    expect(await response.json()).toMatchObject({
      connection: { state: "connected" },
      channels: { ok: true },
      grammar: { ok: true },
      routes: { ok: true },
      onCall: { ok: true },
    });
  });
});
