import type { AuditService } from "../audit/audit.service";
import type { ChatPress, ChatPressOutcome } from "../chat/chat.answers";
import { CHAT_REPLIES } from "../chatops/chatops.replies";
import type { ChatDispatcher } from "../chatops/dispatcher.service";
import type { DispatchInput, DispatchResult } from "../chatops/grammar.types";
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
  opensOnlyLinks,
  pressReply,
  pressedButton,
  slackReply,
  type SlackPressPort,
  subcommandOf,
} from "./slack.inbound.service";
import { SlackInstallService } from "./slack.install.service";
import { SlackLinkService } from "./slack.link.service";
import type { SlackRepository } from "./slack.repository";

/**
 * What a verified request does (#535): acknowledged at once, worked on afterwards, answered in a
 * separate message; an event processed once however often it is delivered.
 *
 * For commands it is a thin adapter (#537): everything but `link` and `unlink` goes to the
 * dispatcher as typed, and the dispatcher's reply comes back as an ephemeral message. What a
 * command *is* is asserted in `chatops/dispatcher.service.spec.ts`, not here.
 *
 * For button presses it is as thin (#538): it resolves who pressed, hands the press to whatever
 * the chat module registered, and says how it ended to the presser alone. What a press *does* is
 * asserted in `chat/chat.answers.spec.ts`.
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

const CHANNEL = "C071LOOPS";

/** A dispatcher that answers what a spec scripted, and remembers what it was handed. */
class FakeDispatcher {
  /** What every dispatch answers with. */
  result: DispatchResult = {
    outcome: "ok",
    reply: { text: "3 loops live · 1 question waiting" },
    commandId: "command-1",
    command: "status",
  };
  /** When set, every dispatch rejects with it. */
  failure: Error | undefined;
  /** Every input handed over, in order. */
  readonly inputs: DispatchInput[] = [];
  /** How often it was asked to wait for its async results. */
  idled = 0;

  dispatch(input: DispatchInput): Promise<DispatchResult> {
    this.inputs.push(input);

    return this.failure === undefined ? Promise.resolve(this.result) : Promise.reject(this.failure);
  }

  idle(): Promise<void> {
    this.idled += 1;

    return Promise.resolve();
  }
}

/** The handlers over fakes, with Slack installed. */
async function setup() {
  const slack = new FakeSlackApi();
  const dispatcher = new FakeDispatcher();
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
    dispatcher as unknown as ChatDispatcher,
  );
  const connection = await installs.complete(ORG, KEN.userId, "code");

  audit.events.length = 0;

  return { inbound, installs, links, slack, store, audit, connection, dispatcher };
}

/** A slash command's form, parsed. */
function command(text: string, overrides: Record<string, string> = {}): Record<string, string> {
  return {
    team_id: TEAM,
    user_id: SLACK_MAYA,
    channel_id: CHANNEL,
    command: "/ouro",
    text,
    response_url: RESPONSE_URL,
    ...overrides,
  };
}

/** The value on the pressed button, and the message it is on. */
const VALUE = "ouro1|5eed0082-0000-4000-8000-000000000002|allow_once|nonce|key|mac";
const MESSAGE_TS = "1760000000.000001";

/** An interactivity form, parsed. */
function press(
  userId: string = SLACK_MAYA,
  actionIds: readonly string[] = ["ouro_answer:allow_once"],
): Record<string, string> {
  return {
    payload: JSON.stringify({
      type: "block_actions",
      team: { id: TEAM },
      user: { id: userId },
      response_url: RESPONSE_URL,
      channel: { id: CHANNEL },
      message: { ts: MESSAGE_TS },
      actions: actionIds.map((action_id) => ({
        action_id,
        ...(action_id.startsWith("ouro_link:") ? {} : { value: VALUE }),
      })),
    }),
  };
}

/** A press port that answers what a spec scripted, and remembers what it was handed. */
class FakePressPort implements SlackPressPort {
  /** What every press ends as. */
  outcome: ChatPressOutcome = {
    kind: "answered",
    action: "Allow once",
    effects: ["allowed the write once", "loop #1851 resumed"],
  };
  /** When set, every press rejects with it. */
  failure: Error | undefined;
  /** Every press handed over, in order. */
  readonly presses: ChatPress[] = [];

  press(pressed: ChatPress): Promise<ChatPressOutcome> {
    this.presses.push(pressed);

    return this.failure === undefined
      ? Promise.resolve(this.outcome)
      : Promise.reject(this.failure);
  }
}

