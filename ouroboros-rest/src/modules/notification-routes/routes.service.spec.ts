import type { AuditRecord } from "../audit/audit.events";
import type { AuditService } from "../audit/audit.service";
import {
  ConflictError,
  DomainError,
  InvalidRequestError,
  NotFoundError,
} from "../errors/error.envelope";
import { NotificationRoutesService, changedFields, defaultRoute } from "./routes.service";
import { FakeRouteStore } from "./routes.store.fixture";

/**
 * The notifications card's operations (#488): the four core routes always present, the
 * locked-row rule enforced on the server, and every change audited with before and after.
 */

const ORG = "org-acme";
const KEN = "u-ken";

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

    expect(card.items.map((item) => [item.kind, item.channel, item.enabled, item.stored])).toEqual([
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

  it("derives a stored route's lock, and lists custom kinds after the core four", async () => {
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

describe("the helpers", () => {
  it("compare configs as stored, so a reordered list is no change", () => {
    expect(
      changedFields(
        { channel: "email", config: { recipients: ["a@x.dev"], time: "09:00" }, enabled: true },
        { channel: "email", config: { time: "09:00", recipients: ["a@x.dev"] }, enabled: true },
      ),
    ).toEqual([]);
  });

  it("default a custom kind to email, off and unlocked", () => {
    expect(defaultRoute("custom:release-notes")).toMatchObject({
      channel: "email",
      enabled: false,
      locked: false,
      stored: false,
    });
  });
});
