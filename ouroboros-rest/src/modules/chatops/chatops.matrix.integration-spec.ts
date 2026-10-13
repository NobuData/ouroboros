/**
 * The command matrix, against a migrated database and the real planes (BZ.6,
 * [#540](https://github.com/NobuData/ouroboros/issues/540)).
 *
 * ```
 * every registry command × { ok · denied · unlinked · bad arguments · confirm required }
 *                        × { Slack's slash command · the app's console }
 * ```
 *
 * `parity.spec.ts` holds the two surfaces to the same words over doubles of the planes. This is
 * the same claim with nothing doubled: the slash command arrives signed over HTTP, the console's
 * arrives with a session, each argument is resolved by the plane that owns it, each binding makes
 * its plane's real call — and for every cell the suite reads back the three things an invocation
 * must leave: **what was said**, **the `chat_commands` row**, and **the audit event**.
 *
 * **Permissions are the person's.** A `denied` cell is typed with arguments that resolve, by
 * somebody whose role is one short; it is refused on both surfaces in the same words, and the
 * plane is untouched. Removing the capability check (`permitted` in `dispatcher.service.ts`)
 * turns every one of them red — #540's second negative control.
 *
 * **The table is held to the registry.** `MATRIX` is keyed by command id; a command the grammar
 * serves with no row here fails the suite, as does a row for a command that is gone.
 *
 * **One world, in order.** The seeded workspace is stood up once (`startCommandWorld`): the
 * cells that change nothing run first for every command, then each command's `ok` cells, which
 * do change things — each on a subject of its own, so no cell waits on another's leftovers.
 */

import { bodyOf } from "../../testing/integration.fixture";
import type { Person } from "../../testing/harness.fixture";
import { CHAT_COMMAND_INVOKED_EVENT } from "../audit/audit.events";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import {
  type CommandWorld,
  deniedReply,
  MATRIX,
  type MatrixRole,
  type MatrixRow,
  type OkCell,
  SEEDED_CHANNEL,
  SEEDED_TEAM,
  SLACK_USERS,
  startCommandWorld,
  type Surface,
  UNLINKED_REPLY,
} from "./chatops.matrix.integration.fixture";
import type {
  CallerGrammarResource,
  ChatCommandResource,
  ChatCommandResultResource,
} from "./chatops.resources";
import { DISPATCH_ERRORS } from "./dispatcher.service";
import { COMMAND_PREFIX, GRAMMAR } from "./grammar.registry";
import { REPLIES } from "../slack/slack.inbound.service";

/** A `chat_commands` row, as the suite reads it. */
interface CommandRow extends Record<string, unknown> {
  readonly id: string;
  readonly surface: Surface;
  readonly command: string;
  readonly raw_text: string;
  readonly outcome: string;
  readonly error_detail: string | null;
  readonly reply: { text: string } | null;
  readonly settled_reply: { text: string } | null;
  readonly result_ref: Record<string, unknown> | null;
  readonly invoker_user_id: string | null;
  readonly platform_user_id: string | null;
  readonly audit_event_id: string | null;
}

/** An `audit_events` row, as the suite reads it. */
interface AuditRow extends Record<string, unknown> {
  readonly id: string;
  readonly action: string;
  readonly actor_id: string | null;
  readonly subject_type: string;
  readonly detail: Record<string, unknown>;
}

/** What one invocation left behind, whichever surface it came through. */
interface Invoked {
  /** The words the person was shown. */
  readonly said: string;
  /** The row, or undefined when none was written. */
  readonly row: CommandRow | undefined;
  /** The link button under a Slack reply, when it has one. */
  readonly link?: string;
  /** The console's answer body, when it came through the console. */
  readonly body?: ChatCommandResultResource;
  /** The `response_url` a Slack command's result is posted to. */
  readonly responseUrl?: string;
}

/** The registry's command ids, read where the suite is collected. */
const COMMAND_IDS = GRAMMAR.commands.map((command) => command.id);

