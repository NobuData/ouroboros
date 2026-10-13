import type { AuditRecord } from "../audit/audit.events";
import type { AuditService } from "../audit/audit.service";
import {
  ConflictError,
  DomainError,
  InvalidRequestError,
  NotFoundError,
} from "../errors/error.envelope";
import {
  NotificationRoutesService,
  changedFields,
  defaultRoute,
  defaultStored,
  slackTargeted,
} from "./routes.service";
import { FakeRouteStore } from "./routes.store.fixture";

/**
 * The notifications card's operations (#488): the four core routes always present, the
 * locked-row rule enforced on the server, and every change audited with before and after.
 */

const ORG = "org-acme";
const KEN = "u-ken";
/** Two bound channels of the workspace, and the ids their rows carry. */
const LOOPS = "0a000000-0000-4000-8000-000000000001";
const ALERTS = "0a000000-0000-4000-8000-000000000002";
/** An enabled email route with no chat target — what the helpers compare. */
const UNTARGETED = {
  channel: "email",
  config: {},
  enabled: true,
  chatChannelId: null,
  dmOnCall: false,
} as const;

/**
 * The service over an in-memory store and a recording trail.
 *
 * @returns The service, the store and what was audited.
 */
function harness(): {
  service: NotificationRoutesService;
  store: FakeRouteStore;
  trail: AuditRecord[];
} {
  const store = new FakeRouteStore();
  const trail: AuditRecord[] = [];
  const audit = {
    record: (event: AuditRecord) => {
      trail.push(event);
      return Promise.resolve("audit-id");
    },
  } as unknown as AuditService;

  return { service: new NotificationRoutesService(store.repository(), audit), store, trail };
}

/**
 * The refusal a call raises.
 *
 * @param call - The call.
 * @returns What it threw.
 */
async function refusal(call: Promise<unknown>): Promise<DomainError> {
  const error = await call.catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(DomainError);
  return error as DomainError;
}

