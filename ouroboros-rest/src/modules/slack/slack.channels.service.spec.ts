import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import type { AuditService } from "../audit/audit.service";
import type { AppConfigService } from "../config/config.service";
import type { ChatChannel } from "../db/schema";
import type { VaultService } from "../vault/vault.service";
import { PutSlackChannelBindingDto } from "./slack.channels.dto";
import { PURPOSE_ROUTES, SlackChannelsService } from "./slack.channels.service";
import { SLACK_ERRORS } from "./slack.errors";
import {
  BOT_TOKEN,
  FakeSlackApi,
  FakeSlackStore,
  FakeVault,
  KEN,
  MAYA,
  ORG,
  RecordingAudit,
  TEAM,
  channel,
  route,
  slackConfig,
} from "./slack.fixture";
import { SlackInstallService } from "./slack.install.service";
import type { SlackRepository } from "./slack.repository";
import { channelsResource } from "./slack.resources";

/**
 * The channel list and its bindings (#541): what the picker is told about each channel, a
 * refresh that changes nothing when Slack does not answer, a binding that is refused wherever the
 * bot could not post — and, where it is not, moves a purpose and its default routes in one go.
 */

/** What Slack lists in these specs: three channels the bot is in, one it is not, one archived. */
const LISTED = [
  channel({ id: "C071LOOPS", name: "ouroboros-loops" }),
  channel({ id: "C072ALERT", name: "helios-alerts", memberCount: 9 }),
  channel({ id: "C073LEADS", name: "eng-leads", isPrivate: true, memberCount: 4 }),
  channel({ id: "C074RANDOM", name: "random", isMember: false, memberCount: 112 }),
  channel({ id: "C075OLD", name: "helios-2024", isArchived: true }),
];

/** The services over fakes, on a workspace with Slack installed and its channels listed. */
async function setup(options: { connected?: boolean } = {}) {
  const slack = new FakeSlackApi();
  const store = new FakeSlackStore();
  const audit = new RecordingAudit();
  const installs = new SlackInstallService(
    slackConfig() as unknown as AppConfigService,
    slack,
    store as unknown as SlackRepository,
    new FakeVault() as unknown as VaultService,
    audit as unknown as AuditService,
  );
  const service = new SlackChannelsService(
    store as unknown as SlackRepository,
    installs,
    audit as unknown as AuditService,
  );

  slack.channelList = { ok: true, channels: LISTED };

  if (options.connected !== false) {
    await installs.complete(ORG, KEN.userId, "code-1");
    // The install's own audit event is not what these specs count.
    audit.events.length = 0;
  }

  /** The stored row of a channel, by Slack's id. */
  const row = (platformChannelId: string): ChatChannel => {
    const found = store.channelRows.find((stored) => stored.channel_id === platformChannelId);

    if (found === undefined) {
      throw new Error(`no stored channel ${platformChannelId}`);
    }

    return found;
  };

  /** The stored route of a kind. */
  const stored = (kind: string) => store.routeRows.find((found) => found.kind === kind);

  /** Everything a write could change, as one comparable value. */
  const snapshot = (): string => JSON.stringify([store.channelRows, store.routeRows]);

  return { service, installs, slack, store, audit, row, stored, snapshot };
}

/** What a refused call threw. */
async function refusal(
  run: Promise<unknown>,
): Promise<{ code: string; message: string; details: unknown; getStatus(): number }> {
  return run.then(
    () => {
      throw new Error("the call was not refused");
    },
    (error: { code: string; message: string; details: unknown; getStatus(): number }) => error,
  );
}

