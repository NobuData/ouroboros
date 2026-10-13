/**
 * Acknowledgement timing, against the listening application (BZ.6,
 * [#540](https://github.com/NobuData/ouroboros/issues/540)).
 *
 * Slack fails a slash command that is not acknowledged within three seconds, and shows the
 * person *"operation_timeout"* — so the product looks broken exactly when it is busiest. The
 * service's answer is structural: acknowledge, then work. This suite makes the work **unable to
 * finish** and holds the acknowledgement to the window anyway.
 *
 * **How the work is made slow.** Every command's first step is the same read — which workspace
 * is this Slack team? — so the suite takes `ACCESS EXCLUSIVE` on `chat_connections` from a
 * connection of its own and holds it. Nothing behind any command can move until the lock is
 * released: not the dispatcher, not `link`, not `help`. That is slower than any real plane will
 * ever be, and it is deterministic — the result *cannot* have arrived while the lock is held,
 * so *"acknowledged before the work"* is observed rather than raced.
 *
 * **The async half.** `dry-run` is the grammar's one `async` command: its binding answers
 * *started* and the result follows minutes later. The engine is held open behind a gate
 * (`startEngineGate`), so the suite stands in the middle — acknowledged, told *started*, row
 * `async_pending` — and then lets the engine finish and watches the result arrive at the same
 * `response_url`, on the same row.
 */

import type { PoolClient } from "pg";

import { COMMAND_ACK } from "../slack/slack.inbound.service";
import {
  type CommandWorld,
  pinCommits,
  scriptCleanDryRun,
  SEEDED_CHANNEL,
  SEEDED_TEAM,
  SLACK_USERS,
  startCommandWorld,
} from "./chatops.matrix.integration.fixture";
import { BUILTINS, COMMAND_PREFIX, GRAMMAR } from "./grammar.registry";

/** How long Slack waits for an acknowledgement. */
const SLACK_ACK_WINDOW_MS = 3000;

/** What *inside the window* is held to: half of it, so a loaded runner is not a red build. */
const ACK_BUDGET_MS = SLACK_ACK_WINDOW_MS / 2;

/** How long the work is held stuck while the suite looks for a result that must not be there. */
const HELD_MS = 400;

/**
 * Every line a person can type: each grammar command's own example, and the three built-ins.
 * Read from the registry, so a command added there is acknowledged here without being asked.
 */
