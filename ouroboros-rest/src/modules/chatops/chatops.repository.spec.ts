import { createHash } from "node:crypto";

import {
  recordingDatabase,
  type RecordedStatement,
  type RecordingDatabase,
} from "../db/database.fixture";
import {
  ChatopsRepository,
  ERROR_DETAIL_LIMIT,
  RAW_TEXT_LIMIT,
  replyDigest,
  type CommandRecord,
  type RecordedOutcome,
} from "./chatops.repository";

/**
 * The command trail's statements (#537): what is written to `chat_commands` and `chat_messages`
 * is only ever a row V131's CHECKs accept, a command and its reply are one transaction, a
 * pending command settles once, and nothing is deleted.
 */

const ORG = "org-acme";
const CONNECTION = "conn-1";
const CHANNEL_ROW = "chan-loops";
const COMMAND = "0b0c6a9e-6f0b-4c53-9d6f-0d1c6f8a1b11";
const INVOKED = new Date("2026-10-12T16:00:00.000Z");
const COMPLETED = new Date("2026-10-12T16:00:01.250Z");

/**
 * One invocation, as the dispatcher hands it over.
 *
 * @param overrides - What differs from an `ok` `queue` typed in a joined channel.
 * @returns The record.
 */
function command(overrides: Partial<CommandRecord> = {}): CommandRecord {
  return {
    id: COMMAND,
    organizationId: ORG,
    connectionId: CONNECTION,
    channelId: CHANNEL_ROW,
    invokerLinkId: "link-maya",
    platformUserId: "U07MAYA",
    surface: "slack",
    command: "queue",
    args: { ticket: "acme/helios#485", workflow: "standard-fix" },
    rawText: "/ouro queue #485 standard-fix",
    ended: { outcome: "ok" },
    ref: { run: "run-1848" },
    invokedAt: INVOKED,
    completedAt: COMPLETED,
    withReplyMessage: true,
    ...overrides,
  };
}

/**
 * What an `insert` wrote, by column.
 *
 * @param statement - The recorded statement.
 * @returns Each column's value — Kysely parameterises every one, in the columns' order.
 */
