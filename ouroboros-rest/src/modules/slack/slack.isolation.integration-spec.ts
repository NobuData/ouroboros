/**
 * Two workspaces, two Slack connections, one deployment — and nothing crossing between them
 * (BZ.6, [#540](https://github.com/NobuData/ouroboros/issues/540)).
 *
 * Multi-tenancy is not visible from inside one workspace's tests. Here **acme** has Slack's
 * `T0ACME` installed and **globex** has `T0GLOBEX`; each has a bound loops channel, a linked
 * member and a real blocking question — a protected-path card filed by AP.3 from a run the
 * simulated driver reported, published by the outbox and posted to the harness's Slack. Every
 * crossing is then attempted the way it would actually be attempted:
 *
 *   - **publishing**: each card, its edit and its system line go out under its own workspace's
 *     bot token to its own channel; a route cannot be pointed at the other workspace's channel
 *     by its route, by the binding route, or by a row written straight into the database;
 *   - **answering**: a genuine button value from one workspace does nothing when it arrives
 *     from the other's Slack — on the other's message, on its own, or with none — and
 *     `/ouro answer` finds no question that is not its own workspace's;
 *   - **reading and typing**: a Slack user acts only in the workspace their team is installed
 *     for, and the console and the mirror refuse the other workspace's channel.
 *
 * Each refusal sits beside a control — the same press, by the right person in the right
 * workspace, answers — so that "nothing changed" is not what an inert fixture would also say.
 */