describe("the channel list", () => {
  it("says what the picker needs of each channel: ids, membership, privacy, and where it opens in Slack", async () => {
    const { service, row } = await setup();

    const list = await service.list(ORG);
    const leads = list.channels.find((found) => found.name === "eng-leads");

    expect(list.connected).toBe(true);
    expect(leads).toEqual({
      id: row("C073LEADS").id,
      platformChannelId: "C073LEADS",
      name: "eng-leads",
      isPrivate: true,
      joined: true,
      memberCount: 4,
      purpose: null,
      archived: false,
      url: `https://app.slack.com/client/${TEAM}/C073LEADS`,
      routes: [],
    });
    expect(list.channels.find((found) => found.name === "random")?.joined).toBe(false);
    expect(list.channels.find((found) => found.name === "helios-2024")?.archived).toBe(true);
  });

  it("lists bound channels first — loops, alerts, leads — then the rest by name", async () => {
    const { service, row } = await setup();
    row("C073LEADS").purpose_tag = "leads";
    row("C072ALERT").purpose_tag = "alerts";
    row("C071LOOPS").purpose_tag = "loops";

    const list = await service.list(ORG);

    expect(list.channels.map((found) => [found.name, found.purpose])).toEqual([
      ["ouroboros-loops", "loops"],
      ["helios-alerts", "alerts"],
      ["eng-leads", "leads"],
      ["helios-2024", null],
      ["random", null],
    ]);
  });

  it("reads a purpose tag that is not one of the three as unbound", async () => {
    const { service, row } = await setup();
    row("C072ALERT").purpose_tag = "incidents";

    const list = await service.list(ORG);

    expect(list.channels.find((found) => found.name === "helios-alerts")?.purpose).toBeNull();
    // …and it sorts with the unbound channels, not ahead of them.
    expect(list.channels.map((found) => found.name)).toEqual([
      "eng-leads",
      "helios-2024",
      "helios-alerts",
      "ouroboros-loops",
      "random",
    ]);
  });

  it("never lists the DM conversations the publisher opened", async () => {
    const { service, store, row } = await setup();
    store.channelRows.push({
      ...row("C071LOOPS"),
      id: "5eed009c-0000-4000-8000-0000000000d1",
      channel_id: "D07KEN",
      channel_name: "D07KEN",
      purpose_tag: "dm",
    });

    const list = await service.list(ORG);

    expect(list.channels.map((found) => found.platformChannelId)).not.toContain("D07KEN");
    expect(list.channels).toHaveLength(LISTED.length);
  });

  it("leaves a DM row out even when the store hands one over", async () => {
    const { store, row } = await setup();
    const connection = await store.connectionOf(ORG);
    const dm = { ...row("C071LOOPS"), channel_id: "D07KEN", purpose_tag: "dm" };

    const list = channelsResource({ connection, channels: [dm, row("C072ALERT")], routes: [] });

    expect(list.channels.map((found) => found.platformChannelId)).toEqual(["C072ALERT"]);
  });

  it("names, per channel and sorted, the Slack routes posting there — and no email route", async () => {
    const { service, store, row } = await setup();
    const loops = row("C071LOOPS").id;
    store.routeRows.push(
      route({ kind: "custom:loop-finished", chat_channel_id: loops }),
      route({ kind: "custom:blocking-questions", chat_channel_id: loops, dm_on_call: true }),
      route({ kind: "custom:build-failures", chat_channel_id: row("C072ALERT").id }),
      route({ kind: "needs_you_dm" }),
      route({ kind: "weekly_insights", channel: "email" }),
      route({ kind: "custom:elsewhere", chat_channel_id: loops, organization_id: "org-other" }),
    );

    const list = await service.list(ORG);
    const routes = Object.fromEntries(list.channels.map((found) => [found.name, found.routes]));

    expect(routes).toEqual({
      "ouroboros-loops": ["custom:blocking-questions", "custom:loop-finished"],
      "helios-alerts": ["custom:build-failures"],
      "eng-leads": [],
      "helios-2024": [],
      random: [],
    });
  });

  it("reports the newest channel change as when the list was refreshed", async () => {
    const { service, row } = await setup();
    row("C071LOOPS").updated_at = new Date("2026-10-12T14:00:00.000Z");
    row("C072ALERT").updated_at = new Date("2026-10-12T14:02:11.000Z");
    row("C073LEADS").updated_at = new Date("2026-10-11T09:00:00.000Z");
    row("C074RANDOM").updated_at = new Date("2026-10-11T09:00:00.000Z");
    row("C075OLD").updated_at = new Date("2026-10-11T09:00:00.000Z");

    await expect(service.list(ORG)).resolves.toMatchObject({
      refreshedAt: "2026-10-12T14:02:11.000Z",
    });
  });

  it("answers not connected, with no channels, where Slack was never installed", async () => {
    const { service } = await setup({ connected: false });

    await expect(service.list(ORG)).resolves.toEqual({
      connected: false,
      refreshedAt: null,
      channels: [],
    });
  });

  it("answers not connected once the install is revoked, though its channel rows remain", async () => {
    const { service, installs, store } = await setup();
    await installs.revoke(store.connections[0], "app_uninstalled", "event");

    await expect(service.list(ORG)).resolves.toEqual({
      connected: false,
      refreshedAt: null,
      channels: [],
    });
    expect(store.channelRows).toHaveLength(LISTED.length);
  });

  it("answers connected with a null refresh time before any channel is known", async () => {
    const { service, store } = await setup();
    store.channelRows.length = 0;

    await expect(service.list(ORG)).resolves.toEqual({
      connected: true,
      refreshedAt: null,
      channels: [],
    });
  });
});

