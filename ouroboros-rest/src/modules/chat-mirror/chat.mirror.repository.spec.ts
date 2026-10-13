import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { ChatMirrorRepository } from "./chat.mirror.repository";

/**
 * The mirror's statements (#542): every read names the workspace, the two stream reads share
 * one order and one cursor rule, a command's reply rows are never read as messages, and nothing
 * is written.
 */

const ORG = "org-acme";
const CHANNEL = "5eed009c-0000-4000-8000-0000000000a1";
const BEFORE = { at: "2026-10-11T14:07:00.123456Z", id: "5eed009c-0000-4000-8000-000000000103" };
const RUN = "5eed0009-0000-4000-8000-000000000474";
const PR = "5eed003a-0000-4000-8000-000000000514";

describe("ChatMirrorRepository", () => {
  let database: RecordingDatabase;
  let mirror: ChatMirrorRepository;

  beforeEach(() => {
    database = recordingDatabase();
    mirror = new ChatMirrorRepository(database.service);
  });

  afterEach(() => {
    expect(database.sql().filter((sql) => !/^select\b/i.test(sql))).toEqual([]);
  });

  it("reads a channel's messages newest first, in this workspace, without command replies", async () => {
    await mirror.messages(ORG, CHANNEL, undefined, 51);

    const [statement] = database.statements;

    expect(database.statements).toHaveLength(1);
    expect(statement.sql).toContain('from "ouroboros"."chat_messages"');
    expect(statement.sql).toContain(
      'where "ouroboros"."chat_messages"."organization_id" = $1 ' +
        'and "ouroboros"."chat_messages"."channel_id" = $2 ' +
        'and "ouroboros"."chat_messages"."kind" <> $3 ' +
        'order by "ouroboros"."chat_messages"."posted_at" desc, "ouroboros"."chat_messages"."id" desc ' +
        "limit $4",
    );
    expect(statement.parameters).toEqual([ORG, CHANNEL, "command_reply", 51]);
    // The cursor's instant is PostgreSQL's own microsecond text, never a rounded Date.
    expect(statement.sql).toContain(
      `to_char(chat_messages.posted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursor_at"`,
    );
  });

  it("reads only messages strictly older than a cursor, by instant and then id", async () => {
    await mirror.messages(ORG, CHANNEL, BEFORE, 51);

    const [statement] = database.statements;

    expect(statement.sql).toContain(
      "and (chat_messages.posted_at, chat_messages.id) < ($4::timestamptz, $5::uuid) order by",
    );
    expect(statement.parameters).toEqual([ORG, CHANNEL, "command_reply", BEFORE.at, BEFORE.id, 51]);
  });

  it("reads a channel's commands the same way, with the name of who typed each", async () => {
    await mirror.commands(ORG, CHANNEL, BEFORE, 11);

    const [statement] = database.statements;

    expect(database.statements).toHaveLength(1);
    expect(statement.sql).toContain(
      'from "ouroboros"."chat_commands" ' +
        'left join "ouroboros"."user" on "ouroboros"."user"."id" = "ouroboros"."chat_commands"."invoker_user_id" ' +
        'where "ouroboros"."chat_commands"."organization_id" = $1 ' +
        'and "ouroboros"."chat_commands"."channel_id" = $2 ' +
        "and (chat_commands.invoked_at, chat_commands.id) < ($3::timestamptz, $4::uuid) " +
        'order by "ouroboros"."chat_commands"."invoked_at" desc, "ouroboros"."chat_commands"."id" desc ' +
        "limit $5",
    );
    expect(statement.sql).toContain('"ouroboros"."user"."name" as "author_name"');
    expect(statement.sql).toContain('"ouroboros"."chat_commands"."reply"');
    expect(statement.sql).toContain('"ouroboros"."chat_commands"."settled_reply"');
    expect(statement.parameters).toEqual([ORG, CHANNEL, BEFORE.at, BEFORE.id, 11]);
  });

  it("reads runs' loop numbers in this workspace", async () => {
    database.answers({ rows: [{ id: RUN, loop_seq: 1839 }] });

    expect(await mirror.runs(ORG, [RUN])).toEqual([{ id: RUN, loopSeq: 1839 }]);
    expect(database.statements[0].sql).toBe(
      'select "id", "loop_seq" from "ouroboros"."runs" where "organization_id" = $1 and "id" in ($2)',
    );
    expect(database.statements[0].parameters).toEqual([ORG, RUN]);
  });

  it("reads pull requests by id or by run, in this workspace", async () => {
    database.answers({ rows: [{ id: PR, run_id: RUN, external_number: 514 }] });

    expect(await mirror.pullRequests(ORG, [PR], [RUN])).toEqual([
      { id: PR, runId: RUN, number: 514 },
    ]);
    expect(database.statements[0].sql).toBe(
      'select "id", "run_id", "external_number" from "ouroboros"."pull_requests" ' +
        'where "organization_id" = $1 and ("id" in ($2) or "run_id" in ($3))',
    );

    await mirror.pullRequests(ORG, [], [RUN]);

    expect(database.statements[1].sql).toMatch(
      /where "organization_id" = \$1 and "run_id" in \(\$2\)$/,
    );
  });

  it("reads people's names", async () => {
    database.answers({ rows: [{ id: "user-maya", name: "Maya Chen" }] });

    expect(await mirror.people(["user-maya"])).toEqual(new Map([["user-maya", "Maya Chen"]]));
    expect(database.statements[0].sql).toBe(
      'select "id", "name" from "ouroboros"."user" where "id" in ($1)',
    );
  });

  it("asks nothing when there is nothing to look up", async () => {
    expect(await mirror.runs(ORG, [])).toEqual([]);
    expect(await mirror.pullRequests(ORG, [], [])).toEqual([]);
    expect(await mirror.people([])).toEqual(new Map());
    expect(database.statements).toEqual([]);
  });
});