describe("the notifications card", () => {
  it("shows the four core routes in the card's order, defaulted and off when nobody saved them", async () => {
    const { service } = harness();

    const card = await service.list(ORG);

    expect(
      card.items.slice(0, 4).map((item) => [item.kind, item.channel, item.enabled, item.stored]),
    ).toEqual([
      ["needs_you_dm", "slack", false, false],
      ["daily_digest", "email", false, false],
      ["loop_failures", "pagerduty", false, false],
      ["weekly_insights", "email", false, false],
    ]);
    expect(card.channels).toEqual([
      { channel: "email", available: true, reason: null },
      { channel: "slack", available: false, reason: "connect Slack first" },
      { channel: "pagerduty", available: false, reason: "connect PagerDuty first" },
    ]);
  });

  it("derives a stored route's lock, and lists other custom kinds last", async () => {
    const { service, store } = harness();
    store
      .route(ORG, "loop_failures", { channel: "pagerduty", config: {}, enabled: false })
      .route(ORG, "daily_digest", { channel: "email", config: { time: "09:00" }, enabled: true })
      .route(ORG, "custom:release-notes", { channel: "email", config: {}, enabled: true });

    const card = await service.list(ORG);
    const loop = card.items.find((item) => item.kind === "loop_failures");

    expect(loop).toMatchObject({
      locked: true,
      lockedReason: "connect PagerDuty first",
      delivering: false,
      stored: true,
    });
    expect(card.items.find((item) => item.kind === "daily_digest")).toMatchObject({
      locked: false,
      delivering: true,
      config: { time: "09:00" },
    });
    expect(card.items.map((item) => item.kind)).toEqual([
      "needs_you_dm",
      "daily_digest",
      "loop_failures",
      "weekly_insights",
      // The five chat routes are always listed between them (#543).
      "custom:loop-finished",
      "custom:blocking-questions",
      "custom:build-failures",
      "custom:weekly-insights",
      "custom:stage-transitions",
      "custom:release-notes",
    ]);
  });

  it("refuses a kind V094 would refuse", async () => {
    const { service } = harness();

    expect(await refusal(service.read(ORG, "pager"))).toBeInstanceOf(NotFoundError);
    expect(await refusal(service.update(ORG, KEN, "pager", { enabled: true }))).toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("saving a route", () => {
  it("round-trips the digest's time and the weekly report's target", async () => {
    const { service } = harness();

    await service.update(ORG, KEN, "daily_digest", { enabled: true, config: { time: "07:30" } });
    await service.update(ORG, KEN, "weekly_insights", {
      enabled: true,
      config: { weekday: "friday", time: "16:00", recipients: ["eng-leads@acme.dev"] },
    });

    const card = await service.list(ORG);

    expect(card.items.find((item) => item.kind === "daily_digest")).toMatchObject({
      enabled: true,
      delivering: true,
      config: { time: "07:30" },
      updatedBy: KEN,
    });
    expect(card.items.find((item) => item.kind === "weekly_insights")?.config).toEqual({
      time: "16:00",
      weekday: "friday",
      recipients: ["eng-leads@acme.dev"],
    });
  });

  it("refuses to enable a locked route, with the reason the card prints — and stores nothing", async () => {
    const { service, store, trail } = harness();

    const error = await refusal(service.update(ORG, KEN, "loop_failures", { enabled: true }));

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.envelope()).toEqual({
      code: "notification_route_locked",
      message: "The loop_failures route cannot be enabled on pagerduty: connect PagerDuty first.",
      details: {
        kind: "loop_failures",
        channel: "pagerduty",
        locked: true,
        reason: "connect PagerDuty first",
      },
    });
    expect(store.routes.size).toBe(0);
    expect(trail).toHaveLength(0);
  });

  it("refuses moving an enabled route onto a channel that cannot deliver", async () => {
    const { service } = harness();
    await service.update(ORG, KEN, "daily_digest", { enabled: true });

    const error = await refusal(service.update(ORG, KEN, "daily_digest", { channel: "slack" }));

    expect(error.envelope().details).toMatchObject({ reason: "connect Slack first" });
    expect((await service.read(ORG, "daily_digest")).channel).toBe("email");
  });

  it("lets a locked route be registered and configured while it stays off", async () => {
    const { service } = harness();

    const route = await service.update(ORG, KEN, "loop_failures", {
      enabled: false,
      config: { recipients: ["oncall@acme.dev"] },
    });

    expect(route).toMatchObject({ stored: true, enabled: false, locked: true, delivering: false });
  });

  it("enables a route once it is re-bound to a channel that delivers", async () => {
    const { service } = harness();

    const route = await service.update(ORG, KEN, "loop_failures", {
      channel: "email",
      enabled: true,
    });

    expect(route).toMatchObject({
      channel: "email",
      enabled: true,
      locked: false,
      delivering: true,
    });
  });

  it("names the malformed field of a bad config", async () => {
    const { service } = harness();

    const error = await refusal(
      service.update(ORG, KEN, "daily_digest", { config: { time: "9am" } }),
    );

    expect(error).toBeInstanceOf(InvalidRequestError);
    expect(error.envelope()).toMatchObject({
      code: "notification_route_config_invalid",
      details: { fields: { "config.time": ["time must be HH:MM, 00:00 to 23:59 (UTC)"] } },
    });
  });
});

describe("Slack routes once Slack is connected (#536)", () => {
  it("unlocks the default needs-you DM and lists Slack as an available channel", async () => {
    const { service, store } = harness();
    store.slackConnected.add(ORG);

    const card = await service.list(ORG);

    expect(card.items.find((route) => route.kind === "needs_you_dm")).toMatchObject({
      channel: "slack",
      locked: false,
      lockedReason: null,
      enabled: false,
      delivering: false,
    });
    expect(card.channels).toContainEqual({ channel: "slack", available: true, reason: null });
    expect(card.channels).toContainEqual({
      channel: "pagerduty",
      available: false,
      reason: "connect PagerDuty first",
    });
  });

  it("enables the needs-you DM, which needs no channel — it DMs whoever is on call", async () => {
    const { service, store } = harness();
    store.slackConnected.add(ORG);

    const route = await service.update(ORG, "user-ken", "needs_you_dm", { enabled: true });

    expect(route).toMatchObject({
      channel: "slack",
      enabled: true,
      locked: false,
      delivering: true,
    });
  });

  it("refuses to enable a Slack route that has nowhere to post, in the lock's own words", async () => {
    const { service, store } = harness();
    store.slackConnected.add(ORG);

    const error = await refusal(
      service.update(ORG, "user-ken", "weekly_insights", { channel: "slack", enabled: true }),
    );

    expect(error).toMatchObject({ code: "notification_route_locked" });
    expect(error.envelope().details).toMatchObject({ reason: "choose a Slack channel first" });
    expect(store.routes.has(`${ORG}|weekly_insights`)).toBe(false);
  });

  it("enables a Slack route whose channel is already bound", async () => {
    const { service, store } = harness();
    store.slackConnected.add(ORG);
    store.chatChannel(LOOPS, ORG, "ouroboros-loops").route(ORG, "custom:loop-finished", {
      channel: "slack",
      config: {},
      enabled: false,
      chatChannelId: LOOPS,
    });

    const route = await service.update(ORG, "user-ken", "custom:loop-finished", { enabled: true });

    expect(route).toMatchObject({ enabled: true, delivering: true });
  });

  it("locks every Slack route again when the connection goes", async () => {
    const { service, store } = harness();
    store.slackConnected.add(ORG);
    await service.update(ORG, "user-ken", "needs_you_dm", { enabled: true });
    store.slackConnected.delete(ORG);

    expect(await service.read(ORG, "needs_you_dm")).toMatchObject({
      enabled: true,
      locked: true,
      lockedReason: "connect Slack first",
      delivering: false,
    });
  });
});

describe("the audit of a route change", () => {
  it("records before and after, field by field", async () => {
    const { service, store, trail } = harness();
    store.route(ORG, "daily_digest", {
      channel: "email",
      config: { time: "09:00" },
      enabled: true,
    });

    await service.update(ORG, KEN, "daily_digest", { config: { time: "07:30" }, enabled: false });

    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({
      organizationId: ORG,
      actorId: KEN,
      action: "notification_route.updated",
      subjectType: "notification_route",
      subjectId: "daily_digest",
      detail: {
        kind: "daily_digest",
        fields: "config,enabled",
        previousSource: "stored",
        previousChannel: "email",
        channel: "email",
        previousEnabled: true,
        enabled: false,
        previousConfig: '{"time":"09:00"}',
        config: '{"time":"07:30"}',
      },
    });
  });

  it("says a first save replaced the default binding", async () => {
    const { service, trail } = harness();

    await service.update(ORG, KEN, "weekly_insights", { enabled: true });

    expect(trail[0]?.detail).toMatchObject({
      previousSource: "default",
      previousEnabled: false,
      enabled: true,
    });
  });

  it("writes nothing for a save that changes nothing", async () => {
    const { service, store, trail } = harness();
    store.route(ORG, "daily_digest", {
      channel: "email",
      config: { time: "09:00" },
      enabled: true,
    });

    await service.update(ORG, KEN, "daily_digest", { enabled: true, config: { time: "09:00" } });
    await service.update(ORG, KEN, "weekly_insights", {});

    expect(trail).toHaveLength(0);
    expect(store.routes.has(`${ORG}|weekly_insights`)).toBe(false);
  });
});

describe("a route's chat block (#543)", () => {
  const CHAT_KINDS = [
    "custom:loop-finished",
    "custom:blocking-questions",
    "custom:build-failures",
    "custom:weekly-insights",
    "custom:stage-transitions",
  ];

  it("lists all five chat routes after the core four, in the card's order, with their defaults", async () => {
    const { service } = harness();

    const card = await service.list(ORG);

    expect(card.items.map((item) => item.kind)).toEqual([
      "needs_you_dm",
      "daily_digest",
      "loop_failures",
      "weekly_insights",
      ...CHAT_KINDS,
    ]);
    expect(
      card.items.slice(4).map((item) => [item.chat?.label, item.chat?.note, item.enabled]),
    ).toEqual([
      ["Loop finished (merged)", null, true],
      ["Blocking questions", null, true],
      ["Build failures", null, true],
      ["Weekly insights report", null, true],
      ["Every stage transition", "noisy, off by default", false],
    ]);
    expect(card.items.slice(4).map((item) => item.chat?.dmOnCall)).toEqual([
      false,
      true,
      false,
      false,
      false,
    ]);

    for (const item of card.items.slice(4)) {
      expect(item).toMatchObject({
        channel: "slack",
        stored: false,
        delivering: false,
        locked: true,
        lockedReason: "connect Slack first",
        chat: { channel: null },
      });
    }
  });

  it("gives every route that is not a chat route a null block", async () => {
    const { service, store } = harness();
    store
      .route(ORG, "custom:release-notes", { channel: "email", config: {}, enabled: true })
      .route(ORG, "custom:pager", { channel: "slack", config: {}, enabled: false })
      .route(ORG, "custom:build-failures", { channel: "email", config: {}, enabled: true });

    const card = await service.list(ORG);
    const chat = (kind: string) => card.items.find((item) => item.kind === kind)?.chat;

    expect(chat("needs_you_dm")).toBeNull();
    expect(chat("daily_digest")).toBeNull();
    expect(chat("loop_failures")).toBeNull();
    expect(chat("weekly_insights")).toBeNull();
    // A custom kind the card does not list, on either channel.
    expect(chat("custom:release-notes")).toBeNull();
    expect(chat("custom:pager")).toBeNull();
    // A chat route somebody re-bound to email posts to no chat channel while it is there.
    expect(chat("custom:build-failures")).toBeNull();
    // …and other custom kinds still follow the listed ones, by kind.
    expect(card.items.slice(9).map((item) => item.kind)).toEqual([
      "custom:pager",
      "custom:release-notes",
    ]);
  });

  it("draws a stored chat route from its row: the channel it posts to and its own on-call DM", async () => {
    const { service, store } = harness();
    store.slackConnected.add(ORG);
    store
      .chatChannel(LOOPS, ORG, "ouroboros-loops")
      .chatChannel(ALERTS, ORG, "helios-alerts", { joined: false, archived: true })
      .route(ORG, "custom:blocking-questions", {
        channel: "slack",
        config: {},
        enabled: true,
        chatChannelId: LOOPS,
        dmOnCall: false,
      })
      .route(ORG, "custom:build-failures", {
        channel: "slack",
        config: {},
        enabled: false,
        chatChannelId: ALERTS,
      });

    const card = await service.list(ORG);

    expect(card.items.find((item) => item.kind === "custom:blocking-questions")).toMatchObject({
      stored: true,
      enabled: true,
      delivering: true,
      // The row's own value, not the default's true.
      chat: {
        label: "Blocking questions",
        note: null,
        channel: { id: LOOPS, name: "ouroboros-loops", joined: true, archived: false },
        dmOnCall: false,
      },
    });
    expect(await service.read(ORG, "custom:build-failures")).toMatchObject({
      stored: true,
      enabled: false,
      chat: {
        label: "Build failures",
        channel: { id: ALERTS, name: "helios-alerts", joined: false, archived: true },
        dmOnCall: false,
      },
    });
    // The single-kind read of an unstored chat route is the list's default.
    expect(await service.read(ORG, "custom:stage-transitions")).toEqual(
      card.items.find((item) => item.kind === "custom:stage-transitions"),
    );
  });
});

describe("pointing a chat route at a channel (#543)", () => {
  /** A connected workspace with two bound channels and build failures posting to the first. */
  function bound(): ReturnType<typeof harness> {
    const made = harness();

    made.store.slackConnected.add(ORG);
    made.store
      .chatChannel(LOOPS, ORG, "ouroboros-loops")
      .chatChannel(ALERTS, ORG, "helios-alerts", { purpose: "alerts" })
      .route(ORG, "custom:build-failures", {
        channel: "slack",
        config: {},
        enabled: true,
        chatChannelId: LOOPS,
      });

    return made;
  }

  it("moves a stored route to another bound channel, leaving everything else as it was", async () => {
    const { service, store } = bound();

    const route = await service.update(ORG, KEN, "custom:build-failures", {
      chatChannelId: ALERTS,
    });

    expect(route).toMatchObject({
      enabled: true,
      delivering: true,
      chat: { channel: { id: ALERTS, name: "helios-alerts" }, dmOnCall: false },
    });
    expect(store.routes.get(`${ORG}|custom:build-failures`)).toMatchObject({
      channel: "slack",
      enabled: true,
      chatChannelId: ALERTS,
      dmOnCall: false,
      updatedBy: KEN,
    });
  });

  it("creates the row from the route's default when nobody saved it", async () => {
    const { service, store } = bound();

    const questions = await service.update(ORG, KEN, "custom:blocking-questions", {
      chatChannelId: LOOPS,
    });
    const transitions = await service.update(ORG, KEN, "custom:stage-transitions", {
      chatChannelId: LOOPS,
    });

    expect(questions).toMatchObject({
      stored: true,
      enabled: true,
      chat: { channel: { id: LOOPS }, dmOnCall: true },
    });
    expect(store.routes.get(`${ORG}|custom:blocking-questions`)).toMatchObject({
      channel: "slack",
      enabled: true,
      chatChannelId: LOOPS,
      dmOnCall: true,
    });
    // The noisy one stays off until somebody switches it on.
    expect(transitions).toMatchObject({ stored: true, enabled: false, delivering: false });
  });

  it("keeps a stored route's own on-call DM through a move", async () => {
    const { service, store } = bound();
    store.route(ORG, "custom:loop-finished", {
      channel: "slack",
      config: {},
      enabled: true,
      chatChannelId: LOOPS,
      dmOnCall: true,
    });

    await service.update(ORG, KEN, "custom:loop-finished", { chatChannelId: ALERTS });

    expect(store.routes.get(`${ORG}|custom:loop-finished`)).toMatchObject({
      chatChannelId: ALERTS,
      dmOnCall: true,
    });
  });

  it.each([
    ["an id that names nothing", "0a000000-0000-4000-8000-0000000000ff"],
    ["an id that is not a UUID", "C071LOOPS"],
    ["an unbound channel", "0a000000-0000-4000-8000-000000000003"],
    ["a DM conversation", "0a000000-0000-4000-8000-000000000004"],
    ["another workspace's channel", "0a000000-0000-4000-8000-000000000005"],
  ])("answers 404 chat_channel_not_found for %s, and stores nothing", async (_label, id) => {
    const { service, store, trail } = bound();
    store
      .chatChannel("0a000000-0000-4000-8000-000000000003", ORG, "random", { purpose: null })
      .chatChannel("0a000000-0000-4000-8000-000000000004", ORG, "D0KEN", { purpose: "dm" })
      .chatChannel("0a000000-0000-4000-8000-000000000005", "org-other", "their-loops");

    const error = await refusal(
      service.update(ORG, KEN, "custom:build-failures", { chatChannelId: id }),
    );

    expect(error).toBeInstanceOf(NotFoundError);
    expect([error.code, error.getStatus()]).toEqual(["chat_channel_not_found", 404]);
    expect(store.routes.get(`${ORG}|custom:build-failures`)?.chatChannelId).toBe(LOOPS);
    expect(trail).toHaveLength(0);
  });

  it.each([
    ["needs_you_dm", {}],
    ["daily_digest", {}],
    ["custom:release-notes", {}],
    // A chat kind the same save binds to email is not a chat route either.
    ["custom:build-failures", { channel: "email" as const }],
  ])("answers 422 for %s, which posts to no chat channel", async (kind, patch) => {
    const { service, trail } = bound();

    for (const chatChannelId of [ALERTS, null]) {
      const error = await refusal(service.update(ORG, KEN, kind, { ...patch, chatChannelId }));

      expect(error).toBeInstanceOf(InvalidRequestError);
      expect([error.code, error.getStatus()]).toEqual(["notification_route_not_chat", 422]);
      expect(error.message).toBe(`The ${kind} route does not post to a chat channel.`);
      expect(error.envelope().details).toMatchObject({
        fields: { chatChannelId: [`The ${kind} route does not post to a chat channel.`] },
      });
    }

    expect(trail).toHaveLength(0);
  });

  it("refuses to clear the channel of an enabled route with nowhere else to post — cleanly", async () => {
    const { service, store, trail } = bound();

    const error = await refusal(
      service.update(ORG, KEN, "custom:build-failures", { chatChannelId: null }),
    );

    expect(error).toBeInstanceOf(ConflictError);
    expect([error.code, error.getStatus()]).toEqual(["notification_route_locked", 409]);
    expect(error.message).toBe(
      "The custom:build-failures route cannot be enabled on slack: choose a Slack channel first.",
    );
    expect(error.envelope().details).toMatchObject({ reason: "choose a Slack channel first" });
    expect(store.routes.get(`${ORG}|custom:build-failures`)?.chatChannelId).toBe(LOOPS);
    expect(trail).toHaveLength(0);
  });

  it("refuses to switch on a route nobody chose a channel for, the same way", async () => {
    const { service, store } = bound();

    const error = await refusal(
      service.update(ORG, KEN, "custom:stage-transitions", { enabled: true }),
    );

    expect([error.code, error.getStatus()]).toEqual(["notification_route_locked", 409]);
    expect(store.routes.has(`${ORG}|custom:stage-transitions`)).toBe(false);
  });

  it("clears the channel when the same save switches the route off", async () => {
    const { service, store } = bound();

    const route = await service.update(ORG, KEN, "custom:build-failures", {
      chatChannelId: null,
      enabled: false,
    });

    expect(route).toMatchObject({ enabled: false, stored: true, chat: { channel: null } });
    expect(store.routes.get(`${ORG}|custom:build-failures`)?.chatChannelId).toBeNull();
  });

  it("clears the channel of a route that still DMs on-call, which stays on", async () => {
    const { service, store } = bound();
    store.route(ORG, "custom:blocking-questions", {
      channel: "slack",
      config: {},
      enabled: true,
      chatChannelId: LOOPS,
      dmOnCall: true,
    });

    const route = await service.update(ORG, KEN, "custom:blocking-questions", {
      chatChannelId: null,
    });

    expect(route).toMatchObject({ enabled: true, chat: { channel: null, dmOnCall: true } });
  });

  it("drops the chat target of a route re-bound to email, as V130 requires", async () => {
    const { service, store } = bound();

    const route = await service.update(ORG, KEN, "custom:build-failures", { channel: "email" });

    expect(route).toMatchObject({ channel: "email", chat: null });
    expect(store.routes.get(`${ORG}|custom:build-failures`)).toMatchObject({
      chatChannelId: null,
      dmOnCall: false,
    });
  });

  it("audits the move like any other save, naming both channels", async () => {
    const { service, trail } = bound();

    await service.update(ORG, KEN, "custom:build-failures", { chatChannelId: ALERTS });
    await service.update(ORG, KEN, "custom:build-failures", { chatChannelId: ALERTS });

    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({
      organizationId: ORG,
      actorId: KEN,
      action: "notification_route.updated",
      subjectType: "notification_route",
      subjectId: "custom:build-failures",
      detail: {
        kind: "custom:build-failures",
        fields: "chatChannel",
        previousSource: "stored",
        previousChatChannelId: LOOPS,
        chatChannelId: ALERTS,
      },
    });
  });

  it("says a first save of a chat route replaced its default", async () => {
    const { service, trail } = bound();

    await service.update(ORG, KEN, "custom:weekly-insights", { chatChannelId: ALERTS });

    expect(trail[0]?.detail).toMatchObject({
      fields: "chatChannel",
      previousSource: "default",
      previousChannel: "slack",
      previousEnabled: true,
      enabled: true,
      previousChatChannelId: null,
      chatChannelId: ALERTS,
    });
  });
});

describe("the helpers", () => {
  it("start a chat route from the card's default, and every other kind off with no target", () => {
    expect(defaultStored("custom:blocking-questions")).toEqual({
      channel: "slack",
      config: {},
      enabled: true,
      chatChannelId: null,
      dmOnCall: true,
    });
    expect(defaultStored("custom:stage-transitions")).toMatchObject({ enabled: false });
    expect(defaultStored("needs_you_dm")).toEqual({
      channel: "slack",
      config: {},
      enabled: false,
      chatChannelId: null,
      dmOnCall: false,
    });
  });

  it("ask V130's target rule of a Slack route only", () => {
    const slack = { ...UNTARGETED, channel: "slack" } as const;

    expect(slackTargeted("custom:build-failures", slack)).toBe(false);
    expect(slackTargeted("custom:build-failures", { ...slack, chatChannelId: LOOPS })).toBe(true);
    expect(slackTargeted("custom:build-failures", { ...slack, dmOnCall: true })).toBe(true);
    expect(slackTargeted("needs_you_dm", slack)).toBe(true);
    expect(slackTargeted("daily_digest", UNTARGETED)).toBe(true);
  });

  it("compare configs as stored, so a reordered list is no change", () => {
    expect(
      changedFields(
        { ...UNTARGETED, config: { recipients: ["a@x.dev"], time: "09:00" } },
        { ...UNTARGETED, config: { time: "09:00", recipients: ["a@x.dev"] } },
      ),
    ).toEqual([]);
  });

  it("default a custom kind to email, off and unlocked", () => {
    expect(defaultRoute("custom:release-notes", { slackConnected: false })).toMatchObject({
      channel: "email",
      enabled: false,
      locked: false,
      stored: false,
    });
  });
});