describe("refreshing the channel list", () => {
  it("stores what Slack lists now: a new channel, a rename, and a membership the bot was just given", async () => {
    const { service, slack, row } = await setup();
    const loopsId = row("C071LOOPS").id;
    slack.channelList = {
      ok: true,
      channels: [
        channel({ id: "C071LOOPS", name: "loops" }),
        channel({ id: "C074RANDOM", name: "random", isMember: true, memberCount: 113 }),
        channel({ id: "C076NEW", name: "helios-firmware", memberCount: 6 }),
      ],
    };

    const list = await service.refresh(ORG);
    const byId = new Map(list.channels.map((found) => [found.platformChannelId, found]));

    expect(byId.get("C071LOOPS")).toMatchObject({ id: loopsId, name: "loops" });
    expect(byId.get("C074RANDOM")).toMatchObject({ joined: true, memberCount: 113 });
    expect(byId.get("C076NEW")).toMatchObject({ name: "helios-firmware", joined: true });
    // A channel Slack did not list this time is kept: routes may still name it.
    expect(byId.has("C072ALERT")).toBe(true);
  });

  it("calls Slack with the unsealed token, and leaves bindings alone", async () => {
    const { service, slack, row } = await setup();
    row("C071LOOPS").purpose_tag = "loops";
    slack.tokensSeen.length = 0;

    const list = await service.refresh(ORG);

    expect(slack.tokensSeen).toEqual([BOT_TOKEN]);
    expect(list.channels[0]).toMatchObject({ name: "ouroboros-loops", purpose: "loops" });
  });

  it("is a 502 carrying Slack's error when Slack does not list, and changes nothing", async () => {
    const { service, slack, store, snapshot } = await setup();
    const before = snapshot();
    slack.channelList = { ok: false, error: "ratelimited" };

    const error = await refusal(service.refresh(ORG));

    expect(error.code).toBe(SLACK_ERRORS.channelListFailed);
    expect(error.getStatus()).toBe(502);
    expect(error.details).toEqual({ reason: "ratelimited" });
    expect(snapshot()).toBe(before);
    expect(store.connections[0].status).toBe("active");
  });

  it("marks the connection revoked when Slack's error means the install is over — channels still untouched", async () => {
    const { service, slack, store, audit, snapshot } = await setup();
    const before = snapshot();
    slack.channelList = { ok: false, error: "invalid_auth" };

    const error = await refusal(service.refresh(ORG));

    expect(error.code).toBe(SLACK_ERRORS.channelListFailed);
    expect(error.details).toEqual({ reason: "invalid_auth" });
    expect(snapshot()).toBe(before);
    expect(store.connections[0].status).toBe("revoked");
    expect(audit.events.map((event) => event.action)).toEqual(["chat.connection_revoked"]);
  });

  it("is a 502 without calling Slack when the stored token cannot be read", async () => {
    const { service, slack, store } = await setup();
    store.connections[0].bot_token_sealed = "ouro.v1.1.bm9uY2U.bm90LXRoaXMtcmVjb3Jk";
    slack.tokensSeen.length = 0;

    const error = await refusal(service.refresh(ORG));

    expect(error.code).toBe(SLACK_ERRORS.channelListFailed);
    expect(error.details).toEqual({ reason: "token_unavailable" });
    expect(slack.tokensSeen).toEqual([]);
  });

  it("is a 409 where there is no active connection to ask", async () => {
    const never = await setup({ connected: false });
    const revoked = await setup();
    await revoked.installs.revoke(revoked.store.connections[0], "token_revoked", "event");

    for (const { service, slack } of [never, revoked]) {
      slack.tokensSeen.length = 0;
      const error = await refusal(service.refresh(ORG));

      expect(error.code).toBe(SLACK_ERRORS.notConnected);
      expect(error.getStatus()).toBe(409);
      expect(slack.tokensSeen).toEqual([]);
    }
  });
});

