import { InboxController } from "./inbox.controller";
import { InboxFeedService, inboxFeedOf } from "./inbox.feed";
import { DecisionStore } from "./decision.store.fixture";
import type { Organization } from "../db/schema";

/** The pill feed (#461): real counts by severity, snooze-aware, the badge's number. */

const NOW = new Date("2026-10-04T09:12:00.000Z");

describe("inboxFeedOf", () => {
  it("folds per-severity rows into the feed, counting an absent severity as zero", () => {
    expect(
      inboxFeedOf(
        [
          { severity: "err", open: 1, snoozed: 0, nextWakeAt: null },
          { severity: "warn", open: 2, snoozed: 1, nextWakeAt: new Date("2026-10-04T10:00:00Z") },
          { severity: "info", open: 0, snoozed: 2, nextWakeAt: new Date("2026-10-04T09:30:00Z") },
        ],
        NOW,
      ),
    ).toEqual({
      open: 3,
      bySeverity: { err: 1, warn: 2, info: 0 },
      snoozed: 3,
      nextWakeAt: "2026-10-04T09:30:00.000Z",
      asOf: NOW.toISOString(),
    });
  });

  it("is all zeros, with no wake, for an empty inbox", () => {
    expect(inboxFeedOf([], NOW)).toEqual({
      open: 0,
      bySeverity: { err: 0, warn: 0, info: 0 },
      snoozed: 0,
      nextWakeAt: null,
      asOf: NOW.toISOString(),
    });
  });
});

describe("InboxFeedService", () => {
  /** A store holding mockup 16's three cards, one snoozed card, one answered and one elsewhere. */
  function seeded(): DecisionStore {
    const store = new DecisionStore();
    const base = { kindVersion: 1, payload: {}, refs: [], plane: "p", snoozedUntil: null };

    store.items.push(
      { ...base, id: "1", organizationId: "acme", kindId: "merge_approval", severity: "err", status: "open", sourceRef: "a" },
      { ...base, id: "2", organizationId: "acme", kindId: "protected_path_allow_once", severity: "warn", status: "open", sourceRef: "b" },
      { ...base, id: "3", organizationId: "acme", kindId: "claim_waiver", severity: "warn", status: "open", sourceRef: "c" },
      { ...base, id: "4", organizationId: "acme", kindId: "fact_review", severity: "info", status: "snoozed", sourceRef: "d", snoozedUntil: new Date("2026-10-04T10:12:00Z") },
      { ...base, id: "5", organizationId: "acme", kindId: "fact_review", severity: "info", status: "snoozed", sourceRef: "e", snoozedUntil: new Date("2026-10-04T09:00:00Z") },
      { ...base, id: "6", organizationId: "acme", kindId: "split_approval", severity: "info", status: "resolved", sourceRef: "f" },
      { ...base, id: "7", organizationId: "globex", kindId: "merge_approval", severity: "err", status: "open", sourceRef: "g" },
    );

    return store;
  }

  it("matches the queue: open items by severity, a hidden snooze apart, an elapsed snooze back in, answered and other workspaces' items nowhere", async () => {
    const service = new InboxFeedService(seeded().asRepository());
    jest.spyOn(service, "now").mockReturnValue(NOW);

    expect(await service.feed("acme")).toEqual({
      open: 4,
      bySeverity: { err: 1, warn: 2, info: 1 },
      snoozed: 1,
      nextWakeAt: "2026-10-04T10:12:00.000Z",
      asOf: NOW.toISOString(),
    });
  });

  it("is served at GET /inbox/feed for the session's workspace", async () => {
    const service = new InboxFeedService(seeded().asRepository());
    jest.spyOn(service, "now").mockReturnValue(NOW);

    const answer = await new InboxController(service).read({ id: "globex" } as Organization);

    expect(answer.open).toBe(1);
    expect(answer.bySeverity.err).toBe(1);
  });
});
