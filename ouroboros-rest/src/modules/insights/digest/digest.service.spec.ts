import type { SessionUser } from "../../auth/principal";
import type { AppConfigService } from "../../config/config.service";
import type { Organization } from "../../db/schema";
import { ConflictError } from "../../errors/error.envelope";
import { RecordingMailer } from "../../mail/mail.fixture";
import type { InsightsPageService } from "../page/page.service";
import { DIGEST_CONTENT_VERSION } from "./digest.assembly";
import { DIGEST_ERRORS } from "./digest.errors";
import { weekPage } from "./digest.fixture";
import { DEFAULT_DIGEST_SCHEDULE, DigestService } from "./digest.service";
import { FakeDigestStore } from "./digest.store.fixture";
import { hashUnsubscribeToken, mintUnsubscribeToken } from "./digest.token";

/** Thursday noon, UTC. */
const NOW = new Date("2026-10-01T12:00:00.000Z");

const ACME = { id: "org-acme", name: "Acme Robotics" } as Organization;
const KEN = { id: "ken", email: "ken@acme.dev", name: "Ken" } as SessionUser;

/**
 * A service over an in-memory store.
 *
 * @param transport - Whether this deployment can send mail.
 * @returns The service and what it was built over.
 */
function build(transport: "smtp" | "none" = "smtp") {
  const store = new FakeDigestStore()
    .workspace(ACME.id, ACME.name)
    .member(ACME.id, KEN.id, KEN.email, null);
  const read = jest.fn((_organizationId: string, _request: { range: string; now?: Date }) =>
    Promise.resolve(weekPage()),
  );
  const service = new DigestService(
    store.repository,
    { read } as unknown as InsightsPageService,
    new RecordingMailer(transport),
    { uiUrl: "https://app.acme.dev" } as unknown as AppConfigService,
    () => NOW.getTime(),
  );

  return { service, store, read };
}

/**
 * A send the store remembers, so its token resolves.
 *
 * @param store - The store.
 * @param userId - Who it was sent to.
 * @returns The token the mail carried.
 */
async function sentTo(store: FakeDigestStore, userId: string): Promise<string> {
  const { token, hash } = mintUnsubscribeToken();

  await store.claimRun(ACME.id, () => NOW);
  await store.claimSend({
    organizationId: ACME.id,
    runId: "run-1",
    userId,
    recipient: KEN.email,
    attempt: 1,
    messageId: "<m@acme.dev>",
    unsubscribeTokenHash: hash,
  });

  return token;
}

describe("the digest's state", () => {
  it("is opt-in: nobody is subscribed until they ask, and the schedule is the default", async () => {
    const { service } = build();

    expect(DEFAULT_DIGEST_SCHEDULE).toEqual({ weeklyDay: 1, weeklyTime: "09:00" });
    expect(await service.state(ACME, KEN)).toEqual({
      subscribed: false,
      recipient: "ken@acme.dev",
      schedule: {
        weeklyDay: 1,
        weeklyTime: "09:00",
        timezone: "UTC",
        // The Monday after a Thursday.
        nextRunAt: "2026-10-05T09:00:00.000Z",
      },
      mail: { transport: "smtp" },
    });
  });

  it("states the workspace's own slot once one is saved", async () => {
    const { service, store } = build();
    store.schedules.set(ACME.id, { weeklyDay: 4, weeklyTime: "16:30" });

    expect((await service.state(ACME, KEN)).schedule).toEqual({
      weeklyDay: 4,
      weeklyTime: "16:30",
      timezone: "UTC",
      // Later today.
      nextRunAt: "2026-10-01T16:30:00.000Z",
    });
  });

  it("says when this deployment cannot send", async () => {
    expect((await build("none").service.state(ACME, KEN)).mail).toEqual({ transport: "none" });
  });
});

describe("subscribing", () => {
  it("round-trips, and asking twice is asking once", async () => {
    const { service, store } = build();

    expect((await service.setSubscription(ACME, KEN, true)).subscribed).toBe(true);
    expect((await service.setSubscription(ACME, KEN, true)).subscribed).toBe(true);
    expect(store.subscriptions).toHaveLength(1);

    expect((await service.setSubscription(ACME, KEN, false)).subscribed).toBe(false);
    expect((await service.setSubscription(ACME, KEN, false)).subscribed).toBe(false);
    expect(store.subscriptions).toEqual([]);
  });

  it("is refused on a deployment with no mail server, and stores nothing", async () => {
    const { service, store } = build("none");

    const refusal = await service.setSubscription(ACME, KEN, true).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ConflictError);
    expect((refusal as ConflictError).getResponse()).toMatchObject({
      code: DIGEST_ERRORS.mailUnconfigured,
    });
    expect(store.subscriptions).toEqual([]);
  });

  it("never refuses an unsubscribe, whatever the mail server's state", async () => {
    const { service, store } = build("none");
    await store.subscribe(ACME.id, KEN.id);

    expect((await service.setSubscription(ACME, KEN, false)).subscribed).toBe(false);
  });
});

