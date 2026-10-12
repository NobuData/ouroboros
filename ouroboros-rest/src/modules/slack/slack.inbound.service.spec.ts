import type { AuditService } from "../audit/audit.service";
import type { AppConfigService } from "../config/config.service";
import type { DatabaseService } from "../db/db.service";
import type { VaultService } from "../vault/vault.service";
import {
  FakeSlackApi,
  FakeSlackStore,
  FakeVault,
  KEN,
  MAYA,
  ORG,
  RecordingAudit,
  SLACK_MAYA,
  TEAM,
  slackConfig,
} from "./slack.fixture";
import {
  COMMAND_ACK,
  REPLIES,
  SlackInboundService,
  interactionPayload,
  subcommandOf,
} from "./slack.inbound.service";
import { SlackInstallService } from "./slack.install.service";
import { SlackLinkService } from "./slack.link.service";
import type { SlackRepository } from "./slack.repository";

/**
 * What a verified request does (#535): acknowledged at once, worked on afterwards, answered in a
 * separate message; an event processed once however often it is delivered.
 */

const RESPONSE_URL = "https://hooks.slack.com/commands/T024AB/1/abc";

const database = {
  db: {
    selectFrom: () => ({
      select: () => ({
        where: () => ({ executeTakeFirst: () => Promise.resolve({ name: "Acme Robotics" }) }),
      }),
    }),
  },
} as unknown as DatabaseService;

/** The handlers over fakes, with Slack installed. */
async function setup() {
  const slack = new FakeSlackApi();
  const store = new FakeSlackStore();
  const audit = new RecordingAudit();
  const config = slackConfig() as unknown as AppConfigService;
  const installs = new SlackInstallService(
    config,
    slack,
    store as unknown as SlackRepository,
    new FakeVault() as unknown as VaultService,
    audit as unknown as AuditService,
  );
  const links = new SlackLinkService(
    config,
    slack,
    store as unknown as SlackRepository,
    installs,
    audit as unknown as AuditService,
    database,
  );
  const inbound = new SlackInboundService(
    slack,
    store as unknown as SlackRepository,
    installs,
    links,
  );
  const connection = await installs.complete(ORG, KEN.userId, "code");

  audit.events.length = 0;

  return { inbound, installs, links, slack, store, audit, connection };
}

/** A slash command's form, parsed. */
function command(text: string, overrides: Record<string, string> = {}): Record<string, string> {
  return {
    team_id: TEAM,
    user_id: SLACK_MAYA,
    command: "/ouro",
    text,
    response_url: RESPONSE_URL,
    ...overrides,
  };
}

/** An interactivity form, parsed. */
function press(userId: string = SLACK_MAYA): Record<string, string> {
  return {
    payload: JSON.stringify({
      type: "block_actions",
      team: { id: TEAM },
      user: { id: userId },
      response_url: RESPONSE_URL,
      actions: [{ action_id: "allow_once" }],
    }),
  };
}

/** An Events API delivery. */
function event(
  type: string,
  id: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { type: "event_callback", team_id: TEAM, event_id: id, event: { type, ...extra } };
}