/** The handlers with a press port registered, and Maya linked unless a spec says otherwise. */
async function setupWithPort(options: { linked?: boolean } = {}) {
  const context = await setup();
  const port = new FakePressPort();

  context.inbound.answerPressesWith(port);

  if (options.linked !== false) {
    const offer = await context.links.offer(context.connection, SLACK_MAYA);
    await context.links.confirm((offer as { url: string }).url.split("/link/")[1], MAYA);
    context.audit.events.length = 0;
  }

  return { ...context, port };
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

  it.each([
    ["a bare /ouro", ""],
    ["help", "help"],
    ["help about one command", "help queue"],
    ["a command", "status"],
    ["a command with arguments", "queue #485 standard-fix"],
    ["a destructive command", "pause all confirm"],
    ["text that is no command", "frobnicate now"],
    ["text that looks like markup", "<!channel> *look*"],
    ["a word that only starts like link", "linked accounts"],
  ])(
    "hands %s to the dispatcher with the whole text, team, user and channel",
    async (_what, text) => {
      const { inbound, slack, dispatcher, store, audit } = await setup();

      expect(inbound.command(command(text))).toBe(COMMAND_ACK);
      await inbound.idle();

      expect(dispatcher.inputs).toEqual([
        {
          surface: "slack",
          text,
          slack: { teamId: TEAM, userId: SLACK_MAYA, channelId: CHANNEL },
          followUp: expect.any(Function) as DispatchInput["followUp"],
        },
      ]);
      // It decides nothing itself: the one reply is the dispatcher's, and nothing else happened.
      expect(slack.replies).toEqual([
        {
          responseUrl: RESPONSE_URL,
          reply: { ephemeral: true, text: dispatcher.result.reply.text },
        },
      ]);
      expect(store.links).toEqual([]);
      expect(audit.events).toEqual([]);
    },
  );

  it("hands the text over exactly as typed, and no channel when Slack named none", async () => {
    const { inbound, dispatcher } = await setup();
    const { channel_id: _channel, ...withoutChannel } = command("  Queue   #485 ");

    inbound.command(withoutChannel);
    await inbound.idle();

    expect(dispatcher.inputs[0]).toMatchObject({
      text: "  Queue   #485 ",
      slack: { teamId: TEAM, userId: SLACK_MAYA, channelId: null },
    });
  });

  it("gives the dispatcher's reply back ephemeral, with its link when it has one", async () => {
    const { inbound, slack, dispatcher } = await setup();
    const link = { label: "Open the loop", url: "https://app.example.test/runs/run-1848" };

    dispatcher.result = {
      outcome: "ok",
      reply: { text: "Queued #485.", link },
      commandId: "c-1",
      command: "queue",
    };
    inbound.command(command("queue #485"));
    await inbound.idle();

    expect(slack.replies).toEqual([
      { responseUrl: RESPONSE_URL, reply: { ephemeral: true, text: "Queued #485.", link } },
    ]);
  });

  it.each<[DispatchResult["outcome"], string]>([
    ["denied", "`/ouro pause all` is for workspace owners and admins."],
    ["error", 'unknown command "frobnicate" — `/ouro help` lists the commands'],
    ["error", CHAT_REPLIES.notConnected],
    ["async_pending", "Rehearsing #486 — the result follows here."],
  ])("says what the dispatcher said for a %s outcome, and adds nothing", async (outcome, text) => {
    const { inbound, slack, dispatcher, store } = await setup();

    dispatcher.result = { outcome, reply: { text }, commandId: null, command: null };
    inbound.command(command("pause all"));
    await inbound.idle();

    expect(slack.replies.map(({ reply }) => reply)).toEqual([{ ephemeral: true, text }]);
    expect(store.links).toEqual([]);
  });

  it("puts the link button under the dispatcher's sentence for somebody unlinked", async () => {
    const { inbound, slack, dispatcher, store } = await setup();

    dispatcher.result = {
      outcome: "unlinked",
      reply: { text: CHAT_REPLIES.unlinked },
      commandId: "c-1",
      command: "status",
    };
    inbound.command(command("status"));
    await inbound.idle();

    const { reply } = slack.replies[0];
    expect(slack.replies).toHaveLength(1);
    expect(reply.ephemeral).toBe(true);
    // The sentence is the dispatcher's; the button is the one thing only Slack can add.
    expect(reply.text).toBe(CHAT_REPLIES.unlinked);
    expect(reply.link?.label).toBe(REPLIES.linkButton);
    expect(reply.link?.url).toMatch(
      /^https:\/\/app\.example\.test\/api\/v1\/slack\/link\/ouro_lnk_/,
    );
    expect(store.links[0]).toMatchObject({ state: "pending", platform_user_id: SLACK_MAYA });
  });

  it("the button under an unlinked command completes the same flow /ouro link does", async () => {
    const { inbound, links, slack, dispatcher, store } = await setup();

    dispatcher.result = {
      outcome: "unlinked",
      reply: { text: "Link first." },
      commandId: "c-1",
      command: "status",
    };
    inbound.command(command("status"));
    await inbound.idle();
    const token = slack.replies[0].reply.link!.url.split("/link/")[1];

    expect(slack.replies[0].reply.text).toBe("Link first.");
    expect((await links.confirm(token, MAYA)).status).toBe(200);
    expect(store.links[0]).toMatchObject({ state: "linked", member_id: "mem-maya" });
  });

  it("says only the dispatcher's sentence when the connection went away before the button could be offered", async () => {
    const { inbound, installs, slack, dispatcher, store, connection } = await setup();

    dispatcher.result = {
      outcome: "unlinked",
      reply: { text: CHAT_REPLIES.unlinked },
      commandId: "c-1",
      command: "status",
    };
    await installs.revoke(connection, "app_uninstalled", "event");
    inbound.command(command("status"));
    await inbound.idle();

    expect(slack.replies[0].reply).toEqual({ ephemeral: true, text: CHAT_REPLIES.unlinked });
    expect(store.links).toEqual([]);
  });

  it("posts an async command's later result to the same response_url, ephemeral, through followUp", async () => {
    const { inbound, slack, dispatcher } = await setup();
    const link = { label: "Open the dry run", url: "https://app.example.test/dry-runs/dr-1" };

    dispatcher.result = {
      outcome: "async_pending",
      reply: { text: "Rehearsing #486 — the result follows here." },
      commandId: "c-1",
      command: "dry-run",
    };
    inbound.command(command("dry-run #486"));
    await inbound.idle();

    // The acknowledgement first — honest, and not the result.
    expect(slack.replies).toEqual([
      {
        responseUrl: RESPONSE_URL,
        reply: { ephemeral: true, text: "Rehearsing #486 — the result follows here." },
      },
    ]);

    await dispatcher.inputs[0].followUp?.({ text: "Dry run of #486 finished: no writes.", link });

    expect(slack.replies).toHaveLength(2);
    expect(slack.replies[1]).toEqual({
      responseUrl: RESPONSE_URL,
      reply: { ephemeral: true, text: "Dry run of #486 finished: no writes.", link },
    });
  });

  it("tells the dispatcher when Slack did not take a later result, so it can log it", async () => {
    const { inbound, slack, dispatcher } = await setup();

    inbound.command(command("dry-run #486"));
    await inbound.idle();
    slack.respondResult = { ok: false, error: "expired_url" };

    await expect(dispatcher.inputs[0].followUp?.({ text: "Finished." })).rejects.toThrow(
      "Slack did not take the reply: expired_url",
    );
  });

  it("waits for the dispatcher's async results when it is asked to idle", async () => {
    const { inbound, dispatcher } = await setup();

    inbound.command(command("dry-run #486"));
    await inbound.idle();

    expect(dispatcher.idled).toBe(1);
  });

  it.each(["link", "unlink", "LINK", "  unlink  ", "link me please"])(
    "never hands %p to the dispatcher: linking is a Slack matter",
    async (text) => {
      const { inbound, slack, dispatcher } = await setup();

      inbound.command(command(text));
      await inbound.idle();

      expect(dispatcher.inputs).toEqual([]);
      expect(slack.replies).toHaveLength(1);
      expect([REPLIES.linkOffer, REPLIES.notLinked]).toContain(slack.replies[0].reply.text);
    },
  );

  it("does not put what was typed into the channel itself: only the dispatcher's reply is said", async () => {
    const { inbound, slack } = await setup();

    inbound.command(command("<!channel> *look*"));
    await inbound.idle();

    expect(slack.replies).toHaveLength(1);
    expect(slack.replies[0].reply.ephemeral).toBe(true);
    expect(slack.replies[0].reply.text).not.toContain("<!channel>");
  });

  it("says something went wrong when the dispatcher could not read who typed it", async () => {
    const { inbound, slack, dispatcher } = await setup();

    dispatcher.failure = new Error("database is down");

    expect(inbound.command(command("status"))).toBe(COMMAND_ACK);
    await inbound.idle();

    expect(slack.replies.map(({ reply }) => reply)).toEqual([
      { ephemeral: true, text: REPLIES.failed },
    ]);
  });

  it("tells a Slack workspace that is no longer connected that it is not", async () => {
    const { inbound, installs, slack, connection } = await setup();
    await installs.revoke(connection, "app_uninstalled", "event");

    inbound.command(command("link"));
    inbound.command(command("unlink"));
    await inbound.idle();

    expect(slack.replies.map(({ reply }) => reply)).toEqual([
      { ephemeral: true, text: REPLIES.notConnected },
      { ephemeral: true, text: REPLIES.notConnected },
    ]);
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
  it("says nothing when a card's link button is followed — the browser already opened the page (#536)", async () => {
    const { inbound, slack, store } = await setup();

    expect(inbound.interaction(press(SLACK_MAYA, ["ouro_link:view_pr"]))).toEqual({});
    await inbound.idle();

    expect(slack.replies).toEqual([]);
    expect(store.links).toEqual([]);
  });

  it("still answers a press that includes a button which is not a link", async () => {
    const { inbound, slack } = await setup();

    inbound.interaction(press(SLACK_MAYA, ["ouro_link:view_pr", "ouro_answer:deny"]));
    await inbound.idle();

    expect(slack.replies).toHaveLength(1);
    expect(opensOnlyLinks({ actions: [] })).toBe(false);
    expect(opensOnlyLinks({})).toBe(false);
    expect(opensOnlyLinks(undefined)).toBe(false);
    expect(opensOnlyLinks({ actions: [{ action_id: "ouro_link:x" }, "nonsense"] })).toBe(false);
  });

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

  it("tells a linked person honestly that answering is not available when nothing answers presses", async () => {
    // No port registered: a deployment without the chat module, or a press before it started.
    const { inbound, links, slack, connection } = await setup();
    const offer = await links.offer(connection, SLACK_MAYA);
    await links.confirm((offer as { url: string }).url.split("/link/")[1], MAYA);

    inbound.interaction(press());
    await inbound.idle();

    expect(slack.replies[0].reply).toEqual({ ephemeral: true, text: REPLIES.actionUnavailable });
    expect(REPLIES.actionUnavailable).toBe(
      "Answering from Slack is not available right now. Open the item in Ouroboros to answer it.",
    );
  });

  it("acknowledges a payload it cannot read and starts nothing", async () => {
    const { inbound, slack } = await setup();

    expect(inbound.interaction({ payload: "{not json" })).toEqual({});
    expect(inbound.interaction({})).toEqual({});
    await inbound.idle();

    expect(slack.replies).toEqual([]);
  });
});

describe("a button press, answered (#538)", () => {
  it("hands a linked person's press to the port: workspace, connection, who, where and the value", async () => {
    const { inbound, port, connection } = await setupWithPort();

    expect(inbound.interaction(press())).toEqual({});
    await inbound.idle();

    expect(port.presses).toEqual([
      {
        organizationId: ORG,
        connectionId: connection.id,
        platformUserId: SLACK_MAYA,
        userId: MAYA.userId,
        value: VALUE,
        platformChannelId: CHANNEL,
        platformTs: MESSAGE_TS,
      },
    ]);
  });

  it("says how it ended to the presser alone, in a separate message", async () => {
    const { inbound, slack, port, store, audit } = await setupWithPort();
    const links = store.links.length;

    inbound.interaction(press());
    await inbound.idle();

    expect(slack.replies).toEqual([
      {
        responseUrl: RESPONSE_URL,
        reply: {
          ephemeral: true,
          text: "Answered: Allow once — allowed the write once · loop #1851 resumed",
        },
      },
    ]);
    expect(port.presses).toHaveLength(1);
    // It decides and records nothing itself.
    expect(store.links).toHaveLength(links);
    expect(audit.events).toEqual([]);
  });

  it("acknowledges at once — the answer is worked on after the ack", async () => {
    const { inbound, slack, port } = await setupWithPort();

    expect(inbound.interaction(press())).toEqual({});
    expect(slack.replies).toEqual([]);
    expect(port.presses).toEqual([]);

    await inbound.idle();

    expect(slack.replies).toHaveLength(1);
  });

  it("hands an unlinked person's press over with no user, and answers `unlinked` with the link prompt", async () => {
    const { inbound, slack, port, store } = await setupWithPort({ linked: false });
    port.outcome = { kind: "unlinked" };

    inbound.interaction(press());
    await inbound.idle();

    expect(port.presses).toEqual([expect.objectContaining({ userId: undefined, value: VALUE })]);
    const { reply } = slack.replies[0];

    expect(slack.replies).toHaveLength(1);
    expect(reply.ephemeral).toBe(true);
    expect(reply.text).toBe(REPLIES.needsLink);
    expect(reply.link?.label).toBe(REPLIES.linkButton);
    expect(reply.link?.url).toMatch(/\/api\/v1\/slack\/link\/ouro_lnk_/);
    // Read-only: the press did nothing but open a handshake.
    expect(store.links).toEqual([
      expect.objectContaining({ state: "pending", platform_user_id: SLACK_MAYA }),
    ]);
  });

  it("offers no link to an unlinked person whose press was rejected — the port decides", async () => {
    const { inbound, slack, port, store } = await setupWithPort({ linked: false });
    port.outcome = { kind: "rejected" };

    inbound.interaction(press());
    await inbound.idle();

    expect(slack.replies.map(({ reply }) => reply)).toEqual([
      { ephemeral: true, text: REPLIES.pressRejected },
    ]);
    expect(store.links).toEqual([]);
  });

  it("treats a link that is only pending as no link", async () => {
    const { inbound, links, port, connection } = await setupWithPort({ linked: false });

    // Pending: offered, never confirmed.
    await links.offer(connection, SLACK_MAYA);
    inbound.interaction(press());
    await inbound.idle();

    expect(port.presses[0].userId).toBeUndefined();
  });

  it("hands over whatever the button carried, and no channel or message when Slack named none", async () => {
    const { inbound, port } = await setupWithPort();

    inbound.interaction({
      payload: JSON.stringify({
        type: "block_actions",
        team: { id: TEAM },
        user: { id: SLACK_MAYA },
        response_url: RESPONSE_URL,
        actions: [{ action_id: "ouro_answer:allow_once" }],
      }),
    });
    await inbound.idle();

    expect(port.presses[0]).toMatchObject({
      value: undefined,
      platformChannelId: undefined,
      platformTs: undefined,
    });
  });

  it("answers the button that is not a link when a press carries both", async () => {
    const { inbound, port } = await setupWithPort();

    inbound.interaction(press(SLACK_MAYA, ["ouro_link:view_diff", "ouro_answer:deny"]));
    await inbound.idle();

    expect(port.presses).toEqual([expect.objectContaining({ value: VALUE })]);
  });

  it("never reaches the port for a press of nothing but link buttons", async () => {
    const { inbound, slack, port } = await setupWithPort();

    expect(inbound.interaction(press(SLACK_MAYA, ["ouro_link:confirm_in_app"]))).toEqual({});
    await inbound.idle();

    expect(port.presses).toEqual([]);
    expect(slack.replies).toEqual([]);
  });

  it("never reaches the port for a Slack workspace that is no longer connected", async () => {
    const { inbound, installs, slack, port, connection } = await setupWithPort();
    await installs.revoke(connection, "app_uninstalled", "event");

    inbound.interaction(press());
    await inbound.idle();

    expect(port.presses).toEqual([]);
    expect(slack.replies.map(({ reply }) => reply)).toEqual([
      { ephemeral: true, text: REPLIES.notConnected },
    ]);
  });

  it("says something went wrong, and nothing else, when the port fails", async () => {
    const { inbound, slack, port } = await setupWithPort();
    port.failure = new Error("the database went away");

    expect(inbound.interaction(press())).toEqual({});
    await inbound.idle();

    expect(slack.replies.map(({ reply }) => reply)).toEqual([
      { ephemeral: true, text: REPLIES.failed },
    ]);
  });

  it.each<[ChatPressOutcome, string]>([
    [{ kind: "rejected" }, REPLIES.pressRejected],
    [{ kind: "not_a_member" }, REPLIES.pressNotAMember],
    [{ kind: "in_progress" }, REPLIES.pressInProgress],
    [{ kind: "closed" }, REPLIES.pressClosed],
    [
      { kind: "already_answered", summary: "Priya Nair answered: allowed once · in Ouroboros" },
      "This was already answered — Priya Nair answered: allowed once · in Ouroboros. Nothing was changed by your press.",
    ],
    [
      { kind: "denied", action: "Allow once", needs: "the `can_approve_loops` capability" },
      "Allow once needs the `can_approve_loops` capability, which your account does not have. Nothing was changed.",
    ],
    [
      { kind: "refused", message: "The path is still blocked by an organisation policy." },
      "The path is still blocked by an organisation policy. Nothing was answered.",
    ],
  ])("says what a %j press came to, ephemerally", async (outcome, text) => {
    const { inbound, slack, port } = await setupWithPort();
    port.outcome = outcome;

    inbound.interaction(press());
    await inbound.idle();

    expect(slack.replies.map(({ reply }) => reply)).toEqual([{ ephemeral: true, text }]);
  });

  it("answers a merge-class press with the link into the app", async () => {
    const { inbound, slack, port } = await setupWithPort();
    const url = "https://app.example.test/inbox?item=5eed0082-0000-4000-8000-000000000001";
    port.outcome = { kind: "confirm_in_app", url };

    inbound.interaction(press());
    await inbound.idle();

    expect(slack.replies.map(({ reply }) => reply)).toEqual([
      {
        ephemeral: true,
        text: REPLIES.pressConfirmInApp,
        link: { label: REPLIES.pressConfirmButton, url },
      },
    ]);
  });

  it("routes presses to whichever port was registered last", async () => {
    const { inbound, port } = await setupWithPort();
    const later = new FakePressPort();

    inbound.answerPressesWith(later);
    inbound.interaction(press());
    await inbound.idle();

    expect(port.presses).toEqual([]);
    expect(later.presses).toHaveLength(1);
  });
});

describe("what a press's outcome reads as", () => {
  it("says what was answered and what the plane did", () => {
    expect(
      pressReply({
        kind: "answered",
        action: "Allow once",
        effects: ["allowed the write once", "loop #1851 resumed"],
      }),
    ).toEqual({
      ephemeral: true,
      text: "Answered: Allow once — allowed the write once · loop #1851 resumed",
    });
  });

  it("says who answered first when that is on record, and only that it was answered when not", () => {
    expect(pressReply({ kind: "already_answered", summary: "Closed — settled elsewhere" })).toEqual(
      {
        ephemeral: true,
        text: "This was already answered — Closed — settled elsewhere. Nothing was changed by your press.",
      },
    );
    expect(pressReply({ kind: "already_answered", summary: undefined })).toEqual({
      ephemeral: true,
      text: "This was already answered, so nothing was changed by your press.",
    });
  });

  it("names the capability, or the role, a denied press needed", () => {
    expect(
      pressReply({
        kind: "denied",
        action: "Allow once",
        needs: "the `can_approve_loops` capability",
      }).text,
    ).toBe(
      "Allow once needs the `can_approve_loops` capability, which your account does not have. Nothing was changed.",
    );
    expect(
      pressReply({ kind: "denied", action: "Return to loop with note", needs: "the member role" })
        .text,
    ).toContain("needs the member role");
  });

  it("carries the link for a merge, and says chat cannot answer it", () => {
    const url = "https://app.example.test/inbox?item=item-1";

    expect(pressReply({ kind: "confirm_in_app", url })).toEqual({
      ephemeral: true,
      text: REPLIES.pressConfirmInApp,
      link: { label: "Confirm in Ouroboros", url },
    });
    expect(REPLIES.pressConfirmInApp).toMatch(/cannot be answered from Slack/);
  });

  it("sends a note-taking answer to the app, with the link", () => {
    expect(
      pressReply({
        kind: "needs_note",
        action: "Return to loop with note",
        url: "https://app.example.test/inbox?item=i",
      }),
    ).toEqual({
      ephemeral: true,
      text: "Return to loop with note needs a note, which a Slack button cannot take. Nothing was changed — give the answer in Ouroboros.",
      link: { label: REPLIES.pressOpenButton, url: "https://app.example.test/inbox?item=i" },
    });
  });

  it("gives a refusal in the plane's words", () => {
    expect(pressReply({ kind: "refused", message: "The merge plan is not armable." })).toEqual({
      ephemeral: true,
      text: "The merge plan is not armable. Nothing was answered.",
    });
  });

  it.each<[Exclude<ChatPressOutcome, { kind: "unlinked" }>, string]>([
    [{ kind: "in_progress" }, REPLIES.pressInProgress],
    [{ kind: "closed" }, REPLIES.pressClosed],
    [{ kind: "not_a_member" }, REPLIES.pressNotAMember],
    [{ kind: "rejected" }, REPLIES.pressRejected],
  ])("has a fixed sentence for %j, with no link", (outcome, text) => {
    expect(pressReply(outcome)).toEqual({ ephemeral: true, text });
  });

  it.each<[Exclude<ChatPressOutcome, { kind: "unlinked" }>]>([
    [{ kind: "answered", action: "Deny", effects: ["denied the write"] }],
    [{ kind: "already_answered", summary: undefined }],
    [{ kind: "denied", action: "Deny", needs: "the admin role" }],
    [{ kind: "confirm_in_app", url: "https://app.example.test/inbox?item=i" }],
    [{ kind: "refused", message: "No." }],
    [{ kind: "in_progress" }],
    [{ kind: "closed" }],
    [{ kind: "not_a_member" }],
    [{ kind: "rejected" }],
  ])("is ephemeral for every outcome, and only `answered` claims a change: %j", (outcome) => {
    const reply = pressReply(outcome);

    expect(reply.ephemeral).toBe(true);
    expect(reply.text.length).toBeGreaterThan(0);
    expect(/^Answered: /.test(reply.text)).toBe(outcome.kind === "answered");
  });
});

describe("the pressed button", () => {
  const answer = { action_id: "ouro_answer:allow_once", value: VALUE };

  it("reads the value, the channel and the message from where Slack puts them", () => {
    expect(
      pressedButton({
        actions: [answer],
        channel: { id: CHANNEL, name: "loops" },
        message: { ts: MESSAGE_TS, text: "…" },
      }),
    ).toEqual({ value: VALUE, platformChannelId: CHANNEL, platformTs: MESSAGE_TS });
  });

  it("falls back to the container, which is all some payloads carry", () => {
    expect(
      pressedButton({
        actions: [answer],
        container: { type: "message", channel_id: "D0DIRECT", message_ts: "1760000000.000777" },
      }),
    ).toEqual({ value: VALUE, platformChannelId: "D0DIRECT", platformTs: "1760000000.000777" });
  });

  it("prefers the message itself over the container when both are there", () => {
    expect(
      pressedButton({
        actions: [answer],
        channel: { id: CHANNEL },
        message: { ts: MESSAGE_TS },
        container: { channel_id: "D0DIRECT", message_ts: "1760000000.000777" },
      }),
    ).toMatchObject({ platformChannelId: CHANNEL, platformTs: MESSAGE_TS });
  });

  it("skips link buttons: the value is the first answering button's", () => {
    expect(
      pressedButton({
        actions: [
          { action_id: "ouro_link:view_diff", value: "not-this" },
          answer,
          { action_id: "ouro_answer:deny", value: "nor-this" },
        ],
      }).value,
    ).toBe(VALUE);
    expect(
      pressedButton({ actions: [{ action_id: "ouro_link:view_diff", value: "not-this" }] }).value,
    ).toBeUndefined();
  });

  it.each([
    undefined,
    null,
    "text",
    {},
    { actions: "nonsense" },
    { actions: [] },
    { actions: [{ action_id: "ouro_answer:allow_once" }] },
    { actions: [{ action_id: "ouro_answer:allow_once", value: 7 }], channel: "C1", message: 3 },
  ])("reads nothing it cannot trust from %j, without throwing", (payload) => {
    expect(pressedButton(payload)).toEqual({
      value: undefined,
      platformChannelId: undefined,
      platformTs: undefined,
    });
  });
});

describe("the dispatcher's sentences", () => {
  it("are the ones a button press says too, so a command and a press read the same", () => {
    expect(REPLIES.needsLink).toBe(CHAT_REPLIES.unlinked);
    expect(REPLIES.notConnected).toBe(CHAT_REPLIES.notConnected);
  });

  it("become an ephemeral Slack message, with a link only when the reply has one", () => {
    const link = { label: "Open", url: "https://app.example.test/runs/run-1" };

    expect(slackReply({ text: "Done." })).toEqual({ ephemeral: true, text: "Done." });
    expect(slackReply({ text: "Done.", link })).toEqual({ ephemeral: true, text: "Done.", link });
    expect(Object.keys(slackReply({ text: "Done." }))).not.toContain("link");
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
