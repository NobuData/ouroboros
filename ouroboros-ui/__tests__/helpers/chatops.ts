import type { SlackChannel, SlackChannels, SlackConnection } from "@/app/api/chatops";
import type { ChatOpsPage } from "@/app/chatops/view";

/**
 * Fixtures for the Chat Ops page (#541): a connection in each of its five states, the seeded
 * workspace's channels, and the poll answer a screen suite hands its loop.
 */

/** The instant every fixture is aged against — the page's `readAt`. */
export const CHATOPS_READ_AT = "2026-10-12T14:00:00.000Z";

/** Where the install starts, as the service names it. */
export const INSTALL_PATH = "/api/v1/slack/oauth/install";

/** The sentence the service refuses a bind with when the bot is not in the channel. */
export const NOT_JOINED_MESSAGE =
  "Ouroboros is not a member of #helios-private. Invite it with /invite @Ouroboros, then try again.";

/**
 * A connection — connected and healthy unless told otherwise.
 *
 * @param over What differs.
 * @returns The connection.
 */
export function connection(over: Partial<SlackConnection> = {}): SlackConnection {
  return {
    state: "connected",
    configured: true,
    installPath: INSTALL_PATH,
    connectionId: "5eed0541-0000-4000-8000-000000000001",
    workspace: { id: "T024AB", name: "acme-robotics" },
    appId: "A0541",
    appVersion: "v2.4",
    scopes: ["chat:write", "channels:read", "groups:read"],
    missingScopes: [],
    statusDetail: null,
    installedAt: "2026-10-01T09:00:00.000Z",
    lastVerifiedAt: "2026-10-12T13:58:00.000Z",
    channels: { total: 4, joined: 3 },
    socketMode: false,
    delivery: { state: "idle" } as SlackConnection["delivery"],
    ...over,
  };
}

/** A deployment that registered no Slack app. */
export function notConfigured(): SlackConnection {
  return connection({
    state: "not_configured",
    configured: false,
    installPath: null,
    connectionId: null,
    workspace: null,
    appId: null,
    appVersion: null,
    scopes: [],
    installedAt: null,
    lastVerifiedAt: null,
    channels: { total: 0, joined: 0 },
  });
}

/** An app this workspace has not installed. */
export function notConnected(): SlackConnection {
  return { ...notConfigured(), state: "not_connected", configured: true, installPath: INSTALL_PATH };
}

/** A connection Slack revoked, with its reason. */
export function revoked(): SlackConnection {
  return connection({ state: "revoked", statusDetail: "app_uninstalled" });
}

/**
 * One channel — public, joined and unbound unless told otherwise.
 *
 * @param name Its name, without the `#`.
 * @param over What differs.
 * @returns The channel.
 */
export function channel(name: string, over: Partial<SlackChannel> = {}): SlackChannel {
  return {
    id: `5eed0541-0000-4000-8000-${name.length.toString().padStart(4, "0")}${[...name]
      .reduce((sum, letter) => sum + letter.charCodeAt(0), 0)
      .toString()
      .padStart(8, "0")}`,
    platformChannelId: `C0${name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6)}`,
    name,
    isPrivate: false,
    joined: true,
    memberCount: 24,
    purpose: null,
    archived: false,
    url: `https://app.slack.com/client/T024AB/C0${name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6)}`,
    routes: [],
    ...over,
  };
}

/** The four channels a freshly connected workspace lists: nothing bound, one private and unjoined, one archived. */
export function unboundChannels(): SlackChannel[] {
  return [
    channel("ouroboros-loops"),
    channel("helios-alerts", { memberCount: 9 }),
    channel("helios-private", { isPrivate: true, joined: false, memberCount: null }),
    channel("old-builds", { archived: true }),
  ];
}

/** The same workspace once its loops and alerts channels are bound. */
export function boundChannelList(): SlackChannel[] {
  return [
    channel("ouroboros-loops", { purpose: "loops", routes: ["blocking_question", "loop_finished"] }),
    channel("helios-alerts", { purpose: "alerts", memberCount: 9, routes: ["build_failure"] }),
    channel("helios-private", { isPrivate: true, joined: false, memberCount: null }),
    channel("old-builds", { archived: true }),
  ];
}

/**
 * The channels payload.
 *
 * @param list The channels. Defaults to the unbound workspace's.
 * @param over What differs.
 * @returns The payload.
 */
export function channels(list: SlackChannel[] = unboundChannels(), over: Partial<SlackChannels> = {}): SlackChannels {
  return { connected: true, refreshedAt: "2026-10-12T13:55:00.000Z", channels: list, ...over };
}

/**
 * The page's payload.
 *
 * @param of The connection, and the channels beside it.
 * @returns The page.
 */
export function chatOpsPage(of: { connection?: SlackConnection; channels?: SlackChannels } = {}): ChatOpsPage {
  const conn = of.connection ?? connection();

  return {
    connection: conn,
    channels: {
      ok: true,
      value: of.channels ?? (conn.state === "connected" ? channels() : channels([], { connected: false, refreshedAt: null })),
    },
  };
}

/**
 * A poll's answer carrying a page — the shape `createPoll` reads.
 *
 * @param payload The page.
 * @returns The answer.
 */
export function fresh(payload: ChatOpsPage) {
  return { state: "fresh" as const, payload, etag: null, pollAfterSeconds: 15 };
}

/** A promise a test settles by hand — never left hanging, which poisons later cases. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}