describe("the /ouro command matrix, on both surfaces", () => {
  let world: CommandWorld;

  beforeAll(async () => {
    world = await startCommandWorld();
  }, 60_000);

  afterAll(() => world.close());

  /**
   * Type a command in Slack and wait for what it says.
   *
   * @param user - The Slack user.
   * @param text - What follows `/ouro`.
   * @returns What it left behind.
   */
  async function inSlack(user: string, text: string): Promise<Invoked> {
    const emitted = await world.bench.slack.emitCommand({
      team: SEEDED_TEAM.id,
      user,
      channel: SEEDED_CHANNEL,
      text,
    });

    expect(emitted.response.status).toBe(200);

    const reply = await world.bench.slack.reply(emitted.responseUrl);
    const [row] = (
      await world.bench.api.sql.query<CommandRow>(
        `select * from ouroboros.chat_commands
          where surface = 'slack' and platform_user_id = $1 and raw_text = $2
          order by invoked_at desc limit 1`,
        [user, `${COMMAND_PREFIX} ${text}`],
      )
    ).rows;

    return {
      said: String(reply.body.text),
      row,
      link: world.bench.slack.buttonsOf({
        blocks: reply.body.blocks as unknown[],
        attachments: [],
      })[0]?.url,
      responseUrl: emitted.responseUrl,
    };
  }

  /**
   * Type a command in the app's console.
   *
   * @param person - Who is signed in.
   * @param text - What follows `/ouro`.
   * @returns What it left behind.
   */
  async function inConsole(person: Person, text: string): Promise<Invoked> {
    const body = bodyOf<ChatCommandResultResource>(
      await world.bench.api
        .as(person)("post", "/api/v1/chat/commands")
        .set(TENANT_HEADER, world.workspace.slug)
        .send({ text: `${COMMAND_PREFIX} ${text}` })
        .expect(200),
    );
    const rows =
      body.commandId === null
        ? []
        : await world.bench.rows<CommandRow>("chat_commands", "id = $1", [body.commandId]);

    return { said: body.reply.text, row: rows[0], body };
  }

  /**
   * Type a command as a role, on a surface.
   *
   * @param surface - Where.
   * @param role - As whom.
   * @param text - What follows `/ouro`.
   * @returns What it left behind.
   */
  function type(surface: Surface, role: MatrixRole, text: string): Promise<Invoked> {
    return surface === "slack"
      ? inSlack(SLACK_USERS[role], text)
      : inConsole(world.people[role], text);
  }

  /**
   * The user id a role's invocations are recorded under, on a surface.
   *
   * @param surface - Where.
   * @param role - As whom.
   * @returns The person's id — the seeded Ken's for Slack's owner.
   */
  async function userIdOf(surface: Surface, role: MatrixRole): Promise<string> {
    if (surface === "console" || role !== "owner") {
      return world.people[role].id;
    }

    const [ken] = await world.bench.rows<{ id: string }>("user", `"email" = $1`, [
      "ken@acme-robotics.dev",
    ]);

    return ken?.id ?? "";
  }

  /**
   * Hold an invocation to its row and its audit event.
   *
   * @param invoked - What the invocation left.
   * @param expected - The command, the surface, how it ended, what it said and who typed it.
   * @returns The row, for a cell with more to say about it.
   */
  async function expectRecorded(
    invoked: Invoked,
    expected: {
      command: string;
      surface: Surface;
      text: string;
      outcome: string;
      detail: string | null;
      userId: string | null;
    },
  ): Promise<CommandRow> {
    const { row } = invoked;

    if (row === undefined) {
      throw new Error(`"${expected.text}" left no chat_commands row.`);
    }

    expect({
      command: row.command,
      surface: row.surface,
      raw_text: row.raw_text,
      outcome: row.outcome,
      error_detail: row.error_detail,
      invoker_user_id: row.invoker_user_id,
      // What was said is on the row, whatever the outcome and the surface (#542).
      reply: row.reply?.text,
    }).toEqual({
      command: expected.command,
      surface: expected.surface,
      raw_text: `${COMMAND_PREFIX} ${expected.text}`,
      outcome: expected.outcome,
      error_detail: expected.detail,
      invoker_user_id: expected.userId,
      reply: invoked.said,
    });

    const events = await world.bench.rows<AuditRow>(
      "audit_events",
      "subject_type = 'chat_command' and subject_id = $1",
      [row.id],
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: row.audit_event_id,
      action: CHAT_COMMAND_INVOKED_EVENT,
      actor_id: expected.userId,
      detail: { surface: expected.surface, command: expected.command, outcome: expected.outcome },
    });

    return row;
  }

  /**
   * How many rows of a table the workspace holds — for *nothing was changed*.
   *
   * @param table - The table.
   * @returns The count.
   */
  async function count(table: string): Promise<number> {
    return (await world.bench.rows(table, "organization_id = $1", [world.workspace.id])).length;
  }

  /** @returns How many controls have been requested of the workspace's runs. */
  async function controlCount(): Promise<number> {
    const { rows } = await world.bench.api.sql.query<{ count: string }>(
      `select count(*) as count from ouroboros.run_controls c
         join ouroboros.runs r on r.id = c.run_id where r.organization_id = $1`,
      [world.workspace.id],
    );

    return Number(rows[0]?.count ?? 0);
  }

  /** @returns The workspace's lifecycle state, from its own route — `active` unless paused. */
  async function lifecycleState(): Promise<string> {
    return bodyOf<{ state: string }>(
      await world.bench.api
        .as(world.people.owner)("get", "/api/v1/settings/lifecycle")
        .set(TENANT_HEADER, world.workspace.slug)
        .expect(200),
    ).state;
  }

  /**
   * A row of the matrix, or a failure that names the command.
   *
   * @param id - The command.
   * @returns Its row.
   */
  function rowOf(id: string): MatrixRow {
    const row = MATRIX[id];

    if (row === undefined) {
      throw new Error(
        `The registry has a command "${id}" and the matrix has no row for it — add one to MATRIX.`,
      );
    }

    return row;
  }

  describe("the table and the registry", () => {
    it("has a row for every command the service serves, and no row for one it does not", async () => {
      const served = bodyOf<CallerGrammarResource>(
        await world.bench.api
          .as(world.people.viewer)("get", "/api/v1/chat/grammar")
          .set(TENANT_HEADER, world.workspace.slug)
          .expect(200),
      ).commands.map((command) => command.id);

      expect(served.length).toBeGreaterThan(0);
      expect(Object.keys(MATRIX).sort()).toEqual([...served].sort());
      expect([...COMMAND_IDS].sort()).toEqual([...served].sort());
    });

    it("declares a confirm cell for exactly the destructive commands", () => {
      for (const command of GRAMMAR.commands) {
        expect(["confirmRequired" in rowOf(command.id), command.id]).toEqual([true, command.id]);
        expect("notApplicable" in rowOf(command.id).confirmRequired).toBe(!command.destructive);
      }
    });

    it("declares a denied cell for exactly the commands a role can be refused", () => {
      for (const command of GRAMMAR.commands) {
        // `v2` is answered before anybody's role is looked at.
        const refusable = command.requires.roles.length > 0 && command.stage !== "v2";

        expect(["notApplicable" in rowOf(command.id).denied, command.id]).toEqual([
          !refusable,
          command.id,
        ]);
      }
    });
  });

  describe.each(COMMAND_IDS)("/ouro %s — refused, and nothing changes", (id) => {
    it("unlinked, in Slack: told to link, recorded against nobody, and nothing runs", async () => {
      const { text } = rowOf(id).ok.slack;
      const before = [await controlCount(), await count("queue_items")];
      const invoked = await inSlack(SLACK_USERS.nobody, text);

      expect(invoked.said).toBe(UNLINKED_REPLY);
      // The sentence, and under it the way to fix it.
      expect(invoked.link).toContain("/api/v1/slack/link/");

      const row = await expectRecorded(invoked, {
        command: id,
        surface: "slack",
        text,
        outcome: "unlinked",
        detail: null,
        userId: null,
      });

      // Investigable: the attempt names the Slack user it came from.
      expect(row.platform_user_id).toBe(SLACK_USERS.nobody);
      expect(row.result_ref).toBeNull();
      expect([await controlCount(), await count("queue_items")]).toEqual(before);
    });

    it.each<Surface>(["slack", "console"])("denied, in %s", async (surface) => {
      const cell = rowOf(id).denied;

      if ("notApplicable" in cell) {
        // Declared, not skipped: the table says why there is nobody to refuse.
        expect(cell.notApplicable).not.toBe("");

        return;
      }

      const before = [await controlCount(), await count("queue_items")];
      const invoked = await type(surface, cell.as, cell.text);

      expect(invoked.said).toBe(deniedReply(id));
      await expectRecorded(invoked, {
        command: id,
        surface,
        text: cell.text,
        outcome: "denied",
        detail: null,
        userId: await userIdOf(surface, cell.as),
      });
      expect(invoked.row?.result_ref).toBeNull();
      expect([await controlCount(), await count("queue_items")]).toEqual(before);
    });

    it.each<Surface>(["slack", "console"])("bad arguments, in %s", async (surface) => {
      const cell = rowOf(id).badArguments;
      const invoked = await type(surface, "owner", cell.text);

      expect(invoked.said).toEqual(
        typeof cell.reply === "string" ? cell.reply : expect.stringMatching(cell.reply),
      );
      await expectRecorded(invoked, {
        command: id,
        surface,
        text: cell.text,
        outcome: "error",
        detail: DISPATCH_ERRORS.badArguments,
        userId: await userIdOf(surface, "owner"),
      });
    });

    it.each<Surface>(["slack", "console"])("confirm required, in %s", async (surface) => {
      const cell = rowOf(id).confirmRequired;

      if ("notApplicable" in cell) {
        expect(cell.notApplicable).not.toBe("");

        return;
      }

      const before = [await controlCount(), await lifecycleState()];
      const invoked = await type(surface, "owner", cell.text);

      expect(invoked.said).toBe(cell.reply);
      await expectRecorded(invoked, {
        command: id,
        surface,
        text: cell.text,
        outcome: "error",
        detail: DISPATCH_ERRORS.confirmationRequired,
        userId: await userIdOf(surface, "owner"),
      });
      // The console is handed the line to send; Slack's reader retypes it from the sentence.
      if (surface === "console") {
        expect(invoked.body?.confirmWith).toBe(cell.confirmWith);
      }
      // Described, not done.
      expect([await controlCount(), await lifecycleState()]).toEqual(before);
    });
  });

  describe("a merge, typed as an answer in Slack", () => {
    it("is refused by the plane — a merge is confirmed signed in — and the question stays open", async () => {
      const invoked = await inSlack(SLACK_USERS.owner, "answer q-1 approve_merge");

      expect(invoked.said).toMatch(
        /^A merge is confirmed in Ouroboros, signed in — it cannot be answered from chat\./,
      );
      expect(invoked.row).toMatchObject({ command: "answer", outcome: "error" });
      expect(invoked.row?.error_detail).not.toBeNull();
      expect(invoked.row?.result_ref).toBeNull();

      const [question] = await world.bench.rows<{ status: string }>(
        "decision_items",
        "organization_id = $1 and short_seq = 1",
        [world.workspace.id],
      );

      // Still open: the console's `ok` cell below is what answers it.
      expect(question?.status).toBe("open");
    });
  });

  describe.each(COMMAND_IDS)("/ouro %s — runs", (id) => {
    /**
     * Wait for an async command's row to leave `async_pending`.
     *
     * @param commandId - The row.
     * @returns The row, settled.
     */
    async function settled(commandId: string): Promise<CommandRow> {
      return world.bench.slack.waitFor(async () => {
        const [row] = await world.bench.rows<CommandRow>("chat_commands", "id = $1", [commandId]);

        return row !== undefined && row.outcome !== "async_pending" ? row : undefined;
      }, `command ${commandId} to settle`);
    }

    /**
     * Run a cell and hold it to its reply, its row and its audit event.
     *
     * @param surface - Where it is typed.
     * @param cell - The cell.
     */
    async function runs(surface: Surface, cell: OkCell): Promise<void> {
      await cell.arrange?.(world);

      try {
        const invoked = await type(surface, "owner", cell.text);

        expect(invoked.said).toEqual(
          typeof cell.reply === "string" ? cell.reply : expect.stringMatching(cell.reply),
        );

        const row = await expectRecorded(invoked, {
          command: id,
          surface,
          text: cell.text,
          // Read before the result can have settled only when nothing else is awaited first —
          // so an async cell is held to whichever of the two honest states the row is in.
          outcome: cell.settles === undefined ? "ok" : (invoked.row?.outcome ?? ""),
          detail: null,
          userId: await userIdOf(surface, "owner"),
        });

        // A reply is a message of the channel in Slack, and never in the console.
        expect(typeof row.result_ref?.message).toBe(surface === "slack" ? "string" : "undefined");

        if (cell.settles === undefined) {
          expect(row.settled_reply).toBeNull();

          return;
        }

        expect(["async_pending", "ok"]).toContain(row.outcome);

        const done = await settled(row.id);

        expect(done.outcome).toBe("ok");
        expect(done.error_detail).toBeNull();
        expect(done.settled_reply?.text).toMatch(cell.settles);
        // The acknowledgement stays what was said at once.
        expect(done.reply?.text).toBe(invoked.said);

        if (surface === "slack") {
          // The result follows to the same `response_url`.
          const followUp = await world.bench.slack.reply(invoked.responseUrl, 2);

          expect(followUp.body.text).toBe(done.settled_reply?.text);
        } else {
          // The console has no follow-up: it reads the row.
          const read = bodyOf<ChatCommandResource>(
            await world.bench.api
              .as(world.people.owner)("get", `/api/v1/chat/commands/${row.id}`)
              .set(TENANT_HEADER, world.workspace.slug)
              .expect(200),
          );

          expect(read).toMatchObject({
            id: row.id,
            outcome: "ok",
            settledReply: { text: done.settled_reply?.text },
          });
        }
      } finally {
        await world.bench.idle();
        await cell.restore?.(world);
      }
    }

    it("in Slack, against the real plane", () => runs("slack", rowOf(id).ok.slack));

    it("in the console, against the real plane", () => runs("console", rowOf(id).ok.console));
  });

  describe("what the planes were actually asked to do", () => {
    it("queued the two issues, requested the six controls, answered the two questions, repinned the two routes", async () => {
      const queued = await world.bench.rows<{ issue_number: number; workflow_tag: string }>(
        "queue_items",
        "organization_id = $1 and issue_number in (484, 485)",
        [world.workspace.id],
      );
      const controls = await world.bench.api.sql.query<{ kind: string; loop_seq: number }>(
        `select c.kind, r.loop_seq from ouroboros.run_controls c
           join ouroboros.runs r on r.id = c.run_id
          where r.organization_id = $1 and c.requested_at > now() - interval '10 minutes'
          order by r.loop_seq, c.kind`,
        [world.workspace.id],
      );
      const answered = await world.bench.api.sql.query<{ short_seq: number; status: string }>(
        `select short_seq, status from ouroboros.decision_items
          where organization_id = $1 and short_seq in (1, 3) order by short_seq`,
        [world.workspace.id],
      );
      const routed = await world.bench.api.sql.query<{ name: string; alias: string }>(
        `select k.name, a.alias from ouroboros.routes r
           join ouroboros.task_kinds k on k.id = r.task_kind_id
           join ouroboros.route_hops h on h.route_id = r.id and h.position = 1
           join ouroboros.model_aliases a on a.id = h.model_alias_id
          where r.organization_id = $1 and k.name in ('implement', 'review') order by k.name`,
        [world.workspace.id],
      );

      expect(queued.map((item) => [item.issue_number, item.workflow_tag]).sort()).toEqual([
        [484, "standard-fix"],
        [485, "feature-loop"],
      ]);
      expect(controls.rows.map((control) => `${control.kind} ${String(control.loop_seq)}`)).toEqual(
        ["abort 1841", "abort 1844", "pause 1844", "resume 1844", "pause 1847", "resume 1847"],
      );
      expect(answered.rows.map((item) => item.status)).toEqual(["resolved", "resolved"]);
      expect(routed.rows).toEqual([
        { name: "implement", alias: "coder-std" },
        { name: "review", alias: "coder-std" },
      ]);
      // Both dry runs reached the engine: neither was answered from anywhere else.
      expect(world.engine.runs).toHaveLength(2);
    });
  });

  describe("somebody who has left the workspace", () => {
    it("is unlinked in Slack and unknown to the console — never `denied`, and never run", async () => {
      const leaver = await world.bench.member(world.workspace, "admin", "Sam Ortiz");

      await world.bench.link(SEEDED_TEAM, "U07LEAVER", leaver);
      expect((await inSlack("U07LEAVER", "status")).row?.outcome).toBe("ok");

      await world.bench.api.sql.query(
        `delete from ouroboros.member where "organizationId" = $1 and "userId" = $2`,
        [world.workspace.id, leaver.id],
      );

      // The database revokes the link with the membership, so the person is nobody in Slack…
      const inChat = await inSlack("U07LEAVER", "pause all confirm");

      expect(inChat.said).toBe(REPLIES.needsLink);
      expect(inChat.row).toMatchObject({ outcome: "unlinked", invoker_user_id: null });

      // …and the tenant guard answers before the console's dispatcher is reached.
      const before = await count("chat_commands");
      const refused = await world.bench.api
        .as(leaver)("post", "/api/v1/chat/commands")
        .set(TENANT_HEADER, world.workspace.slug)
        .send({ text: "pause all confirm" })
        .expect(404);

      expect(bodyOf<{ code: string }>(refused).code).toBe("tenant_not_found");
      expect(await count("chat_commands")).toBe(before);

      expect(await lifecycleState()).toBe("active");
    });
  });
});