const EVERY_COMMAND: readonly string[] = [
  ...GRAMMAR.commands.map((command) => command.usage),
  ...BUILTINS.filter((builtin) => builtin.surfaces.includes("slack")).map((builtin) =>
    builtin.usage.replace(/\s*\[.*$/, ""),
  ),
];

/** A `chat_commands` row, as this suite reads it. */
interface AckRow extends Record<string, unknown> {
  readonly id: string;
  readonly outcome: string;
  readonly error_detail: string | null;
  readonly reply: { text: string } | null;
  readonly settled_reply: { text: string } | null;
  readonly result_ref: { dryRunId?: string } | null;
  readonly completed_at: Date | null;
}

describe("acknowledging a slash command before the work behind it", () => {
  let world: CommandWorld;

  beforeAll(async () => {
    world = await startCommandWorld();
  }, 60_000);

  afterAll(() => world.close());

  afterEach(async () => {
    world.gate.release();
    await world.bench.idle();
    world.bench.slack.replies.length = 0;
    world.engine.reset();
  });

  /**
   * Hold every command's work stuck until the returned function is called.
   *
   * @returns Lets the work go.
   */
  async function stall(): Promise<() => Promise<void>> {
    const client: PoolClient = await world.bench.api.sql.connect();

    await client.query("begin");
    await client.query("lock table ouroboros.chat_connections in access exclusive mode");

    return async () => {
      await client.query("commit");
      client.release();
    };
  }

  /**
   * The row a slash command left.
   *
   * @param text - What followed `/ouro`.
   * @param user - Who typed it. The owner by default.
   * @returns The newest row for those words from them in Slack, or undefined.
   */
  async function rowFor(
    text: string,
    user: string = SLACK_USERS.owner,
  ): Promise<AckRow | undefined> {
    const { rows } = await world.bench.api.sql.query<AckRow>(
      `select * from ouroboros.chat_commands
        where surface = 'slack' and platform_user_id = $1 and raw_text = $2
        order by invoked_at desc limit 1`,
      [user, `${COMMAND_PREFIX} ${text}`],
    );

    return rows[0];
  }

  it("covers the whole grammar and the built-ins", () => {
    expect(EVERY_COMMAND).toHaveLength(GRAMMAR.commands.length + 3);
    expect(EVERY_COMMAND).toEqual(expect.arrayContaining(["status", "pause all", "help", "link"]));
  });

  it("acknowledges every command inside the window while none of the work can finish", async () => {
    // Typed by the member: the list ends in `unlink`, which really unlinks whoever types it, and
    // the owner is needed afterwards. What each command answers is the matrix's subject, not
    // this suite's — here a refusal is as good a piece of work to wait for as a result.
    const release = await stall();
    const emitted = [];

    try {
      for (const text of EVERY_COMMAND) {
        emitted.push({
          text,
          ...(await world.bench.slack.emitCommand({
            team: SEEDED_TEAM.id,
            user: SLACK_USERS.member,
            channel: SEEDED_CHANNEL,
            text,
          })),
        });
      }

      for (const command of emitted) {
        expect([command.text, command.response.status]).toEqual([command.text, 200]);
        // The honest acknowledgement: *working on it*, never a result that has not happened.
        expect(command.response.body).toEqual(COMMAND_ACK);
        expect(command.ackMs).toBeLessThan(ACK_BUDGET_MS);
      }

      // The work is stuck — and stays stuck: nothing has been said, and nothing recorded.
      await new Promise((resolve) => setTimeout(resolve, HELD_MS));
      expect(world.bench.slack.replies).toEqual([]);
    } finally {
      await release();
    }

    // Let go, every command answers — each to its own `response_url`, exactly once.
    for (const command of emitted) {
      const reply = await world.bench.slack.reply(command.responseUrl);

      expect([command.text, typeof reply.body.text]).toEqual([command.text, "string"]);
      expect(reply.body.response_type).toBe("ephemeral");
    }

    await world.bench.idle();

    for (const command of emitted) {
      expect([command.text, world.bench.slack.repliesTo(command.responseUrl).length]).toEqual([
        command.text,
        1,
      ]);
    }

    // And each grammar command's reply is the one its own row holds: the result that arrived
    // late is the result of the command that was typed, not of its neighbour.
    for (const command of emitted.slice(0, GRAMMAR.commands.length)) {
      const row = await rowFor(command.text, SLACK_USERS.member);
      const [reply] = world.bench.slack.repliesTo(command.responseUrl);

      expect([command.text, row?.reply?.text]).toEqual([command.text, reply?.body.text]);
    }
  });

  it("carries an async command from acknowledgement to result: started, pending, then settled on the same row and url", async () => {
    pinCommits(world);
    scriptCleanDryRun(world);
    world.gate.hold();

    const text = "dry-run #486 security-patch";
    const emitted = await world.bench.slack.emitCommand({
      team: SEEDED_TEAM.id,
      user: SLACK_USERS.owner,
      channel: SEEDED_CHANNEL,
      text,
    });

    expect(emitted.response.body).toEqual(COMMAND_ACK);
    expect(emitted.ackMs).toBeLessThan(ACK_BUDGET_MS);

    // The first word after the acknowledgement is honest too: started, not finished.
    const started = await world.bench.slack.reply(emitted.responseUrl);

    expect(started.body.text).toMatch(/^Dry run started — no writes, no PRs\./);

    // The engine has the run and is being held: the command is pending, and says so on its row.
    await world.bench.slack.waitFor(() => world.gate.held() === 1, "the engine to be asked");

    const pending = await rowFor(text);

    expect(pending).toMatchObject({
      outcome: "async_pending",
      error_detail: null,
      settled_reply: null,
      reply: { text: started.body.text },
    });
    expect(pending?.result_ref?.dryRunId).toEqual(expect.any(String));
    expect(world.bench.slack.repliesTo(emitted.responseUrl)).toHaveLength(1);

    world.gate.release();

    // The result arrives where the acknowledgement said it would, and on the row that was pending.
    const result = await world.bench.slack.reply(emitted.responseUrl, 2);

    expect(result.body.text).toMatch(/^Dry run of security-patch on #486 complete · /);
    await world.bench.idle();

    const settled = await rowFor(text);

    expect(settled).toMatchObject({
      id: pending?.id,
      outcome: "ok",
      error_detail: null,
      reply: { text: started.body.text },
      settled_reply: { text: result.body.text },
    });
    expect(settled?.result_ref?.dryRunId).toBe(pending?.result_ref?.dryRunId);
    // The run the engine was asked for is the run the row names.
    expect(world.engine.runs).toHaveLength(1);
    expect(world.bench.slack.repliesTo(emitted.responseUrl)).toHaveLength(2);
  });

  it("settles an async command whose rehearsal fails: the result says so, at the same url and on the same row", async () => {
    pinCommits(world);
    // Nothing scripted: the engine answers the run with a 502.
    world.gate.hold();

    const text = "dry-run #486 security-patch";
    const emitted = await world.bench.slack.emitCommand({
      team: SEEDED_TEAM.id,
      user: SLACK_USERS.owner,
      channel: SEEDED_CHANNEL,
      text,
    });

    expect(emitted.response.body).toEqual(COMMAND_ACK);
    await world.bench.slack.reply(emitted.responseUrl);
    await world.bench.slack.waitFor(() => world.gate.held() === 1, "the engine to be asked");
    expect((await rowFor(text))?.outcome).toBe("async_pending");

    world.gate.release();

    const result = await world.bench.slack.reply(emitted.responseUrl, 2);

    await world.bench.idle();

    const settled = await rowFor(text);

    // The command did what it was asked — it rehearsed — so it settles `ok`; that the rehearsal
    // failed is its result, said in the result's own words and kept on the row.
    expect(settled).toMatchObject({
      outcome: "ok",
      error_detail: null,
      settled_reply: { text: result.body.text },
    });
    expect(result.body.text).toMatch(/^Dry run of security-patch on #486 failed: /);
  });
});
