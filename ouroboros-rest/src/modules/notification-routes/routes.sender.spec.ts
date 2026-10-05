import type { AppConfigService } from "../config/config.service";
import { RecordingMailer } from "../mail/mail.fixture";
import {
  MAX_ROUTE_ATTEMPTS,
  OrgRouteSender,
  routeMessageId,
  type RouteComposers,
} from "./routes.sender";
import { NotificationRoutesService } from "./routes.service";
import { FakeRouteStore } from "./routes.store.fixture";
import type { AuditService } from "../audit/audit.service";

/**
 * The org routes' sender (#488): routes drive real sends — the digest leaves at the route's time,
 * the weekly report reaches the route's target — and a disabled or locked route never fires.
 */

const ORG = "org-acme";
const CONFIG = { mailFrom: "ouroboros@acme.dev" } as AppConfigService;
const at = (iso: string): Date => new Date(iso);

/**
 * A sender over an in-memory store, a recording mailer and composers that say what they were
 * asked for.
 *
 * @param transport - The mailer's transport.
 * @returns The sender, the store, the mailer and the composers' calls.
 */
function harness(transport: "smtp" | "none" = "smtp") {
  const store = new FakeRouteStore().workspace(ORG, "Acme Robotics", [
    "ken@acme.dev",
    "maya@acme.dev",
  ]);
  const mailer = new RecordingMailer(transport);
  const composed: { kind: string; slot: Date }[] = [];
  const composer = (kind: string) => ({
    compose: (_org: string, name: string, slot: Date) => {
      composed.push({ kind, slot });
      return Promise.resolve({
        subject: `${kind} · ${name}`,
        text: `${kind} text`,
        html: `<p>${kind}</p>`,
      });
    },
  });
  const composers: RouteComposers = {
    daily_digest: composer("daily_digest"),
    weekly_insights: composer("weekly_insights"),
  };
  const sender = new OrgRouteSender(store.repository(), composers, mailer, CONFIG);
  const routes = new NotificationRoutesService(store.repository(), {
    record: () => Promise.resolve("audit-id"),
  } as unknown as AuditService);

  return { sender, store, mailer, composed, routes };
}

describe("the daily digest route", () => {
  it("goes out at the route's time, and moving the time moves the send", async () => {
    const { sender, mailer, routes } = harness();
    await routes.update(ORG, "u-ken", "daily_digest", {
      enabled: true,
      config: { time: "07:30", recipients: ["leads@acme.dev"] },
    });

    expect((await sender.tick(at("2026-10-05T07:29:00Z"))).outcomes).toEqual([]);
    expect(mailer.sent).toHaveLength(0);

    await sender.tick(at("2026-10-05T07:30:20Z"));
    expect(mailer.sent.map((mail) => mail.to)).toEqual(["leads@acme.dev"]);

    // Moved to 06:00: the next day's mail leaves at 06:00, not 07:30.
    await routes.update(ORG, "u-ken", "daily_digest", {
      config: { time: "06:00", recipients: ["leads@acme.dev"] },
    });
    await sender.tick(at("2026-10-06T06:00:20Z"));

    expect(mailer.sent).toHaveLength(2);
    await sender.tick(at("2026-10-06T07:30:20Z"));
    expect(mailer.sent).toHaveLength(2);
  });

  it("goes to the owners and admins when the route names nobody", async () => {
    const { sender, store, mailer } = harness();
    store.route(ORG, "daily_digest", {
      channel: "email",
      config: { time: "09:00" },
      enabled: true,
    });

    await sender.tick(at("2026-10-05T09:00:30Z"));

    expect(mailer.sent.map((mail) => mail.to)).toEqual(["ken@acme.dev", "maya@acme.dev"]);
  });

  it("is sent once per address per slot however many ticks run", async () => {
    const { sender, store, mailer, composed } = harness();
    store.route(ORG, "daily_digest", { channel: "email", config: {}, enabled: true });

    await sender.tick(at("2026-10-05T09:00:30Z"));
    await sender.tick(at("2026-10-05T09:01:30Z"));

    expect(mailer.sent).toHaveLength(2);
    expect(composed).toHaveLength(1);
    expect(store.sends.every((send) => send.status === "sent")).toBe(true);
  });

  it("carries one Message-ID per address and slot, on every attempt", async () => {
    const { sender, store, mailer } = harness();
    store.route(ORG, "daily_digest", {
      channel: "email",
      config: { recipients: ["a@acme.dev"] },
      enabled: true,
    });
    mailer.failFor("a@acme.dev", 1);

    await sender.tick(at("2026-10-05T09:00:30Z"));
    await sender.tick(at("2026-10-05T09:01:30Z"));

    const id = routeMessageId(
      { organizationId: ORG, kind: "daily_digest" },
      at("2026-10-05T09:00:00Z"),
      "a@acme.dev",
      "ouroboros@acme.dev",
    );
    expect(store.sends.map((send) => [send.attempt, send.status, send.messageId])).toEqual([
      [1, "failed", id],
      [2, "sent", id],
    ]);
    expect(id).toMatch(/^<route\.[0-9a-f]{32}@acme\.dev>$/);
  });

  it("gives up on an address after the last attempt", async () => {
    const { sender, store, mailer } = harness();
    store.route(ORG, "daily_digest", {
      channel: "email",
      config: { recipients: ["a@acme.dev"] },
      enabled: true,
    });
    mailer.failFor("a@acme.dev", 10);

    for (let minute = 0; minute < MAX_ROUTE_ATTEMPTS + 2; minute += 1) {
      await sender.tick(new Date(at("2026-10-05T09:00:30Z").getTime() + minute * 60_000));
    }

    expect(store.sends).toHaveLength(MAX_ROUTE_ATTEMPTS);
  });

  it("leaves an address another sender holds a live claim on to that sender", async () => {
    const { sender, store, mailer } = harness();
    store.route(ORG, "daily_digest", {
      channel: "email",
      config: { recipients: ["a@acme.dev"] },
      enabled: true,
    });
    store.sends.push({
      id: "theirs",
      organizationId: ORG,
      kind: "daily_digest",
      slotAt: at("2026-10-05T09:00:00Z"),
      recipient: "a@acme.dev",
      attempt: 1,
      messageId: "<x@acme.dev>",
      status: "claimed",
      error: null,
      claimedAt: store.now,
    });

    await sender.tick(at("2026-10-05T09:00:30Z"));

    expect(mailer.sent).toHaveLength(0);
  });
});

