import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { InboxRepository } from "./inbox.repository";

/**
 * The page's statements (#464): every read inside the workspace; the queue treats an elapsed snooze
 * as open, exactly as the pill does; snooze goes through V095's functions; un-snooze touches only
 * snoozed items.
 */

const ORG = "org-acme";
const NOW = new Date("2026-10-04T10:00:00Z");

describe("InboxRepository", () => {
  let database: RecordingDatabase;
  let repository: InboxRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new InboxRepository(database.service);
  });

  it("wakes elapsed snoozes through V095's function", async () => {
    database.answers({ rows: [{ woken: 2 }] });

    expect(await repository.wake(ORG)).toBe(2);
    expect(database.statements[0].sql).toContain("ouroboros.decision_items_wake(");
  });

  it("reads the open queue newest first, counting an elapsed snooze as open", async () => {
    await repository.open(ORG, NOW);

    const [statement] = database.statements;

    expect(statement.sql).toContain('"organization_id" = $1');
    expect(statement.sql).toContain('"snoozed_until" <= $');
    expect(statement.sql).toContain('order by "created_at" desc');
    expect(statement.parameters).toEqual(expect.arrayContaining([ORG, "open", "snoozed", NOW]));
  });

  it("reads the hidden items soonest-to-wake first", async () => {
    await repository.snoozed(ORG, NOW);

    expect(database.statements[0].sql).toContain('"snoozed_until" > $');
    expect(database.statements[0].sql).toContain('order by "snoozed_until"');
  });

  it("reads one UTC day's resolutions and the previous day with any", async () => {
    await repository.resolved(ORG, "2026-10-04");
    await repository.previousDay(ORG, "2026-10-04");

    expect(database.statements[0].sql).toContain("at time zone 'UTC'");
    expect(database.statements[0].parameters).toEqual([ORG, "2026-10-04", "2026-10-04"]);
    expect(database.statements[1].sql).toContain("max(r.resolved_at at time zone 'UTC')");
  });

  it("reads the week from decision_metrics_weekly, durations as seconds", async () => {
    database.answers({
      rows: [
        {
          week: "2026-09-28",
          decisions: 11,
          median_seconds: "41",
          max_wait_seconds: "360",
          policy_resolutions: 1,
          auto_accept_share: "0.0909",
          per_kind: { resize_review: 25 },
        },
      ],
    });

    expect(await repository.week(ORG, "2026-09-28")).toEqual({
      week: "2026-09-28",
      decisions: 11,
      medianAnswerSeconds: 41,
      maxLoopWaitSeconds: 360,
      policyResolutions: 1,
      autoAcceptShare: 0.0909,
      perKind: { resize_review: 25 },
    });
    expect(database.statements[0].sql).toContain("from ouroboros.decision_metrics_weekly w");
  });

  it("answers no week when nothing was answered", async () => {
    expect(await repository.week(ORG, "2026-09-28")).toBeUndefined();
  });

  it("snoozes through V095's functions, and reads Snooze all's caught items", async () => {
    database.answers(
      { rows: [{ event_id: "event-1" }] },
      { rows: [{ event_id: "event-2" }] },
      {
        rows: [{ items: ["a", "b"] }],
      },
    );

    expect(await repository.snooze("item-1", NOW, "user-ken", null)).toBe("event-1");
    expect(await repository.snoozeAll(ORG, NOW, null, "lunch")).toEqual({
      eventId: "event-2",
      items: ["a", "b"],
    });
    expect(database.statements[0].sql).toContain("ouroboros.decision_item_snooze(");
    expect(database.statements[1].sql).toContain("ouroboros.decision_items_snooze_all(");
  });

  it("records nothing more when Snooze all caught nothing", async () => {
    database.answers({ rows: [{ event_id: null }] });

    expect(await repository.snoozeAll(ORG, NOW, null, null)).toEqual({ eventId: null, items: [] });
    expect(database.statements).toHaveLength(1);
  });

  it("un-snoozes only snoozed items of the workspace — one, or all", async () => {
    await repository.unsnooze(ORG, "item-1");
    await repository.unsnooze(ORG, null);

    expect(database.statements[0].sql).toContain('"status" = $');
    expect(database.statements[0].parameters).toEqual(
      expect.arrayContaining([ORG, "snoozed", "item-1"]),
    );
    expect(database.statements[1].parameters).not.toContain("item-1");
  });
});
