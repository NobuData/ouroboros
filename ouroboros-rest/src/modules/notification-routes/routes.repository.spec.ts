import { DM_PURPOSE_TAG } from "../chat/chat.outbox";
import { recordingDatabase } from "../db/database.fixture";
import { NotificationRoutesRepository } from "./routes.repository";

/**
 * The statements #543 added to the routes' store, as they are sent: a save reads and writes the
 * route's chat target with the rest of the row, the card reads where each Slack route posts,
 * and a channel may be named only when it is this workspace's, bound, and not a DM.
 */

const ORG = "org-acme";
const CHANNEL = "0a000000-0000-4000-8000-000000000002";

describe("NotificationRoutesRepository — a route's chat target (#543)", () => {
  it("reads the stored route with its channel and on-call DM, locked for the save", async () => {
    const database = recordingDatabase();
    const repository = new NotificationRoutesRepository(database.service);

    database.answers({
      rows: [
        {
          channel: "slack",
          config: {},
          enabled: true,
          chat_channel_id: CHANNEL,
          dm_on_call: true,
        },
      ],
    });

    await expect(
      repository.transaction((trx) => repository.stored(trx, ORG, "custom:blocking-questions")),
    ).resolves.toEqual({
      channel: "slack",
      config: {},
      enabled: true,
      chatChannelId: CHANNEL,
      dmOnCall: true,
    });
    expect(database.sql()[1]).toBe(
      'select "channel", "config", "enabled", "chat_channel_id", "dm_on_call" ' +
        'from "ouroboros"."notification_routes" ' +
        'where "organization_id" = $1 and "kind" = $2 for update',
    );
  });

  it("writes the chat target on insert and on update alike", async () => {
    const database = recordingDatabase();
    const repository = new NotificationRoutesRepository(database.service);

    await repository.transaction((trx) =>
      repository.upsert(trx, ORG, "custom:build-failures", {
        channel: "slack",
        config: {},
        enabled: true,
        chatChannelId: CHANNEL,
        dmOnCall: false,
        updatedBy: "u-ken",
      }),
    );

    expect(database.sql()[1]).toBe(
      'insert into "ouroboros"."notification_routes" ' +
        '("organization_id", "kind", "channel", "config", "enabled", "chat_channel_id", ' +
        '"dm_on_call", "updated_by") values ($1, $2, $3, $4, $5, $6, $7, $8) ' +
        'on conflict ("organization_id", "kind") do update set "channel" = $9, "config" = $10, ' +
        '"enabled" = $11, "chat_channel_id" = $12, "dm_on_call" = $13, "updated_by" = $14',
    );
    expect(database.statements[1].parameters).toEqual([
      ORG,
      "custom:build-failures",
      "slack",
      "{}",
      true,
      CHANNEL,
      false,
      "u-ken",
      "slack",
      "{}",
      true,
      CHANNEL,
      false,
      "u-ken",
    ]);
  });

  it("reads where each stored Slack route posts — a channel row, or none", async () => {
    const database = recordingDatabase();

    database.answers({
      rows: [
        {
          kind: "custom:build-failures",
          dm_on_call: false,
          id: CHANNEL,
          channel_name: "helios-alerts",
          joined: true,
          archived: false,
        },
        {
          kind: "custom:blocking-questions",
          dm_on_call: true,
          id: null,
          channel_name: null,
          joined: null,
          archived: null,
        },
      ],
    });

    expect(await new NotificationRoutesRepository(database.service).chatTargets(ORG)).toEqual([
      {
        kind: "custom:build-failures",
        dmOnCall: false,
        channel: { id: CHANNEL, name: "helios-alerts", joined: true, archived: false },
      },
      { kind: "custom:blocking-questions", dmOnCall: true, channel: null },
    ]);
    expect(database.statements[0].sql).toBe(
      'select "r"."kind", "r"."dm_on_call", "c"."id", "c"."channel_name", "c"."joined", ' +
        '"c"."archived" from "ouroboros"."notification_routes" as "r" ' +
        'left join "ouroboros"."chat_channels" as "c" on "c"."id" = "r"."chat_channel_id" ' +
        'where "r"."organization_id" = $1 and "r"."channel" = $2',
    );
    expect(database.statements[0].parameters).toEqual([ORG, "slack"]);
  });

  it("takes a channel only in this workspace, with a purpose that is not the DM tag", async () => {
    const database = recordingDatabase();
    const repository = new NotificationRoutesRepository(database.service);

    database.answers({ rows: [{ id: CHANNEL }] });

    await expect(
      repository.transaction(async (trx) => [
        await repository.boundChannel(trx, ORG, CHANNEL),
        await repository.boundChannel(trx, ORG, CHANNEL),
      ]),
    ).resolves.toEqual([true, false]);
    expect(database.sql()[1]).toBe(
      'select "id" from "ouroboros"."chat_channels" ' +
        'where "organization_id" = $1 and "id" = $2 ' +
        'and "purpose_tag" is not null and "purpose_tag" <> $3',
    );
    expect(database.statements[1].parameters).toEqual([ORG, CHANNEL, DM_PURPOSE_TAG]);
  });
});