describe("the Events API", () => {
  it("passes the URL-verification handshake by echoing the challenge", async () => {
    const { inbound } = await setup();

    expect(
      inbound.event({
        type: "url_verification",
        challenge: "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P",
      }),
    ).toEqual({
      challenge: "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P",
    });
  });

  it("flips the connection to revoked when the app is uninstalled", async () => {
    const { inbound, store, audit } = await setup();

    expect(inbound.event(event("app_uninstalled", "Ev1"))).toEqual({});
    await inbound.idle();

    expect(store.connections[0]).toMatchObject({
      status: "revoked",
      status_detail: "app_uninstalled",
    });
    expect(audit.events).toEqual([
      expect.objectContaining({
        action: "chat.connection_revoked",
        detail: { reason: "app_uninstalled", source: "event" },
      }),
    ]);
  });

  it("flips it when the bot token is revoked, and not for a user token", async () => {
    const { inbound, store } = await setup();

    inbound.event(event("tokens_revoked", "Ev1", { tokens: { oauth: ["U1"], bot: [] } }));
    await inbound.idle();
    expect(store.connections[0].status).toBe("active");

    inbound.event(event("tokens_revoked", "Ev2", { tokens: { oauth: [], bot: ["U07OUROBOT"] } }));
    await inbound.idle();
    expect(store.connections[0]).toMatchObject({
      status: "revoked",
      status_detail: "tokens_revoked",
    });
  });

  it("processes a redelivered event id exactly once, and acknowledges every delivery", async () => {
    const { inbound, installs } = await setup();
    const revoke = jest.spyOn(installs, "revoke");

    const acks = [1, 2, 3].map(() => inbound.event(event("app_uninstalled", "Ev0PV52K21")));
    await inbound.idle();

    expect(acks).toEqual([{}, {}, {}]);
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("acknowledges an event it does not handle and does nothing", async () => {
    const { inbound, store, slack } = await setup();

    expect(inbound.event(event("app_mention", "Ev9"))).toEqual({});
    await inbound.idle();

    expect(store.connections[0].status).toBe("active");
    expect(slack.replies).toEqual([]);
  });

  it("ignores an uninstall for a Slack workspace no organisation has connected", async () => {
    const { inbound, store } = await setup();

    inbound.event({ ...event("app_uninstalled", "Ev1"), team_id: "T0OTHER" });
    await inbound.idle();

    expect(store.connections[0].status).toBe("active");
  });

  it.each([null, "text", 42, {}, { type: "event_callback" }])(
    "acknowledges a malformed delivery without throwing: %p",
    async (body) => {
      const { inbound } = await setup();

      expect(inbound.event(body)).toEqual({});
      await inbound.idle();
    },
  );
});

describe("slash commands", () => {
  it("acknowledges at once, though the work behind it is slow, and answers in a separate message", async () => {
    const { inbound, links, slack } = await setup();
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const offer = links.offer.bind(links);
    jest.spyOn(links, "offer").mockImplementation(async (...args) => {
      await slow;

      return offer(...args);
    });

    const started = Date.now();
    const ack = inbound.command(command("link"));
    const elapsed = Date.now() - started;

    // The acknowledgement is synchronous: it does not wait for the work, and is not its result.
    expect(ack).toBe(COMMAND_ACK);
    expect(ack).toEqual({ response_type: "ephemeral", text: "Working on it…" });
    expect(elapsed).toBeLessThan(100);
    expect(slack.replies).toEqual([]);

    release();
    await inbound.idle();

    expect(slack.replies).toHaveLength(1);
    expect(slack.replies[0].responseUrl).toBe(RESPONSE_URL);
  });

  it("answers /ouro link with a link button only the person who typed it sees", async () => {
    const { inbound, slack, store } = await setup();

    inbound.command(command("link"));
    await inbound.idle();

    const { reply } = slack.replies[0];
    expect(reply.ephemeral).toBe(true);
    expect(reply.text).toBe(REPLIES.linkOffer);
    expect(reply.link?.label).toBe(REPLIES.linkButton);
    expect(reply.link?.url).toMatch(
      /^https:\/\/app\.example\.test\/api\/v1\/slack\/link\/ouro_lnk_/,
    );
    expect(store.links[0]).toMatchObject({ state: "pending", platform_user_id: SLACK_MAYA });
  });

  it("tells somebody already linked that they are", async () => {
    const { inbound, links, slack, connection } = await setup();
    const offer = await links.offer(connection, SLACK_MAYA);
    await links.confirm((offer as { url: string }).url.split("/link/")[1], MAYA);

    inbound.command(command("link"));
    await inbound.idle();

    expect(slack.replies[0].reply).toEqual({ ephemeral: true, text: REPLIES.alreadyLinked });
  });

  it("answers /ouro unlink by revoking the link, and says so honestly when there was none", async () => {
    const { inbound, links, slack, store, connection } = await setup();
    const offer = await links.offer(connection, SLACK_MAYA);
    await links.confirm((offer as { url: string }).url.split("/link/")[1], MAYA);

    inbound.command(command("unlink"));
    await inbound.idle();
    inbound.command(command("unlink"));
    await inbound.idle();

    expect(slack.replies.map(({ reply }) => reply.text)).toEqual([
      REPLIES.unlinked,
      REPLIES.notLinked,
    ]);
    expect(store.links[0].state).toBe("revoked");
  });

  it("answers a bare /ouro and /ouro help with what works today", async () => {
    const { inbound, slack } = await setup();

    inbound.command(command(""));
    inbound.command(command("help"));
    await inbound.idle();

    expect(slack.replies.map(({ reply }) => reply.text)).toEqual([REPLIES.help, REPLIES.help]);
  });

  it("says a command that is not built yet is not available — never a made-up result", async () => {
    const { inbound, slack } = await setup();

    inbound.command(command("status"));
    inbound.command(command("pause all"));
    await inbound.idle();

    expect(slack.replies.map(({ reply }) => reply.text)).toEqual([
      REPLIES.commandUnavailable("status"),
      REPLIES.commandUnavailable("pause"),
    ]);
    expect(slack.replies[0].reply.text).toContain("not available yet");
  });

  it("does not echo arbitrary text back into the channel", async () => {
    const { inbound, slack } = await setup();

    inbound.command(command("<!channel> *look*"));
    await inbound.idle();

    expect(slack.replies[0].reply.text).not.toContain("<!channel>");
  });

  it("tells a Slack workspace that is no longer connected that it is not", async () => {
    const { inbound, installs, slack, connection } = await setup();
    await installs.revoke(connection, "app_uninstalled", "event");

    inbound.command(command("link"));
    await inbound.idle();

    expect(slack.replies[0].reply).toEqual({ ephemeral: true, text: REPLIES.notConnected });
  });

  it("says something went wrong, and changes nothing, when the work fails after the ack", async () => {
    const { inbound, links, slack } = await setup();
    jest.spyOn(links, "offer").mockRejectedValue(new Error("database is down"));

    expect(inbound.command(command("link"))).toBe(COMMAND_ACK);
    await inbound.idle();

    expect(slack.replies[0].reply).toEqual({ ephemeral: true, text: REPLIES.failed });
  });

  it("acknowledges a malformed command and starts nothing", async () => {
    const { inbound, slack } = await setup();

    expect(inbound.command({ text: "link" })).toBe(COMMAND_ACK);
    expect(inbound.command(null)).toBe(COMMAND_ACK);
    await inbound.idle();

    expect(slack.replies).toEqual([]);
  });
});

describe("interactivity", () => {
  it("answers an unlinked person's button press with the link prompt — the second way in", async () => {
    const { inbound, slack, store } = await setup();

    expect(inbound.interaction(press())).toEqual({});
    await inbound.idle();

    const { reply } = slack.replies[0];
    expect(reply.text).toBe(REPLIES.needsLink);
    expect(reply.ephemeral).toBe(true);
    expect(reply.link?.url).toMatch(/\/api\/v1\/slack\/link\/ouro_lnk_/);
    // Read-only: the press did nothing but open a handshake.
    expect(store.links[0].state).toBe("pending");
  });

  it("the prompt's link completes the same flow /ouro link does", async () => {
    const { inbound, links, slack, store } = await setup();

    inbound.interaction(press());
    await inbound.idle();
    const token = slack.replies[0].reply.link!.url.split("/link/")[1];

    expect((await links.confirm(token, MAYA)).status).toBe(200);
    expect(store.links[0]).toMatchObject({ state: "linked", member_id: "mem-maya" });
  });

  it("tells a linked person honestly that answering from Slack is not available yet", async () => {
    const { inbound, links, slack, connection } = await setup();
    const offer = await links.offer(connection, SLACK_MAYA);
    await links.confirm((offer as { url: string }).url.split("/link/")[1], MAYA);

    inbound.interaction(press());
    await inbound.idle();

    expect(slack.replies[0].reply).toEqual({ ephemeral: true, text: REPLIES.actionUnavailable });
  });

  it("acknowledges a payload it cannot read and starts nothing", async () => {
    const { inbound, slack } = await setup();

    expect(inbound.interaction({ payload: "{not json" })).toEqual({});
    expect(inbound.interaction({})).toEqual({});
    await inbound.idle();

    expect(slack.replies).toEqual([]);
  });
});

describe("parsing", () => {
  it.each([
    ["link", "link"],
    ["  UNLINK  ", "unlink"],
    ["queue #485 standard-fix", "queue"],
    ["", "help"],
    [undefined, "help"],
  ])("reads the subcommand of %p as %p", (text, expected) => {
    expect(subcommandOf(text)).toBe(expected);
  });

  it("reads an interaction from the form field Slack posts and from the object Socket Mode hands over", () => {
    expect(interactionPayload({ payload: '{"type":"block_actions"}' })).toEqual({
      type: "block_actions",
    });
    expect(interactionPayload({ type: "block_actions" })).toEqual({ type: "block_actions" });
    expect(interactionPayload({ payload: "[1]" })).toEqual([1]);
    expect(interactionPayload("x")).toBeUndefined();
  });
});