import { ACME, ChatBench, GLOBEX } from "../../testing/chatops.bench.fixture";
import type { Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import type { HarnessTeam, PostedMessage, RecordedCall } from "../../testing/slack.harness.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { protectBoot, touchingRun } from "./slack.decisions.integration.fixture";
import { seedIngestBench, type IngestBench } from "../ingest/ingest.fixture";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { REPLIES } from "./slack.inbound.service";
import type { SlackChannelResource } from "./slack.resources";

/** The protected path each workspace's run touches. */
const PROTECTED = "boot/rollback_flag.c";

/** The action every press here names. */
const ALLOW_ONCE = "allow_once";

/** One side of the suite: a workspace, its Slack, and the person who is both. */
interface Side {
  readonly team: HarnessTeam;
  /** The workspace's owner, linked to {@link Side.slackUser}. */
  readonly owner: Person;
  readonly slackUser: string;
  readonly ingest: IngestBench;
  /** The bound loops channel, as the service lists it. */
  readonly loops: SlackChannelResource;
}

/** A blocking question, posted. */
interface Card {
  /** `decision_items.id`. */
  readonly item: string;
  /** `q-<n>`, as the card prints it. */
  readonly shortId: string;
  /** The message in Slack. */
  readonly message: PostedMessage;
  /** The signed value of its **Allow once** button. */
  readonly allowOnce: string;
}

/** The part of a decision item an answer changes. */
interface ItemRow extends Record<string, unknown> {
  id: string;
  organization_id: string;
  status: string;
  short_seq: number;
  updated_at: Date;
}

describe("two workspaces, two Slack connections", () => {
  let bench: ChatBench;

  beforeAll(async () => {
    bench = await ChatBench.start();
  });

  afterAll(() => bench.close());
  afterEach(() => bench.reset());

  /**
   * A workspace with a repository that protects `boot/**`, Slack installed, its loops channel
   * bound and its owner linked.
   *
   * @param team - The Slack workspace it installs.
   * @param slackUser - The Slack user its owner links.
   * @returns The side.
   */
  async function side(team: HarnessTeam, slackUser: string): Promise<Side> {
    const owner = await bench.api.signIn({ displayName: `${team.name} owner` });
    const ingest = await seedIngestBench(bench.api, owner);

    await protectBoot(bench, ingest.workspace);
    await bench.install(owner, ingest.workspace, team);

    const loops = await bench.bind(owner, ingest.workspace, team.channels[0]?.id ?? "", "loops");

    await bench.link(team, slackUser, owner);

    return { team, owner, slackUser, ingest, loops };
  }

  /**
   * File a real blocking question in a workspace and post it: a run touches the protected path,
   * AP.3 refuses it, the publisher intends the card and a dispatch pass sends it.
   *
   * @param on - The side.
   * @returns The card, as posted.
   */
  async function ask(on: Side): Promise<Card> {
    await touchingRun(bench, on.ingest, on.team.id, PROTECTED);

    const item = await bench.slack.waitFor(
      async () =>
        (
          await bench.rows<ItemRow>(
            "decision_items",
            "organization_id = $1 and kind_id = 'protected_path_allow_once'",
            [on.ingest.workspace.id],
          )
        )[0],
      `${on.team.name}'s decision item`,
    );

    // The publisher hears the filing detached: the intent is a row a moment later.
    await bench.slack.waitFor(
      async () => (await bench.rows("chat_outbox", "decision_item_id = $1", [item.id])).length > 0,
      `${on.team.name}'s card intent`,
    );
    await bench.tick();

    const message = bench.slack
      .messagesIn(on.loops.platformChannelId)
      .find((posted) => valuesOf(posted).some((value) => value.includes(item.id)));

    if (message === undefined) {
      throw new Error(`${on.team.name}'s card was not posted to its loops channel.`);
    }

    const allowOnce = valuesOf(message).find((value) => value.includes(`|${ALLOW_ONCE}|`));

    if (allowOnce === undefined) {
      throw new Error(`${on.team.name}'s card carries no ${ALLOW_ONCE} button.`);
    }

    return { item: item.id, shortId: `q-${String(item.short_seq)}`, message, allowOnce };
  }

  /**
   * The signed values of a message's buttons.
   *
   * @param message - The message.
   * @returns Each answering button's value.
   */
  function valuesOf(message: PostedMessage): string[] {
    return bench.slack
      .buttonsOf(message)
      .map((button) => button.value)
      .filter((value): value is string => value !== undefined);
  }

  /**
   * A decision item, as it stands.
   *
   * @param id - The item.
   * @returns The row.
   */
  async function itemOf(id: string): Promise<ItemRow | undefined> {
    return (await bench.rows<ItemRow>("decision_items", "id = $1", [id]))[0];
  }

  /**
   * Press a button as a Slack user and read what they were told.
   *
   * @param as - Whose Slack the press arrives from.
   * @param value - The button's value.
   * @param message - The message the press says it is on, or null for none.
   * @returns The ephemeral reply's text.
   */
  async function press(
    as: Pick<Side, "team" | "slackUser">,
    value: string,
    message: Pick<PostedMessage, "channel" | "ts"> | null,
  ): Promise<string> {
    const pressed = await bench.press({
      team: as.team.id,
      user: as.slackUser,
      action: { actionId: `decision:${ALLOW_ONCE}`, value },
      message: message === null ? null : { channel: message.channel, ts: message.ts },
    });

    return pressed.text;
  }

  /**
   * Type `/ouro <text>` as a Slack user and read what they were told.
   *
   * @param as - Whose Slack it is typed in.
   * @param text - The text after `/ouro`.
   * @returns The ephemeral reply's text.
   */
  function typed(as: Pick<Side, "team" | "slackUser">, text: string): Promise<string> {
    return bench.typed(as.team, as.slackUser, text);
  }

  /**
   * The message calls made since a mark, as `[method, token, channel]`.
   *
   * @param from - How many calls had been made at the mark.
   * @returns Them, oldest first.
   */
  function messageCalls(from = 0): [string, string | undefined, string | undefined][] {
    return bench.slack.calls
      .slice(from)
      .filter((call: RecordedCall) => call.method.startsWith("chat."))
      .map((call) => [call.method, call.token, call.form.channel]);
  }

  describe("publishing", () => {
    it("posts each workspace's card under its own token, to its own channel", async () => {
      const acme = await side(ACME, "U0KEN");
      const globex = await side(GLOBEX, "U1HANK");
      const ours = await ask(acme);
      const theirs = await ask(globex);

      // Every message call pairs a workspace's token with that workspace's channel.
      const calls = messageCalls();

      expect(calls).toEqual(
        expect.arrayContaining([
          ["chat.postMessage", ACME.botToken, "C0LOOPS"],
          ["chat.postMessage", GLOBEX.botToken, "C1LOOPS"],
        ]),
      );
      for (const [, token, channel] of calls) {
        expect([
          [ACME.botToken, "C0LOOPS"],
          [GLOBEX.botToken, "C1LOOPS"],
        ]).toContainEqual([token, channel]);
      }

      // And what is standing in each channel is about that workspace's question alone.
      const standing = (channel: string) =>
        bench.slack.messagesIn(channel).flatMap((message) => valuesOf(message));

      expect(standing("C0LOOPS").every((value) => value.includes(ours.item))).toBe(true);
      expect(standing("C1LOOPS").every((value) => value.includes(theirs.item))).toBe(true);
      expect(standing("C0LOOPS").join()).not.toContain(theirs.item);
      expect(standing("C1LOOPS").join()).not.toContain(ours.item);
      expect(bench.slack.messagesIn("C0LOOPS").map((message) => message.team)).toEqual([ACME.id]);
      expect(bench.slack.messagesIn("C1LOOPS").map((message) => message.team)).toEqual([GLOBEX.id]);

      // The records agree with the wire.
      const recorded = await bench.rows<{ organization_id: string; channel_id: string }>(
        "chat_messages",
      );

      expect(recorded.map((row) => [row.organization_id, row.channel_id]).sort()).toEqual(
        [
          [acme.ingest.workspace.id, acme.loops.id],
          [globex.ingest.workspace.id, globex.loops.id],
        ].sort(),
      );
    });

    it("edits only the answered workspace's card, and says so only in its channel", async () => {
      const acme = await side(ACME, "U0KEN");
      const globex = await side(GLOBEX, "U1HANK");
      const ours = await ask(acme);
      const theirs = await ask(globex);
      const mark = bench.slack.calls.length;

      expect(await press(acme, ours.allowOnce, ours.message)).toMatch(/^Answered: /);

      // The resolution is heard detached; its edit and its line are intents a moment later.
      await bench.slack.waitFor(
        async () =>
          (
            await bench.rows("chat_outbox", "decision_item_id = $1 and operation = 'update'", [
              ours.item,
            ])
          ).length > 0,
        "the resolved card's edit",
      );
      await bench.tick();

      const after = messageCalls(mark);

      expect(after).toContainEqual(["chat.update", ACME.botToken, "C0LOOPS"]);
      for (const [, token, channel] of after) {
        expect([token, channel]).toEqual([ACME.botToken, "C0LOOPS"]);
      }

      const theirCard = bench.slack
        .messagesIn("C1LOOPS")
        .find((message) => message.ts === theirs.message.ts);

      expect(theirCard).toEqual(theirs.message);
      expect(bench.slack.messagesIn("C1LOOPS")).toHaveLength(1);
      expect((await itemOf(theirs.item))?.status).toBe("open");
    });

    it("revokes only the workspace whose Slack removed the app", async () => {
      const acme = await side(ACME, "U0KEN");
      const globex = await side(GLOBEX, "U1HANK");

      await bench.slack.emitEvent({
        type: "event_callback",
        team_id: GLOBEX.id,
        event_id: "Ev1GONE",
        event: { type: "app_uninstalled" },
      });
      await bench.idle();

      const status = async (on: Side): Promise<string[]> =>
        (
          await bench.rows<{ status: string }>("chat_connections", "organization_id = $1", [
            on.ingest.workspace.id,
          ])
        ).map((row) => row.status);

      expect(await status(globex)).toEqual(["revoked"]);
      expect(await status(acme)).toEqual(["active"]);
      // Acme still publishes; globex's question has nowhere to go and goes nowhere.
      await ask(acme);
      expect(bench.slack.messagesIn("C1LOOPS")).toEqual([]);
    });

    it("refuses to point a route at the other workspace's channel, by either route", async () => {
      const acme = await side(ACME, "U0KEN");
      const globex = await side(GLOBEX, "U1HANK");
      const routeOf = async (): Promise<unknown> =>
        (
          await bench.rows<{ chat_channel_id: string | null }>(
            "notification_routes",
            "organization_id = $1 and kind = 'custom:blocking-questions'",
            [acme.ingest.workspace.id],
          )
        )[0]?.chat_channel_id;

      expect(await routeOf()).toBe(acme.loops.id);

      const repointed = await bench.api
        .as(acme.owner)("patch", "/api/v1/settings/notifications/custom:blocking-questions")
        .set(TENANT_HEADER, acme.ingest.workspace.slug)
        .send({ chatChannelId: globex.loops.id });
      const bound = await bench.api
        .as(acme.owner)("put", `/api/v1/slack/channels/${globex.loops.id}/binding`)
        .set(TENANT_HEADER, acme.ingest.workspace.slug)
        .send({ purpose: "alerts" });
      const unbound = await bench.api
        .as(acme.owner)("delete", `/api/v1/slack/channels/${globex.loops.id}/binding`)
        .set(TENANT_HEADER, acme.ingest.workspace.slug);

      expect([repointed.status, bodyOf<{ code: string }>(repointed).code]).toEqual([
        404,
        "chat_channel_not_found",
      ]);
      expect([bound.status, bodyOf<{ code: string }>(bound).code]).toEqual([
        404,
        "slack_channel_not_found",
      ]);
      expect([unbound.status, bodyOf<{ code: string }>(unbound).code]).toEqual([
        404,
        "slack_channel_not_found",
      ]);

      // Nothing moved on either side.
      expect(await routeOf()).toBe(acme.loops.id);
      expect(
        await bench.rows("chat_channels", "id = $1 and purpose_tag = 'loops'", [globex.loops.id]),
      ).toHaveLength(1);

      // And a question asked now still goes home.
      const ours = await ask(acme);

      expect(ours.message.channel).toBe("C0LOOPS");
      expect(bench.slack.messagesIn("C1LOOPS")).toEqual([]);
    });

    it("cannot be told otherwise by a row: the database refuses a cross-workspace target", async () => {
      const acme = await side(ACME, "U0KEN");
      const globex = await side(GLOBEX, "U1HANK");

      await ask(acme);

      // A route of acme's, pointed at globex's channel.
      await expect(
        bench.api.sql.query(
          `update ${SCHEMA_NAME}.notification_routes set chat_channel_id = $2
            where organization_id = $1 and kind = 'custom:blocking-questions'`,
          [acme.ingest.workspace.id, globex.loops.id],
        ),
      ).rejects.toMatchObject({ constraint: "notification_routes_chat_channel_fk" });

      // An intent of acme's — acme's connection, acme's token — aimed at globex's channel.
      await expect(
        bench.api.sql.query(
          `update ${SCHEMA_NAME}.chat_outbox set channel_id = $2 where organization_id = $1`,
          [acme.ingest.workspace.id, globex.loops.id],
        ),
      ).rejects.toMatchObject({ constraint: "chat_outbox_channel_fk" });

      // A record of acme's, filed under globex's channel.
      await expect(
        bench.api.sql.query(
          `update ${SCHEMA_NAME}.chat_messages set channel_id = $2 where organization_id = $1`,
          [acme.ingest.workspace.id, globex.loops.id],
        ),
      ).rejects.toMatchObject({ constraint: "chat_messages_channel_fk" });

      // A channel of globex's connection, relabelled as acme's.
      await expect(
        bench.api.sql.query(
          `update ${SCHEMA_NAME}.chat_channels set organization_id = $1 where id = $2`,
          [acme.ingest.workspace.id, globex.loops.id],
        ),
      ).rejects.toMatchObject({ constraint: "chat_channels_connection_fk" });
    });
  });

  describe("answering", () => {
    it("does nothing with one workspace's button when it arrives from the other's Slack", async () => {
      const acme = await side(ACME, "U0KEN");
      const globex = await side(GLOBEX, "U1HANK");
      const ours = await ask(acme);
      const theirs = await ask(globex);
      const before = await itemOf(theirs.item);
      const mark = bench.slack.calls.length;

      // Ken — an owner, linked, in acme — presents globex's genuine value three ways.
      for (const message of [theirs.message, ours.message, null]) {
        expect(await press(acme, theirs.allowOnce, message)).toBe(REPLIES.pressRejected);
      }
      // And the mirror image: Hank, with acme's value, on globex's own card.
      expect(await press(globex, ours.allowOnce, theirs.message)).toBe(REPLIES.pressRejected);

      expect(await itemOf(theirs.item)).toEqual(before);
      expect((await itemOf(ours.item))?.status).toBe("open");
      expect(await bench.rows("guardrail_exceptions")).toEqual([]);
      expect(await bench.rows("audit_events", "action = 'decision.answered'")).toEqual([]);
      await bench.tick();
      expect(messageCalls(mark)).toEqual([]);

      // The control: the same value, from its own workspace's Slack, on its own card, answers.
      expect(await press(globex, theirs.allowOnce, theirs.message)).toMatch(/^Answered: /);
      expect((await itemOf(theirs.item))?.status).toBe("resolved");
      expect((await itemOf(ours.item))?.status).toBe("open");
      expect(
        (await bench.rows<{ organization_id: string }>("guardrail_exceptions")).map(
          (row) => row.organization_id,
        ),
      ).toEqual([globex.ingest.workspace.id]);
    });

    it("does not let a member of both workspaces answer one's question from the other's Slack", async () => {
      const acme = await side(ACME, "U0KEN");
      const globex = await side(GLOBEX, "U1HANK");

      // Ken is an admin of globex too — he may answer there, signed in. His Slack is acme's.
      await bench.api.join(globex.ingest.workspace.id, acme.owner, "admin");

      const ours = await ask(acme);
      const theirs = await ask(globex);

      expect(await press(acme, theirs.allowOnce, theirs.message)).toBe(REPLIES.pressRejected);
      expect(await press(acme, theirs.allowOnce, ours.message)).toBe(REPLIES.pressRejected);
      expect((await itemOf(theirs.item))?.status).toBe("open");
    });

    it("finds no question that is not the typing workspace's", async () => {
      const acme = await side(ACME, "U0KEN");
      const globex = await side(GLOBEX, "U1HANK");
      const theirs = await ask(globex);
      const before = await itemOf(theirs.item);

      // Acme has asked nothing: globex's id names nothing there.
      const reply = await typed(acme, `answer ${theirs.shortId} ${ALLOW_ONCE}`);

      expect(reply).toContain(`no question ${theirs.shortId} in this workspace`);
      expect(await itemOf(theirs.item)).toEqual(before);

      const recorded = await bench.rows<{
        organization_id: string;
        outcome: string;
        error_detail: string | null;
      }>("chat_commands", "command = 'answer'");

      expect(recorded).toMatchObject([
        {
          organization_id: acme.ingest.workspace.id,
          outcome: "error",
          error_detail: "bad_arguments",
        },
      ]);

      // With a question of its own under the same id, acme's is the one answered.
      const ours = await ask(acme);

      // Short ids are numbered per workspace (V133): the two questions are both `q-1`.
      expect(ours.shortId).toBe(theirs.shortId);
      await typed(acme, `answer ${ours.shortId} ${ALLOW_ONCE}`);

      expect((await itemOf(ours.item))?.status).toBe("resolved");
      expect(await itemOf(theirs.item)).toEqual(before);
    });
  });

  describe("typing and reading", () => {
    it("runs a Slack user's commands in the workspace their team is installed for, only", async () => {
      const acme = await side(ACME, "U0KEN");
      const globex = await side(GLOBEX, "U1HANK");

      await typed(globex, "status");
      // Hank's Slack id means nothing to acme's connection, and Ken's nothing to globex's.
      expect(await typed({ team: ACME, slackUser: "U1HANK" }, "status")).toBe(REPLIES.needsLink);
      expect(await typed({ team: GLOBEX, slackUser: "U0KEN" }, "status")).toBe(REPLIES.needsLink);

      const recorded = await bench.rows<{
        organization_id: string;
        platform_user_id: string;
        invoker_user_id: string | null;
        outcome: string;
      }>("chat_commands", "true order by invoked_at");

      expect(
        recorded.map((row) => [
          row.organization_id,
          row.platform_user_id,
          row.invoker_user_id,
          row.outcome === "unlinked",
        ]),
      ).toEqual([
        [globex.ingest.workspace.id, "U1HANK", globex.owner.id, false],
        [acme.ingest.workspace.id, "U1HANK", null, true],
        [globex.ingest.workspace.id, "U0KEN", null, true],
      ]);
    });

    it("refuses the other workspace's channel in the console and in the mirror", async () => {
      const acme = await side(ACME, "U0KEN");
      const globex = await side(GLOBEX, "U1HANK");

      const theirs = await ask(globex);

      const asAcme = (method: "get" | "post", path: string) =>
        bench.api.as(acme.owner)(method, path).set(TENANT_HEADER, acme.ingest.workspace.slug);

      const console = await asAcme("post", "/api/v1/chat/commands").send({
        text: "/ouro status",
        channelId: globex.loops.id,
      });
      const mirror = await asAcme("get", `/api/v1/chat/channels/${globex.loops.id}/mirror`);
      const listed = await asAcme("get", "/api/v1/slack/channels").expect(200);

      expect([console.status, bodyOf<{ code: string }>(console).code]).toEqual([
        404,
        "chat_channel_not_found",
      ]);
      expect([mirror.status, bodyOf<{ code: string }>(mirror).code]).toEqual([
        404,
        "chat_channel_not_found",
      ]);
      expect(JSON.stringify(listed.body)).not.toContain(globex.loops.id);
      expect(JSON.stringify(listed.body)).not.toContain("C1LOOPS");
      // Refused before anything ran: no command was recorded anywhere.
      expect(await bench.rows("chat_commands")).toEqual([]);

      // The controls: its own channel, in both.
      await asAcme("post", "/api/v1/chat/commands")
        .send({ text: "/ouro status", channelId: acme.loops.id })
        .expect(200);

      const own = await asAcme("get", `/api/v1/chat/channels/${acme.loops.id}/mirror`).expect(200);

      expect(JSON.stringify(own.body)).not.toContain(theirs.item);
      expect(
        (await bench.rows<{ organization_id: string }>("chat_commands")).map(
          (row) => row.organization_id,
        ),
      ).toEqual([acme.ingest.workspace.id]);
    });

    it("gives a Slack workspace installed twice to one workspace's commands, never to both", async () => {
      // What the schema allows (V130): `chat_connections_workspace_key` is unique per
      // *organisation*, so a second workspace may install the same Slack team and both
      // connections are active. An inbound request then resolves to the newest install — see
      // `SlackRepository.activeByWorkspace` — and what this holds is that nothing of the first
      // workspace's follows it there: not its links, not its buttons.
      const acme = await side(ACME, "U0KEN");
      const ours = await ask(acme);
      const second = await bench.owned("Second Owner");

      expect(await bench.install(second.owner, second.workspace, ACME)).toContain(
        "slack=connected",
      );
      expect(
        (
          await bench.rows<{ organization_id: string; status: string }>(
            "chat_connections",
            "workspace_id = $1 order by installed_at",
            [ACME.id],
          )
        ).map((row) => [row.organization_id, row.status]),
      ).toEqual([
        [acme.ingest.workspace.id, "active"],
        [second.workspace.id, "active"],
      ]);

      // Ken is linked in acme. Through the newer connection he is nobody…
      expect(await typed(acme, "status")).toBe(REPLIES.needsLink);
      // …and acme's own button, on acme's own card, is not that connection's to answer.
      expect(await press(acme, ours.allowOnce, ours.message)).not.toMatch(/^Answered/);
      expect((await itemOf(ours.item))?.status).toBe("open");

      const recorded = await bench.rows<{
        organization_id: string;
        outcome: string;
        invoker_user_id: string | null;
      }>("chat_commands");

      expect(recorded).toMatchObject([
        { organization_id: second.workspace.id, outcome: "unlinked", invoker_user_id: null },
      ]);
    });

    it("keeps a workspace to one active Slack connection", async () => {
      const acme = await side(ACME, "U0KEN");

      // Acme's owner comes back from Slack having approved a *different* Slack workspace.
      const landed = await bench.install(acme.owner, acme.ingest.workspace, GLOBEX);

      expect(landed).toContain("slack=slack_already_connected");
      expect(
        (
          await bench.rows<{ workspace_id: string; status: string }>(
            "chat_connections",
            "organization_id = $1",
            [acme.ingest.workspace.id],
          )
        ).map((row) => [row.workspace_id, row.status]),
      ).toEqual([[ACME.id, "active"]]);
    });
  });
});
