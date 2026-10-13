import { DM_PURPOSE_TAG } from "../chat/chat.outbox";
import { recordingDatabase } from "../db/database.fixture";
import { SlackRepository } from "./slack.repository";

/**
 * The one read #542 added: the channel a console command typed under a mirror may name — this
 * workspace's, bound for something, and not a DM conversation.
 */

const ORG = "org-acme";
const CHANNEL = "5eed009c-0000-4000-8000-0000000000a1";

describe("SlackRepository.boundChannel", () => {
  it("finds a channel only in this workspace, with a purpose that is not the DM tag", async () => {
    const database = recordingDatabase();

    database.answers({ rows: [{ id: CHANNEL }] });

    expect(await new SlackRepository(database.service).boundChannel(ORG, CHANNEL)).toBe(CHANNEL);
    expect(database.statements).toHaveLength(1);
    expect(database.statements[0].sql).toBe(
      'select "id" from "ouroboros"."chat_channels" ' +
        'where "organization_id" = $1 and "id" = $2 ' +
        'and "purpose_tag" is not null and "purpose_tag" <> $3',
    );
    expect(database.statements[0].parameters).toEqual([ORG, CHANNEL, DM_PURPOSE_TAG]);
  });

  it("answers undefined for a channel that is another workspace's, unbound or a DM", async () => {
    const database = recordingDatabase();

    expect(await new SlackRepository(database.service).boundChannel(ORG, CHANNEL)).toBeUndefined();
  });
});
