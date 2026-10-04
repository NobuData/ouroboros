import { recordingDatabase } from "../db/database.fixture";
import { enqueueWebhookEvents } from "./webhook.outbox";

/** The outbox writer (#487): one insert on the executor it is given, one row per type. */

describe("queueing an event", () => {
  it("writes one row per type, sharing the payload, on the given executor", async () => {
    const database = recordingDatabase();
    database.answers({ rows: [{ id: "o-1" }, { id: "o-2" }] });

    const ids = await enqueueWebhookEvents(database.service.db, {
      organizationId: "org-acme",
      types: ["audit.decision.filed", "decision.filed"],
      data: { id: "audit-1" },
      occurredAt: new Date("2026-10-04T12:00:00.000Z"),
    });

    expect(ids).toEqual(["o-1", "o-2"]);
    expect(database.statements).toHaveLength(1);
    const [insert] = database.statements;
    expect(insert.sql).toContain('insert into "ouroboros"."webhook_outbox"');
    expect(insert.parameters.filter((p) => p === '{"id":"audit-1"}')).toHaveLength(2);
  });

  it("writes nothing for an event with no types", async () => {
    const database = recordingDatabase();

    await expect(
      enqueueWebhookEvents(database.service.db, {
        organizationId: "org-acme",
        types: [],
        data: {},
        occurredAt: new Date(),
      }),
    ).resolves.toEqual([]);
    expect(database.statements).toHaveLength(0);
  });
});
