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
  settledReply,
  type CommandRecord,
  type RecordedOutcome,
} from "./chatops.repository";

/**
 * The command trail's statements (#537, #539): what is written to `chat_commands` and
 * `chat_messages` is only ever a row V131's and V136's CHECKs accept, a command and its reply
 * are one transaction, a pending command settles once — keeping what it said — a console command
 * is read back only by whoever typed it, and nothing is deleted.
 */

const ORG = "org-acme";
const CONNECTION = "conn-1";
const CHANNEL_ROW = "chan-loops";
const COMMAND = "0b0c6a9e-6f0b-4c53-9d6f-0d1c6f8a1b11";
const INVOKED = new Date("2026-10-12T16:00:00.000Z");
const COMPLETED = new Date("2026-10-12T16:00:01.250Z");
const MAYA = "user-maya";

/** A Slack invocation's record. */
type SlackRecord = Extract<CommandRecord, { surface: "slack" }>;

/** A console invocation's record. */
type ConsoleRecord = Extract<CommandRecord, { surface: "console" }>;

/** What a dry run said when it finished. */
const RESULT = {
  text: "Dry run of #486 finished: no writes.",
  link: { label: "Open the dry run", url: "https://app.example.test/dry-runs/dr-1" },
};

/**
 * One invocation, as the dispatcher hands it over.
 *
 * @param overrides - What differs from an `ok` `queue` typed in a joined channel.
 * @returns The record.
 */
function command(overrides: Partial<SlackRecord> = {}): SlackRecord {
  return {
    id: COMMAND,
    organizationId: ORG,
    connectionId: CONNECTION,
    channelId: CHANNEL_ROW,
    invokerLinkId: "link-maya",
    platformUserId: "U07MAYA",
    invokerUserId: MAYA,
    surface: "slack",
    command: "queue",
    args: { ticket: "acme/helios#485", workflow: "standard-fix" },
    rawText: "/ouro queue #485 standard-fix",
    ended: { outcome: "ok" },
    reply: { text: "Queued #485 on standard-fix." },
    ref: { run: "run-1848" },
    invokedAt: INVOKED,
    completedAt: COMPLETED,
    withReplyMessage: true,
    ...overrides,
  };
}

/**
 * The same invocation typed in the app's console: no connection, channel, link or platform user.
 *
 * @param overrides - What differs from an `ok` `queue`.
 * @returns The record.
 */
