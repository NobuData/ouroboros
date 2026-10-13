import type { AuditService } from "../audit/audit.service";
import { recordingDatabase } from "../db/database.fixture";
import { NotificationRoutesRepository } from "../notification-routes/routes.repository";
import { NotificationRoutesService } from "../notification-routes/routes.service";
import { FakeRouteStore } from "../notification-routes/routes.store.fixture";
import { enqueueBuildCard } from "./chat.outbox";

/**
 * Delivery follows the edit (CA.3, [#543](https://github.com/NobuData/ouroboros/issues/543)):
 * moving *Build failures* to another channel on the routing card changes where the next build
 * failure is enqueued for.
 *
 * There is no cache and no second store between the two, and this suite holds both halves to
 * that, with the real save and the real publisher statement over one recorded connection:
 *
 * ```
 * PATCH custom:build-failures { chatChannelId }  ─▶ notification_routes.chat_channel_id := new
 * enqueueBuildCard(build_failed)                  ─▶ target := notification_routes.chat_channel_id
 *                                                    (read in the enqueueing statement itself)
 * ```
 *
 * What the publisher's statement does with real rows — an enabled route, an active connection —
 * is `ouroboros-db/tests/constraints.sql` (V134's section); this suite fixes the column the two
 * sides share.
 */

const ORG = "org-acme";
const KEN = "u-ken";
const OLD = "0a000000-0000-4000-8000-000000000001";
const NEW = "0a000000-0000-4000-8000-000000000002";
const audit = { record: () => Promise.resolve("audit-id") } as unknown as AuditService;

describe("delivery follows a route edit", () => {
  it("stores the new channel on the row the publisher reads its target from", async () => {
    const database = recordingDatabase();
    const service = new NotificationRoutesService(
      new NotificationRoutesRepository(database.service),
      audit,
    );

    database.answers(
      // The route as stored: on, posting to the old channel.
      {
        rows: [
          { channel: "slack", config: {}, enabled: true, chat_channel_id: OLD, dm_on_call: false },
        ],
      },
      // The new channel is a bound one of this workspace.
      { rows: [{ id: NEW }] },
      // Slack is connected.
      { rows: [{ id: "connection" }] },
    );

    await service.update(ORG, KEN, "custom:build-failures", { chatChannelId: NEW });

    const write = database.statements.find((statement) =>
      statement.sql.startsWith('insert into "ouroboros"."notification_routes"'),
    );

    // The save: `chat_channel_id` is written with the new channel, whether the row is new or not.
    expect(write?.sql).toMatch(
      /on conflict \("organization_id", "kind"\) do update set .*"chat_channel_id" = \$\d+/,
    );
    expect(write?.parameters).toContain(NEW);
    expect(write?.parameters).not.toContain(OLD);
    expect(write?.parameters.slice(0, 2)).toEqual([ORG, "custom:build-failures"]);

    // The publisher, on the same connection, afterwards: one statement, which takes its channel
    // from that column of that table as it enqueues — nothing it could have remembered.
    const before = database.statements.length;

    await enqueueBuildCard(database.service.db, "build_failed", {
      organizationId: ORG,
      runId: "run-1847",
      loopSeq: 1847,
      passed: 61,
      total: 63,
    });

    expect(database.statements).toHaveLength(before + 1);

    const enqueue = database.statements[before];

    expect(enqueue.sql).toMatch(
      /select r\.kind, r\.chat_channel_id, r\.dm_on_call, c\.id as connection_id\s+from ouroboros\.notification_routes r/,
    );
    expect(enqueue.sql).toMatch(
      /join ouroboros\.chat_channels ch\s+on ch\.id = routes\.chat_channel_id/,
    );
    expect(enqueue.sql).toMatch(/insert into ouroboros\.chat_outbox[\s\S]+chosen\.channel_id/);
    expect(enqueue.parameters).toEqual(expect.arrayContaining([ORG, "custom:build-failures"]));
    // No channel is passed in: where it goes is entirely the route's row.
    expect(enqueue.parameters).not.toContain(OLD);
    expect(enqueue.parameters).not.toContain(NEW);
  });

  it("changes the route's target for the next message, and only that route's", async () => {
    const store = new FakeRouteStore();
    const service = new NotificationRoutesService(store.repository(), audit);

    store.slackConnected.add(ORG);
    store
      .chatChannel(OLD, ORG, "ouroboros-loops")
      .chatChannel(NEW, ORG, "helios-alerts", { purpose: "alerts" })
      .route(ORG, "custom:build-failures", {
        channel: "slack",
        config: {},
        enabled: true,
        chatChannelId: OLD,
      })
      .route(ORG, "custom:loop-finished", {
        channel: "slack",
        config: {},
        enabled: true,
        chatChannelId: OLD,
      });

    /** The channel row each stored route would be enqueued for. */
    const targets = (): Record<string, string | null> =>
      Object.fromEntries(
        [...store.routes.values()].map((route) => [route.kind, route.chatChannelId]),
      );

    expect(targets()).toEqual({ "custom:build-failures": OLD, "custom:loop-finished": OLD });

    await service.update(ORG, KEN, "custom:build-failures", { chatChannelId: NEW });

    expect(targets()).toEqual({ "custom:build-failures": NEW, "custom:loop-finished": OLD });
  });
});