describe("binding a channel — the refusals", () => {
  it("is a 404 for an id that names no channel, another workspace's channel, or nothing like an id", async () => {
    const { service, store, audit, row, snapshot } = await setup();
    const foreign = "5eed009c-0000-4000-8000-0000000000f1";
    store.channelRows.push({ ...row("C071LOOPS"), id: foreign, organization_id: "org-other" });
    const before = snapshot();

    for (const id of ["5eed009c-0000-4000-8000-0000000000aa", foreign, "C071LOOPS", ""]) {
      const error = await refusal(service.bind(ORG, KEN.userId, id, "loops"));

      expect(error.code).toBe(SLACK_ERRORS.channelNotFound);
      expect(error.getStatus()).toBe(404);
    }

    expect(snapshot()).toBe(before);
    expect(store.transactions).toBe(0);
    expect(audit.events).toEqual([]);
  });

  it("is a 404 for a DM conversation's row, which is not a channel", async () => {
    const { service, store, row, snapshot } = await setup();
    const dm = "5eed009c-0000-4000-8000-0000000000d1";
    store.channelRows.push({
      ...row("C071LOOPS"),
      id: dm,
      channel_id: "D07KEN",
      channel_name: "D07KEN",
      purpose_tag: "dm",
    });
    const before = snapshot();

    const error = await refusal(service.bind(ORG, KEN.userId, dm, "loops"));

    expect(error.code).toBe(SLACK_ERRORS.channelNotFound);
    expect(snapshot()).toBe(before);
  });

  it("is a 404 for a channel left behind by a connection that is no longer the active one", async () => {
    const { service, store, row } = await setup();
    const stale = "5eed009c-0000-4000-8000-0000000000e1";
    store.channelRows.push({
      ...row("C071LOOPS"),
      id: stale,
      connection_id: "5eed009c-0000-4000-8000-0000000000e0",
    });

    const error = await refusal(service.bind(ORG, KEN.userId, stale, "loops"));

    expect(error.code).toBe(SLACK_ERRORS.channelNotFound);
  });

  it("is a 409 slack_not_connected once the install is revoked", async () => {
    const { service, installs, store, audit, row, snapshot } = await setup();
    await installs.revoke(store.connections[0], "app_uninstalled", "event");
    audit.events.length = 0;
    const before = snapshot();

    const error = await refusal(service.bind(ORG, KEN.userId, row("C071LOOPS").id, "loops"));

    expect(error.code).toBe(SLACK_ERRORS.notConnected);
    expect(error.getStatus()).toBe(409);
    expect(snapshot()).toBe(before);
    expect(store.transactions).toBe(0);
    expect(audit.events).toEqual([]);
  });

  it("is a 409 slack_channel_archived for a channel nobody can post to", async () => {
    const { service, store, audit, row, snapshot } = await setup();
    const before = snapshot();

    const error = await refusal(service.bind(ORG, KEN.userId, row("C075OLD").id, "alerts"));

    expect(error.code).toBe(SLACK_ERRORS.channelArchived);
    expect(error.getStatus()).toBe(409);
    expect(error.message).toContain("#helios-2024");
    expect(error.details).toEqual({ channelName: "helios-2024" });
    expect(snapshot()).toBe(before);
    expect(store.transactions).toBe(0);
    expect(audit.events).toEqual([]);
  });

  it("is a 409 slack_channel_not_joined that says how to add the bot — and that private channels are the same", async () => {
    const { service, store, audit, row, snapshot } = await setup();
    const before = snapshot();

    const error = await refusal(service.bind(ORG, KEN.userId, row("C074RANDOM").id, "loops"));

    expect(error.code).toBe(SLACK_ERRORS.channelNotJoined);
    expect(error.getStatus()).toBe(409);
    expect(error.message).toContain("/invite @Ouroboros");
    expect(error.message).toContain("#random");
    expect(error.message).toContain("cannot join a channel by itself");
    expect(error.message).toContain("try again");
    expect(error.message).toMatch(/Private channels work the same way/);
    expect(error.details).toEqual({ channelName: "random" });
    expect(snapshot()).toBe(before);
    expect(store.transactions).toBe(0);
    expect(audit.events).toEqual([]);
  });

  it("refuses an archived channel as archived even when the bot is not in it either", async () => {
    const { service, row } = await setup();
    row("C075OLD").joined = false;

    const error = await refusal(service.bind(ORG, KEN.userId, row("C075OLD").id, "alerts"));

    expect(error.code).toBe(SLACK_ERRORS.channelArchived);
  });
});