function consoleCommand(overrides: Partial<ConsoleRecord> = {}): ConsoleRecord {
  return {
    ...command(),
    surface: "console",
    connectionId: null,
    channelId: null,
    invokerLinkId: null,
    platformUserId: null,
    withReplyMessage: false,
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
        invoker_user_id: MAYA,
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
        // What it said at once, kept on the row (V137).
        reply: JSON.stringify({ text: "Queued #485 on standard-fix." }),
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

    it.each<[string, Partial<SlackRecord>]>([
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
          invokerUserId: null,
          args: {},
          ref: undefined,
          ended: { outcome: "unlinked" },
          withReplyMessage: false,
        }),
      );

      expect(inserted(statementOf(database, INSERT_COMMAND))).toMatchObject({
        invoker_link_id: null,
        invoker_user_id: null,
        platform_user_id: "U07MAYA",
        args: "{}",
        outcome: "unlinked",
        result_ref: null,
      });
    });

    it("records a console command as V136's surface rule asks: its person, and no connection, channel, link or platform user", async () => {
      const written = await commands.record(consoleCommand());

      // No channel, so no message — one insert in the transaction.
      expect(written).toEqual({ id: COMMAND, messageId: null });
      expect(database.sql().map((sql) => sql.split(" (")[0])).toEqual([
        "begin",
        INSERT_COMMAND,
        "commit",
      ]);
      expect(inserted(statementOf(database, INSERT_COMMAND))).toEqual({
        id: COMMAND,
        organization_id: ORG,
        connection_id: null,
        channel_id: null,
        invoker_link_id: null,
        platform_user_id: null,
        invoker_user_id: MAYA,
        surface: "console",
        command: "queue",
        args: JSON.stringify({ ticket: "acme/helios#485", workflow: "standard-fix" }),
        raw_text: "/ouro queue #485 standard-fix",
        outcome: "ok",
        // What the binding made — and no message beside it.
        result_ref: JSON.stringify({ run: "run-1848" }),
        error_detail: null,
        invoked_at: INVOKED,
        completed_at: COMPLETED,
        reply: JSON.stringify({ text: "Queued #485 on standard-fix." }),
      });
    });

    it("records the channel a console command was typed under, and still no message (V137, #542)", async () => {
      const written = await commands.record(
        consoleCommand({ channelId: CHANNEL_ROW, withReplyMessage: true }),
      );

      // The mirror reads the reply off the command: nothing was posted to Slack.
      expect(written).toEqual({ id: COMMAND, messageId: null });
      expect(database.sql().some((sql) => sql.startsWith(INSERT_MESSAGE))).toBe(false);
      expect(inserted(statementOf(database, INSERT_COMMAND))).toMatchObject({
        surface: "console",
        connection_id: null,
        channel_id: CHANNEL_ROW,
        invoker_link_id: null,
        platform_user_id: null,
      });
    });

    it.each([
      [
        "a refusal",
        { outcome: "denied" },
        { text: "`/ouro route` is for workspace owners and admins." },
      ],
      ["an unlinked attempt", { outcome: "unlinked" }, { text: "You're not linked." }],
      [
        "a failure",
        { outcome: "error", detail: "bad_arguments" },
        { text: "Usage: queue <ticket>" },
      ],
      [
        "an acknowledgement",
        { outcome: "async_pending" },
        { text: "Rehearsing — the result follows." },
      ],
    ] as const)("keeps what %s said at once", async (_which, ended, reply) => {
      await commands.record(command({ ended, reply, ref: undefined, withReplyMessage: false }));

      expect(inserted(statementOf(database, INSERT_COMMAND)).reply).toBe(JSON.stringify(reply));
    });

    it("keeps a reply's link as the CHECK knows it, and nothing for a reply with no words", async () => {
      const link = { label: "Open in the backlog", url: "https://app.example.test/backlog" };

      await commands.record(
        command({ reply: { text: "Queued.", link, extra: "dropped" } as never }),
      );
      await commands.record(
        command({ id: "0b0c6a9e-6f0b-4c53-9d6f-0d1c6f8a1b12", reply: { text: "" } }),
      );
      await commands.record(command({ id: "0b0c6a9e-6f0b-4c53-9d6f-0d1c6f8a1b13", reply: null }));

      const replies = database.statements
        .filter((statement) => statement.sql.startsWith(INSERT_COMMAND))
        .map((statement) => inserted(statement).reply);

      // `chat_commands_reply_shape` refuses empty text and any key but text and link.
      expect(replies).toEqual([JSON.stringify({ text: "Queued.", link }), null, null]);
    });

    it("writes no reply message for a console command even when one is asked for", async () => {
      await commands.record(consoleCommand({ withReplyMessage: true }));

      expect(database.sql().some((sql) => sql.startsWith(INSERT_MESSAGE))).toBe(false);
    });

    it("writes the same columns for both surfaces, differing only in where the command came from", async () => {
      await commands.record(command({ channelId: null }));
      await commands.record(consoleCommand());

      const [slack, typedInConsole] = database.statements
        .filter((statement) => statement.sql.startsWith(INSERT_COMMAND))
        .map(inserted);
      const differing = Object.keys(slack).filter(
        (column) => JSON.stringify(slack[column]) !== JSON.stringify(typedInConsole[column]),
      );

      expect(Object.keys(typedInConsole)).toEqual(Object.keys(slack));
      expect(differing.sort()).toEqual([
        "connection_id",
        "invoker_link_id",
        "platform_user_id",
        "surface",
      ]);
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
      surface: "slack",
      result_ref: { dryRun: "dr-1", message: "message-ack" },
    };

    it("moves a pending command to ok and records its result as a second message", async () => {
      database.answers({ rows: [PENDING] });

      expect(await commands.settle(COMMAND, { outcome: "ok" }, COMPLETED, RESULT)).toBe(true);

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
        `${UPDATE_COMMAND} set "outcome" = $1, "error_detail" = $2, "completed_at" = $3, "result_ref" = $4, "settled_reply" = $5 where "id" = $6 and "outcome" = $7`,
      );
      expect(update.parameters).toEqual([
        "ok",
        null,
        COMPLETED,
        JSON.stringify({ dryRun: "dr-1", message: "message-ack", result_message: message.id }),
        // What it finally said, kept on the row.
        JSON.stringify(RESULT),
        COMMAND,
        "async_pending",
      ]);
    });

    it("writes no result message for a console command typed under a channel (#542)", async () => {
      database.answers({ rows: [{ ...PENDING, surface: "console", result_ref: null }] });

      expect(await commands.settle(COMMAND, { outcome: "ok" }, COMPLETED, RESULT)).toBe(true);

      expect(database.sql().some((sql) => sql.startsWith(INSERT_MESSAGE))).toBe(false);
      // Its result is on the row, which is where the mirror and the console read it.
      expect(statementOf(database, UPDATE_COMMAND).parameters.slice(3, 5)).toEqual([
        null,
        JSON.stringify(RESULT),
      ]);
    });

    it("moves a pending command to error with its reason, trimmed and bounded", async () => {
      database.answers({ rows: [PENDING] });

      await commands.settle(
        COMMAND,
        { outcome: "error", detail: ` ${"e".repeat(ERROR_DETAIL_LIMIT + 1)} ` },
        COMPLETED,
        { text: "The dry run could not start." },
      );

      expect(statementOf(database, UPDATE_COMMAND).parameters.slice(0, 3)).toEqual([
        "error",
        "e".repeat(ERROR_DETAIL_LIMIT),
        COMPLETED,
      ]);
      // A failure's words are kept too: the console has nowhere else to read them.
      expect(statementOf(database, UPDATE_COMMAND).parameters[4]).toBe(
        JSON.stringify({ text: "The dry run could not start." }),
      );
    });

    it("keeps what a console command said, with no message row — there is no channel", async () => {
      database.answers({ rows: [{ ...PENDING, channel_id: null }] });

      expect(await commands.settle(COMMAND, { outcome: "ok" }, COMPLETED, RESULT)).toBe(true);

      expect(database.sql().some((sql) => sql.startsWith(INSERT_MESSAGE))).toBe(false);
      expect(statementOf(database, UPDATE_COMMAND).parameters.slice(2, 5)).toEqual([
        COMPLETED,
        JSON.stringify(PENDING.result_ref),
        JSON.stringify(RESULT),
      ]);
    });

    it("stores only the shape the settled_reply CHECK knows: text, and a link's label and url", async () => {
      database.answers({ rows: [{ ...PENDING, channel_id: null }] });

      await commands.settle(COMMAND, { outcome: "ok" }, COMPLETED, {
        text: "Done.",
        link: { label: "Open", url: "https://app.example.test/x", stray: "no" },
        blocks: [],
      } as never);

      expect(statementOf(database, UPDATE_COMMAND).parameters[4]).toBe(
        JSON.stringify({
          text: "Done.",
          link: { label: "Open", url: "https://app.example.test/x" },
        }),
      );
    });

    it("stores no settled reply when there is nothing to keep", async () => {
      database.answers({ rows: [{ ...PENDING, channel_id: null }] });

      await commands.settle(COMMAND, { outcome: "ok" }, COMPLETED, null);

      expect(statementOf(database, UPDATE_COMMAND).parameters[4]).toBeNull();
    });

    it("moves nothing, and writes nothing, for a command that is not pending — a second settle included", async () => {
      expect(await commands.settle(COMMAND, { outcome: "ok" }, COMPLETED, RESULT)).toBe(false);

      expect(database.sql().map((sql) => sql.split(" ")[0])).toEqual(["begin", "select", "commit"]);
    });

    it("writes no message for a command typed outside a joined channel, and keeps its ref as it was", async () => {
      database.answers({ rows: [{ ...PENDING, channel_id: null }] });

      expect(await commands.settle(COMMAND, { outcome: "ok" }, COMPLETED, RESULT)).toBe(true);

      expect(database.sql().some((sql) => sql.startsWith(INSERT_MESSAGE))).toBe(false);
      expect(statementOf(database, UPDATE_COMMAND).parameters[3]).toBe(
        JSON.stringify(PENDING.result_ref),
      );
    });

    it("leaves a null ref null when there is nothing to add to it", async () => {
      database.answers({ rows: [{ ...PENDING, channel_id: null, result_ref: null }] });

      await commands.settle(COMMAND, { outcome: "ok" }, COMPLETED, RESULT);

      expect(statementOf(database, UPDATE_COMMAND).parameters[3]).toBeNull();
    });

    it("names the result's message even when the acknowledgement produced no ref", async () => {
      database.answers({ rows: [{ ...PENDING, result_ref: null }] });

      await commands.settle(COMMAND, { outcome: "ok" }, COMPLETED, RESULT);

      const message = inserted(statementOf(database, INSERT_MESSAGE));

      expect(statementOf(database, UPDATE_COMMAND).parameters[3]).toBe(
        JSON.stringify({ result_message: message.id }),
      );
    });
  });

  describe("ownConsoleCommand", () => {
    const ROW = {
      id: COMMAND,
      command: "dry-run",
      outcome: "ok",
      raw_text: "/ouro dry-run #486",
      invoked_at: INVOKED,
      completed_at: COMPLETED,
      settled_reply: RESULT,
      error_detail: null,
    };

    it("reads one command by id — in this workspace, typed in the console, by this person", async () => {
      database.answers({ rows: [ROW] });

      expect(await commands.ownConsoleCommand(ORG, MAYA, COMMAND)).toEqual(ROW);

      const [statement] = database.statements;

      expect(database.statements).toHaveLength(1);
      expect(statement.sql).toBe(
        'select "id", "command", "outcome", "raw_text", "invoked_at", "completed_at", "reply", "settled_reply", "error_detail" ' +
          'from "ouroboros"."chat_commands" ' +
          'where "id" = $1 and "organization_id" = $2 and "surface" = $3 and "invoker_user_id" = $4',
      );
      expect(statement.parameters).toEqual([COMMAND, ORG, "console", MAYA]);
    });

    it("answers undefined when no such row is the caller's", async () => {
      expect(await commands.ownConsoleCommand(ORG, "user-somebody-else", COMMAND)).toBeUndefined();
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

describe("settledReply", () => {
  it("leaves the link out when there is none, rather than storing a null one", () => {
    expect(settledReply({ text: "Done." })).toEqual({ text: "Done." });
    expect(Object.keys(settledReply({ text: "Done." }))).toEqual(["text"]);
  });

  it("keeps a link's label and url", () => {
    expect(settledReply(RESULT)).toEqual(RESULT);
  });
});