describe("the schedule", () => {
  it("changes what the patch carries and keeps the rest, naming who saved it", async () => {
    const { service, store } = build();

    const day = await service.setSchedule(ACME, KEN, { weeklyDay: 5 });
    expect(day.schedule).toMatchObject({ weeklyDay: 5, weeklyTime: "09:00" });

    const time = await service.setSchedule(ACME, KEN, { weeklyTime: "16:30" });
    expect(time.schedule).toMatchObject({
      weeklyDay: 5,
      weeklyTime: "16:30",
      nextRunAt: "2026-10-02T16:30:00.000Z",
    });
    expect(store.scheduleAuthors.get(ACME.id)).toBe("ken");
  });

  it("writes nothing for a patch that carries nothing", async () => {
    const { service, store } = build();

    await service.setSchedule(ACME, KEN, {});

    expect(store.schedules.size).toBe(0);
  });
});

describe("the preview", () => {
  it("is the digest as of now, rendered by the code that sends it, with no unsubscribe link", async () => {
    const { service, read } = build();

    const preview = await service.preview(ACME);

    // The clock's now, not a slot's.
    expect(read.mock.calls).toEqual([[ACME.id, { range: "7d" }]]);
    expect(preview).toMatchObject({
      subject: "Weekly insights · Acme Robotics · Aug 2 – Aug 8, 2026",
      window: { from: "2026-08-02", to: "2026-08-08" },
      contentVersion: DIGEST_CONTENT_VERSION,
    });
    expect(preview.text).toContain("27 PRs merged this week. 12 needed a human.");
    expect(preview.html).toContain("https://app.acme.dev/insights?range=7d");
    expect(`${preview.html}${preview.text}`).not.toContain("nsubscribe");
  });
});

describe("the unsubscribe link", () => {
  it("opens a confirmation that changes nothing", async () => {
    const { service, store } = build();
    await store.subscribe(ACME.id, KEN.id);
    const token = await sentTo(store, KEN.id);

    const page = await service.unsubscribePage(token);

    expect(page.status).toBe(200);
    expect(page.html).toContain("weekly Insights digest for Acme Robotics");
    expect(store.subscriptions).toHaveLength(1);
  });

  it("unsubscribes on the button, and a second press is the same answer", async () => {
    const { service, store } = build();
    await store.subscribe(ACME.id, KEN.id);
    const token = await sentTo(store, KEN.id);

    const first = await service.unsubscribe(token);
    const second = await service.unsubscribe(token);

    expect(first).toMatchObject({ status: 200 });
    expect(first.html).toContain("You are unsubscribed");
    expect(second).toEqual(first);
    expect(store.subscriptions).toEqual([]);
  });

  it("still works after the person subscribed again: an old mail's link stops the new subscription", async () => {
    const { service, store } = build();
    const token = await sentTo(store, KEN.id);
    await store.subscribe(ACME.id, KEN.id);

    await service.unsubscribe(token);

    expect(store.subscriptions).toEqual([]);
  });

  it("answers a person since removed as done — there is nothing left to stop", async () => {
    const { service, store } = build();
    const token = await sentTo(store, KEN.id);
    (store.sendRows[0] as { userId: string | null }).userId = null;
    const unsubscribe = jest.spyOn(store, "unsubscribe");

    expect((await service.unsubscribe(token)).html).toContain("You are unsubscribed");
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it("answers a token no send carried with the invalid-link page", async () => {
    const { service } = build();
    const { token } = mintUnsubscribeToken();

    expect(await service.unsubscribePage(token)).toMatchObject({ status: 404 });
    expect(await service.unsubscribe(token)).toMatchObject({ status: 404 });
  });

  it.each(["{token}", "", "ouro_unsub_short", undefined, ["a"]])(
    "refuses %p by its shape, without a read",
    async (token) => {
      const { service, store } = build();
      const lookup = jest.spyOn(store, "unsubscribeTarget");

      expect(await service.unsubscribePage(token)).toMatchObject({ status: 404 });
      expect(await service.unsubscribe(token)).toMatchObject({ status: 404 });
      expect(lookup).not.toHaveBeenCalled();
    },
  );

  it("looks a token up by its hash, never by the token", async () => {
    const { service, store } = build();
    const token = await sentTo(store, KEN.id);
    const lookup = jest.spyOn(store, "unsubscribeTarget");

    await service.unsubscribePage(token);

    expect(lookup).toHaveBeenCalledWith(hashUnsubscribeToken(token));
  });
});