describe("binding a channel", () => {
  it("tags the channel and creates the purpose's default routes pointing at it", async () => {
    const { service, store, row } = await setup();
    const loops = row("C071LOOPS").id;

    const list = await service.bind(ORG, KEN.userId, loops, "loops");

    expect(row("C071LOOPS").purpose_tag).toBe("loops");
    expect(store.routeRows).toEqual([
      route({
        kind: "custom:blocking-questions",
        enabled: true,
        dm_on_call: true,
        chat_channel_id: loops,
        updated_by: KEN.userId,
      }),
      route({
        kind: "custom:loop-finished",
        enabled: true,
        chat_channel_id: loops,
        updated_by: KEN.userId,
      }),
      route({
        kind: "custom:stage-transitions",
        enabled: false,
        chat_channel_id: loops,
        updated_by: KEN.userId,
      }),
    ]);
    expect(list.channels[0]).toMatchObject({
      id: loops,
      purpose: "loops",
      routes: ["custom:blocking-questions", "custom:loop-finished", "custom:stage-transitions"],
    });
  });

  it("creates build failures for alerts, and the weekly insights for leads with the seed's empty config", async () => {
    const { service, row, stored } = await setup();

    await service.bind(ORG, KEN.userId, row("C072ALERT").id, "alerts");
    await service.bind(ORG, KEN.userId, row("C073LEADS").id, "leads");

    expect(stored("custom:build-failures")).toEqual(
      route({
        kind: "custom:build-failures",
        chat_channel_id: row("C072ALERT").id,
        updated_by: KEN.userId,
      }),
    );
    expect(stored("custom:weekly-insights")).toEqual(
      route({
        kind: "custom:weekly-insights",
        config: {},
        chat_channel_id: row("C073LEADS").id,
        updated_by: KEN.userId,
      }),
    );
  });

  it("matches mockup 19's five rows once all three purposes are bound", async () => {
    const { service, store, row } = await setup();

    await service.bind(ORG, KEN.userId, row("C071LOOPS").id, "loops");
    await service.bind(ORG, KEN.userId, row("C072ALERT").id, "alerts");
    await service.bind(ORG, KEN.userId, row("C073LEADS").id, "leads");

    expect(
      store.routeRows
        .map((found) => [found.kind, found.enabled, found.dm_on_call])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ["custom:blocking-questions", true, true],
      ["custom:build-failures", true, false],
      ["custom:loop-finished", true, false],
      ["custom:stage-transitions", false, false],
      ["custom:weekly-insights", true, false],
    ]);
    expect(Object.values(PURPOSE_ROUTES).flat()).toHaveLength(5);
  });

  it("re-points a route the workspace already has, leaving whether it is on, its DM and its config alone", async () => {
    const { service, store, row, stored } = await setup();
    const loops = row("C071LOOPS").id;
    store.routeRows.push(
      // Switched off by the workspace while pointed at another channel, and not DMing on-call:
      // the default would be on, with it.
      route({
        kind: "custom:blocking-questions",
        enabled: false,
        chat_channel_id: row("C072ALERT").id,
        updated_by: MAYA.userId,
      }),
      // Switched on by the workspace, DMing on-call: the default would be off.
      route({ kind: "custom:stage-transitions", enabled: true, dm_on_call: true }),
    );

    await service.bind(ORG, KEN.userId, loops, "loops");

    expect(stored("custom:blocking-questions")).toEqual(
      route({
        kind: "custom:blocking-questions",
        enabled: false,
        dm_on_call: false,
        chat_channel_id: loops,
        updated_by: KEN.userId,
      }),
    );
    expect(stored("custom:stage-transitions")).toEqual(
      route({
        kind: "custom:stage-transitions",
        enabled: true,
        dm_on_call: true,
        chat_channel_id: loops,
        updated_by: KEN.userId,
      }),
    );
    // The one it lacked is created as the default.
    expect(stored("custom:loop-finished")).toMatchObject({ enabled: true, dm_on_call: false });
  });

  it("switches a route back on that an unbind left off with no channel", async () => {
    const { service, store, row, stored } = await setup();
    const alerts = row("C072ALERT").id;
    store.routeRows.push(
      route({ kind: "custom:build-failures", enabled: true, chat_channel_id: alerts }),
    );

    await service.unbind(ORG, KEN.userId, alerts);
    expect(stored("custom:build-failures")).toMatchObject({
      enabled: false,
      chat_channel_id: null,
    });

    await service.bind(ORG, KEN.userId, alerts, "alerts");
    expect(stored("custom:build-failures")).toMatchObject({
      enabled: true,
      chat_channel_id: alerts,
    });
  });

  it("keeps a default-off route off when it is bound again", async () => {
    const { service, store, row, stored } = await setup();
    const loops = row("C071LOOPS").id;
    store.routeRows.push(route({ kind: "custom:stage-transitions", enabled: false }));

    await service.bind(ORG, KEN.userId, loops, "loops");

    expect(stored("custom:stage-transitions")).toMatchObject({
      enabled: false,
      chat_channel_id: loops,
    });
  });

  it("leaves a default kind the workspace bound to email exactly as it was, and does not report it", async () => {
    const { service, store, audit, row, stored } = await setup();
    const mailed = route({
      kind: "custom:weekly-insights",
      channel: "email",
      config: { weekday: "monday", time: "09:00" },
      updated_by: MAYA.userId,
    });
    store.routeRows.push({ ...mailed });

    const list = await service.bind(ORG, KEN.userId, row("C073LEADS").id, "leads");

    expect(stored("custom:weekly-insights")).toEqual(mailed);
    expect(row("C073LEADS").purpose_tag).toBe("leads");
    expect(list.channels.find((found) => found.name === "eng-leads")?.routes).toEqual([]);
    expect(audit.events[0].detail).toMatchObject({ purpose: "leads", routes: "" });
  });

  it("moves the purpose off the channel that held it, and its routes with it", async () => {
    const { service, row, stored } = await setup();
    const first = row("C071LOOPS").id;
    const second = row("C072ALERT").id;
    await service.bind(ORG, KEN.userId, first, "loops");

    const list = await service.bind(ORG, MAYA.userId, second, "loops");

    expect(row("C071LOOPS").purpose_tag).toBeNull();
    expect(row("C072ALERT").purpose_tag).toBe("loops");
    for (const { kind } of PURPOSE_ROUTES.loops) {
      expect(stored(kind)).toMatchObject({ chat_channel_id: second, updated_by: MAYA.userId });
    }
    // Moved, not reset: stage transitions is still off, the others still on.
    expect(stored("custom:stage-transitions")?.enabled).toBe(false);
    expect(stored("custom:loop-finished")?.enabled).toBe(true);
    expect(list.channels.filter((found) => found.purpose === "loops")).toHaveLength(1);
    expect(list.channels.find((found) => found.id === first)).toMatchObject({
      purpose: null,
      routes: [],
    });
  });

  it("leaves a previous holder's other routes where the workspace put them", async () => {
    const { service, store, row, stored } = await setup();
    const first = row("C071LOOPS").id;
    await service.bind(ORG, KEN.userId, first, "loops");
    store.routeRows.push(route({ kind: "custom:deploys", chat_channel_id: first }));

    await service.bind(ORG, KEN.userId, row("C072ALERT").id, "loops");

    expect(stored("custom:deploys")).toMatchObject({ chat_channel_id: first, enabled: true });
  });

  it("changes a channel's purpose: the old purpose's routes are detached and switched off, the new one's pointed here", async () => {
    const { service, row, stored } = await setup();
    const id = row("C072ALERT").id;
    await service.bind(ORG, KEN.userId, id, "alerts");

    const list = await service.bind(ORG, KEN.userId, id, "leads");

    expect(row("C072ALERT").purpose_tag).toBe("leads");
    expect(stored("custom:build-failures")).toMatchObject({
      chat_channel_id: null,
      enabled: false,
      updated_by: KEN.userId,
    });
    expect(stored("custom:weekly-insights")).toMatchObject({ chat_channel_id: id, enabled: true });
    expect(list.channels.find((found) => found.id === id)).toMatchObject({
      purpose: "leads",
      routes: ["custom:weekly-insights"],
    });
  });

  it("keeps a detached route on when it still DMs the on-call person", async () => {
    const { service, row, stored } = await setup();
    const id = row("C071LOOPS").id;
    await service.bind(ORG, KEN.userId, id, "loops");

    await service.bind(ORG, KEN.userId, id, "alerts");

    expect(stored("custom:blocking-questions")).toMatchObject({
      chat_channel_id: null,
      dm_on_call: true,
      enabled: true,
    });
    expect(stored("custom:loop-finished")).toMatchObject({ chat_channel_id: null, enabled: false });
    expect(stored("custom:build-failures")).toMatchObject({ chat_channel_id: id, enabled: true });
  });

  it("does not switch off a route both purposes share when a channel changes purpose", async () => {
    const { service, store, row, stored } = await setup();
    const id = row("C072ALERT").id;
    // The workspace already posts the weekly insights to the alerts channel.
    store.routeRows.push(route({ kind: "custom:weekly-insights", chat_channel_id: id }));
    row("C072ALERT").purpose_tag = "alerts";

    await service.bind(ORG, KEN.userId, id, "leads");

    expect(stored("custom:weekly-insights")).toMatchObject({ chat_channel_id: id, enabled: true });
  });

  it("binding the same channel for the same purpose again changes nothing it set", async () => {
    const { service, store, row, stored } = await setup();
    const id = row("C071LOOPS").id;
    await service.bind(ORG, KEN.userId, id, "loops");
    Object.assign(stored("custom:stage-transitions") ?? {}, { enabled: true });
    store.routeRows.push(route({ kind: "custom:deploys", chat_channel_id: id }));

    await service.bind(ORG, KEN.userId, id, "loops");

    expect(row("C071LOOPS").purpose_tag).toBe("loops");
    expect(store.routeRows).toHaveLength(4);
    expect(stored("custom:stage-transitions")).toMatchObject({
      chat_channel_id: id,
      enabled: true,
    });
    expect(stored("custom:deploys")).toMatchObject({ chat_channel_id: id, enabled: true });
  });

  it("does everything in one transaction, and keeps none of it when a statement fails", async () => {
    const { service, store, audit, row, snapshot } = await setup();
    await service.bind(ORG, KEN.userId, row("C071LOOPS").id, "loops");
    audit.events.length = 0;
    store.transactions = 0;
    const before = snapshot();
    const pointRoute = store.pointRoute.bind(store);
    let calls = 0;
    store.pointRoute = async (...args) => {
      calls += 1;
      if (calls === 2) {
        throw new Error("the database went away");
      }

      return pointRoute(...args);
    };

    await expect(service.bind(ORG, KEN.userId, row("C072ALERT").id, "loops")).rejects.toThrow(
      "the database went away",
    );

    expect(store.transactions).toBe(1);
    expect(snapshot()).toBe(before);
    expect(audit.events).toEqual([]);
  });

  it("records the binding once: who, which channel, for what, and the routes now posting there", async () => {
    const { service, store, audit, row } = await setup();
    const id = row("C071LOOPS").id;

    await service.bind(ORG, KEN.userId, id, "loops");

    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      organizationId: ORG,
      actorId: KEN.userId,
      action: "chat.channel_bound",
      subjectType: "chat_channel",
      subjectId: id,
      detail: {
        connectionId: store.connections[0].id,
        platformChannelId: "C071LOOPS",
        channelName: "ouroboros-loops",
        purpose: "loops",
        routes: "custom:blocking-questions,custom:loop-finished,custom:stage-transitions",
      },
    });
    expect(JSON.stringify(audit.events)).not.toContain(BOT_TOKEN);
  });
});