describe("the weekly insights route", () => {
  it("delivers the report to the configured target on its weekday", async () => {
    const { sender, mailer, routes, composed } = harness();
    await routes.update(ORG, "u-ken", "weekly_insights", {
      enabled: true,
      config: { weekday: "monday", time: "09:00", recipients: ["eng-leads@acme.dev"] },
    });

    // 2026-10-05 is a Monday.
    await sender.tick(at("2026-10-05T09:00:30Z"));

    expect(mailer.sent.map((mail) => [mail.to, mail.subject])).toEqual([
      ["eng-leads@acme.dev", "weekly_insights · Acme Robotics"],
    ]);
    expect(composed).toEqual([{ kind: "weekly_insights", slot: at("2026-10-05T09:00:00Z") }]);
  });
});

describe("a route that cannot fire", () => {
  it("sends nothing while disabled", async () => {
    const { sender, store, mailer } = harness();
    store.route(ORG, "daily_digest", { channel: "email", config: {}, enabled: false });

    await sender.tick(at("2026-10-05T09:00:30Z"));

    expect(mailer.sent).toHaveLength(0);
  });

  it("sends nothing while locked, even if it was stored enabled behind the API's back", async () => {
    const { sender, store, mailer } = harness();
    store.route(ORG, "daily_digest", { channel: "slack", config: {}, enabled: true });

    await sender.tick(at("2026-10-05T09:00:30Z"));

    expect(mailer.sent).toHaveLength(0);
  });

  it("sends nothing on a deployment without a mail server", async () => {
    const { sender, store, mailer } = harness("none");
    store.route(ORG, "daily_digest", { channel: "email", config: {}, enabled: true });

    expect(await sender.tick(at("2026-10-05T09:00:30Z"))).toEqual({ outcomes: [], errors: [] });
    expect(mailer.sent).toHaveLength(0);
  });

  it("costs one route a tick when its content cannot be composed, not the others", async () => {
    const { store, mailer } = harness();
    store.route(ORG, "daily_digest", { channel: "email", config: {}, enabled: true });
    store.route(ORG, "weekly_insights", { channel: "email", config: {}, enabled: true });
    const failing: RouteComposers = {
      daily_digest: { compose: () => Promise.reject(new Error("inbox unreadable")) },
      weekly_insights: {
        compose: () => Promise.resolve({ subject: "weekly", text: "t", html: "h" }),
      },
    };
    const sender = new OrgRouteSender(store.repository(), failing, mailer, CONFIG);

    const report = await sender.tick(at("2026-10-05T09:00:30Z"));

    expect(report.errors).toEqual([
      {
        organizationId: ORG,
        kind: "daily_digest",
        error: expect.stringContaining("inbox unreadable") as string,
      },
    ]);
    expect(mailer.sent.map((mail) => mail.subject)).toEqual(["weekly", "weekly"]);
  });
});