function inserted(statement: RecordedStatement): Record<string, unknown> {
  const columns = /\(([^)]+)\) values/.exec(statement.sql)?.[1].split(", ") ?? [];

  expect(columns).toHaveLength(statement.parameters.length);

  return Object.fromEntries(
    columns.map((column, index) => [column.replace(/"/g, ""), statement.parameters[index]]),
  );
}

/**
 * The one statement that touches a table in a given way.
 *
 * @param database - The recording database.
 * @param start - How the statement begins — `insert into "ouroboros"."chat_commands"`.
 * @returns The statement.
 */
function statementOf(database: RecordingDatabase, start: string): RecordedStatement {
  const found = database.statements.filter((statement) => statement.sql.startsWith(start));

  expect(found).toHaveLength(1);

  return found[0];
}

const INSERT_COMMAND = 'insert into "ouroboros"."chat_commands"';
const INSERT_MESSAGE = 'insert into "ouroboros"."chat_messages"';
const UPDATE_COMMAND = 'update "ouroboros"."chat_commands"';

describe("ChatopsRepository", () => {
  let database: RecordingDatabase;
  let commands: ChatopsRepository;

  beforeEach(() => {
    database = recordingDatabase();
    commands = new ChatopsRepository(database.service);
  });

  afterEach(() => {
    // The application role holds no `delete` on either table, and nothing here asks for one.
    expect(database.sql().filter((sql) => /^delete\b/i.test(sql))).toEqual([]);
  });

  describe("the reads a dispatch makes", () => {
    it("finds a platform channel's row only on that connection, and only when it is joined", async () => {
      database.answers({ rows: [{ id: CHANNEL_ROW }] });

      expect(await commands.joinedChannel(CONNECTION, "C071LOOPS")).toBe(CHANNEL_ROW);

      const [statement] = database.statements;
      expect(database.statements).toHaveLength(1);
      expect(statement.sql).toMatch(/^select "id" from "ouroboros"."chat_channels"/);
      expect(statement.sql).toContain('"connection_id" = $1');
      expect(statement.sql).toContain('"channel_id" = $2');
      expect(statement.sql).toContain('"joined" = $3');
      expect(statement.parameters).toEqual([CONNECTION, "C071LOOPS", true]);
    });

    it("answers undefined for a DM, an unknown or an un-joined channel", async () => {
      expect(await commands.joinedChannel(CONNECTION, "D0DM")).toBeUndefined();
    });

    it("reads a person's name by id, and undefined for nobody", async () => {
      database.answers({ rows: [{ name: "Maya Chen" }] });

      expect(await commands.userName("user-maya")).toBe("Maya Chen");
      expect(await commands.userName("user-gone")).toBeUndefined();

      expect(database.statements[0].sql).toMatch(
        /^select "name" from "ouroboros"."user" where "id" = \$1$/,
      );
      expect(database.statements.map((statement) => statement.parameters)).toEqual([
        ["user-maya"],
        ["user-gone"],
      ]);
    });

    it("reads a workspace's name by id, and undefined for none", async () => {
      database.answers({ rows: [{ name: "Acme Robotics" }] });

      expect(await commands.workspaceName(ORG)).toBe("Acme Robotics");
      expect(await commands.workspaceName("org-gone")).toBeUndefined();

      expect(database.statements[0].sql).toMatch(
        /^select "name" from "ouroboros"."organization" where "id" = \$1$/,
      );
      expect(database.statements[0].parameters).toEqual([ORG]);
    });
  });

  describe("record", () => {
    it("writes the reply's message and then the command naming it, in one transaction", async () => {
      const written = await commands.record(command());

      expect(database.sql().map((sql) => sql.split(" (")[0])).toEqual([
        "begin",
        INSERT_MESSAGE,
        INSERT_COMMAND,
        "commit",
      ]);

      const message = inserted(statementOf(database, INSERT_MESSAGE));
      const row = inserted(statementOf(database, INSERT_COMMAND));

      expect(written).toEqual({ id: COMMAND, messageId: message.id });
      expect(message).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
        organization_id: ORG,
        channel_id: CHANNEL_ROW,
        kind: "command_reply",
        payload_digest: replyDigest(COMMAND, "reply"),
        posted_at: COMPLETED,
      });
      expect(row).toEqual({
        id: COMMAND,
        organization_id: ORG,
        connection_id: CONNECTION,
        channel_id: CHANNEL_ROW,
        invoker_link_id: "link-maya",
        platform_user_id: "U07MAYA",
        surface: "slack",
        command: "queue",
        args: JSON.stringify({ ticket: "acme/helios#485", workflow: "standard-fix" }),
        raw_text: "/ouro queue #485 standard-fix",
        outcome: "ok",
        // What the binding made, and the reply's own message.
        result_ref: JSON.stringify({ run: "run-1848", message: message.id }),
        error_detail: null,
        invoked_at: INVOKED,
        completed_at: COMPLETED,
      });
    });

    it("writes a message that is facts and never prose: no text, no facts, no refs, no platform ts", async () => {
      await commands.record(command());

      expect(Object.keys(inserted(statementOf(database, INSERT_MESSAGE))).sort()).toEqual([
        "channel_id",
        "id",
        "kind",
        "organization_id",
        "payload_digest",
        "posted_at",
      ]);
    });

    it.each<[string, Partial<CommandRecord>]>([
      ["the channel is not one the connection has joined", { channelId: null }],
      ["the command was refused", { withReplyMessage: false, ended: { outcome: "denied" } }],
    ])("writes no message when %s", async (_why, overrides) => {
      const written = await commands.record(command({ ref: undefined, ...overrides }));

      expect(written).toEqual({ id: COMMAND, messageId: null });
      expect(database.sql().map((sql) => sql.split(" (")[0])).toEqual([
        "begin",
        INSERT_COMMAND,
        "commit",
      ]);
      // Nothing was produced, so the column is null rather than an empty object.
      expect(inserted(statementOf(database, INSERT_COMMAND)).result_ref).toBeNull();
    });

    it("keeps what the binding made when there is no message to name", async () => {
      await commands.record(command({ channelId: null }));

      expect(inserted(statementOf(database, INSERT_COMMAND))).toMatchObject({
        channel_id: null,
        result_ref: JSON.stringify({ run: "run-1848" }),
      });
    });

    it.each<[RecordedOutcome, string | null, Date | null]>([
      [{ outcome: "ok" }, null, COMPLETED],
      [{ outcome: "async_pending" }, null, null],
      [{ outcome: "denied" }, null, COMPLETED],
      [{ outcome: "unlinked" }, null, COMPLETED],
      [{ outcome: "error", detail: "unknown_command" }, "unknown_command", COMPLETED],
    ])(
      "writes only the combination V131 accepts for %j: error_detail %p, completed_at %p",
      async (ended, detail, completedAt) => {
        await commands.record(command({ ended }));

        const row = inserted(statementOf(database, INSERT_COMMAND));

        expect(row.outcome).toBe(ended.outcome);
        // `error` always carries a detail and nothing else ever does.
        expect(row.error_detail).toBe(detail);
        // `completed_at` is null exactly while pending.
        expect(row.completed_at).toEqual(completedAt);
        expect(row.completed_at === null).toBe(ended.outcome === "async_pending");
        expect(row.error_detail !== null).toBe(ended.outcome === "error");
        // A Slack row always carries the platform's user.
        expect(row.platform_user_id).toBe("U07MAYA");
      },
    );

    it("posts a pending command's acknowledgement at the time it was given", async () => {
      await commands.record(command({ ended: { outcome: "async_pending" } }));

      expect(inserted(statementOf(database, INSERT_MESSAGE)).posted_at).toEqual(COMPLETED);
      expect(inserted(statementOf(database, INSERT_COMMAND)).completed_at).toBeNull();
    });

    it("records an unlinked attempt with no invoker and the platform's user id", async () => {
      await commands.record(
        command({
          invokerLinkId: null,
          args: {},
          ref: undefined,
          ended: { outcome: "unlinked" },
          withReplyMessage: false,
        }),
      );

      expect(inserted(statementOf(database, INSERT_COMMAND))).toMatchObject({
        invoker_link_id: null,
        platform_user_id: "U07MAYA",
        args: "{}",
        outcome: "unlinked",
        result_ref: null,
      });
    });

    it("bounds the text and the reason to their columns", async () => {
      await commands.record(
        command({
          rawText: `/ouro ${"x".repeat(RAW_TEXT_LIMIT)}`,
          ended: { outcome: "error", detail: `  ${"e".repeat(ERROR_DETAIL_LIMIT + 50)}  ` },
        }),
      );

      const row = inserted(statementOf(database, INSERT_COMMAND));

      expect(row.raw_text).toHaveLength(RAW_TEXT_LIMIT);
      expect(row.raw_text).toMatch(/^\/ouro x+$/);
      expect(row.error_detail).toBe("e".repeat(ERROR_DETAIL_LIMIT));
    });

    it("trims the reason it stores", async () => {
      await commands.record(command({ ended: { outcome: "error", detail: " bad_arguments\n" } }));

      expect(inserted(statementOf(database, INSERT_COMMAND)).error_detail).toBe("bad_arguments");
    });
  });

  describe("settle", () => {
    const PENDING = {
      organization_id: ORG,
      channel_id: CHANNEL_ROW,
      result_ref: { dryRun: "dr-1", message: "message-ack" },
    };

    it("moves a pending command to ok and records its result as a second message", async () => {
      database.answers({ rows: [PENDING] });

      expect(await commands.settle(COMMAND, { outcome: "ok" }, COMPLETED)).toBe(true);

      const [begin, select, insert, update, commit] = database.statements;

      expect(database.statements).toHaveLength(5);
      expect([begin.sql, commit.sql]).toEqual(["begin", "commit"]);

      // Read under a lock, and only while still pending.
      expect(select.sql).toMatch(/^select .* from "ouroboros"."chat_commands"/);
      expect(select.sql).toContain('"id" = $1');
      expect(select.sql).toContain('"outcome" = $2');
      expect(select.sql).toMatch(/for update$/);
      expect(select.parameters).toEqual([COMMAND, "async_pending"]);

      const message = inserted(insert);

      expect(insert.sql.startsWith(INSERT_MESSAGE)).toBe(true);
      expect(message).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
        organization_id: ORG,
        channel_id: CHANNEL_ROW,
        kind: "command_reply",
        // Its own digest: the result must not collide with the acknowledgement.
        payload_digest: replyDigest(COMMAND, "result"),
        posted_at: COMPLETED,
      });

      expect(update.sql).toBe(
        `${UPDATE_COMMAND} set "outcome" = $1, "error_detail" = $2, "completed_at" = $3, "result_ref" = $4 where "id" = $5 and "outcome" = $6`,
      );
      expect(update.parameters).toEqual([
        "ok",
        null,
        COMPLETED,
        JSON.stringify({ dryRun: "dr-1", message: "message-ack", result_message: message.id }),
        COMMAND,
        "async_pending",
      ]);
    });

    it("moves a pending command to error with its reason, trimmed and bounded", async () => {
      database.answers({ rows: [PENDING] });

      await commands.settle(
        COMMAND,
        { outcome: "error", detail: ` ${"e".repeat(ERROR_DETAIL_LIMIT + 1)} ` },
        COMPLETED,
      );

      expect(statementOf(database, UPDATE_COMMAND).parameters.slice(0, 3)).toEqual([
        "error",
        "e".repeat(ERROR_DETAIL_LIMIT),
        COMPLETED,
      ]);
    });

    it("moves nothing, and writes nothing, for a command that is not pending — a second settle included", async () => {
      expect(await commands.settle(COMMAND, { outcome: "ok" }, COMPLETED)).toBe(false);

      expect(database.sql().map((sql) => sql.split(" ")[0])).toEqual(["begin", "select", "commit"]);
    });

    it("writes no message for a command typed outside a joined channel, and keeps its ref as it was", async () => {
      database.answers({ rows: [{ ...PENDING, channel_id: null }] });

      expect(await commands.settle(COMMAND, { outcome: "ok" }, COMPLETED)).toBe(true);

      expect(database.sql().some((sql) => sql.startsWith(INSERT_MESSAGE))).toBe(false);
      expect(statementOf(database, UPDATE_COMMAND).parameters[3]).toBe(
        JSON.stringify(PENDING.result_ref),
      );
    });

    it("leaves a null ref null when there is nothing to add to it", async () => {
      database.answers({ rows: [{ ...PENDING, channel_id: null, result_ref: null }] });

      await commands.settle(COMMAND, { outcome: "ok" }, COMPLETED);

      expect(statementOf(database, UPDATE_COMMAND).parameters[3]).toBeNull();
    });

    it("names the result's message even when the acknowledgement produced no ref", async () => {
      database.answers({ rows: [{ ...PENDING, result_ref: null }] });

      await commands.settle(COMMAND, { outcome: "ok" }, COMPLETED);

      const message = inserted(statementOf(database, INSERT_MESSAGE));

      expect(statementOf(database, UPDATE_COMMAND).parameters[3]).toBe(
        JSON.stringify({ result_message: message.id }),
      );
    });
  });

  describe("attachAudit", () => {
    it("names the audit event on the command's row, and on no other", async () => {
      await commands.attachAudit(COMMAND, "audit-event-1");

      expect(database.statements).toEqual([
        {
          sql: `${UPDATE_COMMAND} set "audit_event_id" = $1 where "id" = $2`,
          parameters: ["audit-event-1", COMMAND],
        },
      ]);
    });
  });
});

describe("replyDigest", () => {
  it("is the seed's sha256('command_reply:' || command id)", () => {
    expect(replyDigest(COMMAND, "reply")).toBe(
      createHash("sha256").update(`command_reply:${COMMAND}`, "utf8").digest("hex"),
    );
    expect(replyDigest(COMMAND, "reply")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for an async command's later result, and from command to command", () => {
    const digests = [
      replyDigest(COMMAND, "reply"),
      replyDigest(COMMAND, "result"),
      replyDigest("another-command", "reply"),
    ];

    expect(new Set(digests).size).toBe(3);
  });
});