describe("unbinding a channel", () => {
  it("clears the purpose and detaches every Slack route posting there, whoever put it there", async () => {
    const { service, store, row, stored } = await setup();
    const id = row("C071LOOPS").id;
    await service.bind(ORG, KEN.userId, id, "loops");
    store.routeRows.push(route({ kind: "custom:deploys", chat_channel_id: id }));

    const list = await service.unbind(ORG, MAYA.userId, id);

    expect(row("C071LOOPS").purpose_tag).toBeNull();
    expect(store.routeRows.filter((found) => found.chat_channel_id !== null)).toEqual([]);
    expect(stored("custom:deploys")).toMatchObject({ enabled: false, updated_by: MAYA.userId });
    expect(list.channels.find((found) => found.id === id)).toMatchObject({
      purpose: null,
      routes: [],
    });
  });

  it("switches off a route left with nowhere to post, and keeps one that still DMs on-call", async () => {
    const { service, row, stored } = await setup();
    const id = row("C071LOOPS").id;
    await service.bind(ORG, KEN.userId, id, "loops");

    await service.unbind(ORG, KEN.userId, id);

    expect(stored("custom:loop-finished")).toMatchObject({ chat_channel_id: null, enabled: false });
    expect(stored("custom:stage-transitions")).toMatchObject({
      chat_channel_id: null,
      enabled: false,
    });
    expect(stored("custom:blocking-questions")).toMatchObject({
      chat_channel_id: null,
      dm_on_call: true,
      enabled: true,
    });
  });

  it("keeps the route that is a DM by nature on when its channel goes", async () => {
    const { service, store, row, stored } = await setup();
    const id = row("C071LOOPS").id;
    store.routeRows.push(route({ kind: "needs_you_dm", chat_channel_id: id }));

    await service.unbind(ORG, KEN.userId, id);

    expect(stored("needs_you_dm")).toMatchObject({ chat_channel_id: null, enabled: true });
  });

  it("touches no other channel's routes, and no other workspace's", async () => {
    const { service, store, row, stored } = await setup();
    const loops = row("C071LOOPS").id;
    await service.bind(ORG, KEN.userId, loops, "loops");
    await service.bind(ORG, KEN.userId, row("C072ALERT").id, "alerts");
    store.routeRows.push(
      route({ kind: "custom:theirs", chat_channel_id: loops, organization_id: "org-other" }),
    );

    await service.unbind(ORG, KEN.userId, loops);

    expect(stored("custom:build-failures")).toMatchObject({
      chat_channel_id: row("C072ALERT").id,
      enabled: true,
    });
    expect(row("C072ALERT").purpose_tag).toBe("alerts");
    expect(stored("custom:theirs")).toMatchObject({ chat_channel_id: loops, enabled: true });
  });

  it("unbinds a channel the bot has since left, or that was archived", async () => {
    const { service, row } = await setup();
    const id = row("C071LOOPS").id;
    await service.bind(ORG, KEN.userId, id, "loops");
    row("C071LOOPS").joined = false;
    row("C071LOOPS").archived = true;

    await expect(service.unbind(ORG, KEN.userId, id)).resolves.toMatchObject({ connected: true });
    expect(row("C071LOOPS").purpose_tag).toBeNull();
  });

  it("is idempotent: an unbound channel is answered the same, and nothing is recorded", async () => {
    const { service, audit, row, snapshot } = await setup();
    const id = row("C071LOOPS").id;
    await service.bind(ORG, KEN.userId, id, "loops");
    const first = await service.unbind(ORG, KEN.userId, id);
    audit.events.length = 0;
    const before = snapshot();

    const second = await service.unbind(ORG, KEN.userId, id);

    expect(second).toEqual(first);
    expect(snapshot()).toBe(before);
    expect(audit.events).toEqual([]);
  });

  it("records the unbinding once: the purpose it carried and the routes detached", async () => {
    const { service, store, audit, row } = await setup();
    const id = row("C072ALERT").id;
    await service.bind(ORG, KEN.userId, id, "alerts");
    audit.events.length = 0;

    await service.unbind(ORG, MAYA.userId, id);

    expect(audit.events).toEqual([
      expect.objectContaining({
        organizationId: ORG,
        actorId: MAYA.userId,
        action: "chat.channel_unbound",
        subjectType: "chat_channel",
        subjectId: id,
        detail: {
          connectionId: store.connections[0].id,
          platformChannelId: "C072ALERT",
          channelName: "helios-alerts",
          purpose: "alerts",
          routes: "custom:build-failures",
        },
      }),
    ]);
  });

  it("records a channel that carried routes and no purpose, with a null purpose", async () => {
    const { service, store, audit, row } = await setup();
    const id = row("C073LEADS").id;
    store.routeRows.push(route({ kind: "custom:deploys", chat_channel_id: id }));

    await service.unbind(ORG, KEN.userId, id);

    expect(audit.events).toHaveLength(1);
    expect(audit.events[0].detail).toMatchObject({ purpose: null, routes: "custom:deploys" });
  });

  it("refuses what a binding refuses about the address: 404 for no such channel, 409 when not connected", async () => {
    const { service, installs, store, row } = await setup();
    const id = row("C071LOOPS").id;

    const missing = await refusal(
      service.unbind(ORG, KEN.userId, "5eed009c-0000-4000-8000-0000000000aa"),
    );
    await installs.revoke(store.connections[0], "app_uninstalled", "event");
    const disconnected = await refusal(service.unbind(ORG, KEN.userId, id));

    expect([missing.code, missing.getStatus()]).toEqual([SLACK_ERRORS.channelNotFound, 404]);
    expect([disconnected.code, disconnected.getStatus()]).toEqual([SLACK_ERRORS.notConnected, 409]);
    expect(store.transactions).toBe(0);
  });
});

describe("the binding's body", () => {
  /** The validation complaints about a body. */
  async function problems(body: unknown): Promise<string[]> {
    const errors = await validate(plainToInstance(PutSlackChannelBindingDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    return errors.flatMap((error) => Object.values(error.constraints ?? {}));
  }

  it.each(["loops", "alerts", "leads"])("takes %s", async (purpose) => {
    await expect(problems({ purpose })).resolves.toEqual([]);
  });

  it.each([
    [{}],
    [{ purpose: "dm" }],
    [{ purpose: "Loops" }],
    [{ purpose: null }],
    [{ purpose: 1 }],
  ])("refuses %j, naming the three it takes", async (body) => {
    await expect(problems(body)).resolves.toEqual(["purpose must be loops, alerts or leads"]);
  });

  it("refuses a field it does not know", async () => {
    await expect(problems({ purpose: "loops", channel: "C071LOOPS" })).resolves.toHaveLength(1);
  });
});
