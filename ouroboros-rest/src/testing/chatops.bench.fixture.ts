/**
 * A workspace with Slack connected, for the Chat Ops integration suites (BZ.6,
 * [#540](https://github.com/NobuData/ouroboros/issues/540)).
 *
 * `slack.harness.fixture.ts` is Slack; this is what a suite does with it. **Everything is
 * arranged the way a person arranges it** — the install is the OAuth round trip, a channel is
 * bound through its route, an identity is linked by typing `/ouro link` and confirming the page —
 * so the arrangement is itself a pass through the code under test, and a suite starts from rows
 * the service wrote rather than rows a fixture guessed at.
 *
 * **Time is the suite's.** The publisher's two timers are cleared at start, and
 * {@link ChatBench.tick} runs the pass they would have run at whatever instant the test names:
 * a backoff, a `Retry-After` and an escalation window are crossed by saying a later `now`, never
 * by waiting.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts`.
 */

import { SchedulerRegistry } from "@nestjs/schedule";

import { ChatDispatcher, type ChatDispatchReport } from "../modules/chat/chat.dispatcher";
import { ChatEscalation, type EscalationReport } from "../modules/chat/chat.escalation";
import { ChatPublisher } from "../modules/chat/chat.publisher";
import { CHAT_DISPATCH_TIMEOUT, CHAT_UPKEEP_TIMEOUT } from "../modules/chat/chat.scheduler";
import { SCHEMA_NAME } from "../modules/db/schema";
import { OAUTH_STATE_COOKIE } from "../modules/slack/slack.controller";
import { SlackInboundService } from "../modules/slack/slack.inbound.service";
import type {
  SlackChannelPurpose,
  SlackChannelResource,
  SlackChannelsResource,
} from "../modules/slack/slack.resources";
import { TENANT_HEADER } from "../modules/tenancy/tenant.resolver";
import { ApiHarness, type Person, type ProviderOverride, type Workspace } from "./harness.fixture";
import { bodyOf, setCookie } from "./integration.fixture";
import {
  type Emitted,
  type EmittedPress,
  type HarnessTeam,
  type RecordedReply,
  SlackHarness,
} from "./slack.harness.fixture";

/** The simulated driver's credential — the internal channel a run is reported through. */
export const BENCH_SIMULATOR_SECRET = "bz6-run-simulator-secret";

/** The acme workspace: the team most suites install. */
export const ACME: HarnessTeam = {
  id: "T0ACME",
  name: "acme-robotics",
  botToken: "xoxb-bz6-acme-bot-token-that-must-not-leak",
  botUserId: "U0ACMEBOT",
  channels: [
    { id: "C0LOOPS", name: "ouroboros-loops", members: 24 },
    { id: "C0ALERTS", name: "helios-alerts", members: 9 },
    { id: "C0LEADS", name: "eng-leads", members: 5 },
    { id: "C0ELSEWHERE", name: "random", isMember: false },
  ],
  users: [
    { id: "U0KEN", name: "Ken Suenobu", email: "ken@acme-robotics.dev" },
    { id: "U0MAYA", name: "Maya Chen", email: "maya@acme-robotics.dev" },
    { id: "U0SAM", name: "Sam Ortiz", email: "sam@acme-robotics.dev" },
  ],
};

/** A second, unrelated Slack workspace — the other side of every isolation case. */
export const GLOBEX: HarnessTeam = {
  id: "T0GLOBEX",
  name: "globex",
  botToken: "xoxb-bz6-globex-bot-token-that-must-not-leak",
  botUserId: "U0GLOBEXBOT",
  channels: [
    { id: "C1LOOPS", name: "ouroboros-loops", members: 7 },
    { id: "C1ALERTS", name: "alerts", members: 4 },
  ],
  users: [{ id: "U1HANK", name: "Hank Scorpio", email: "hank@globex.example" }],
};

/** The application, Slack, and the clock between them. */
export class ChatBench {
  /**
   * @param api - The application under test.
   * @param slack - Slack.
   */
  private constructor(
    readonly api: ApiHarness,
    readonly slack: SlackHarness,
  ) {}

  /**
   * Start Slack and the application wired to it, with the publisher's timers cleared.
   *
   * @param overrides - Environment variables to add or change.
   * @param providers - Further providers to replace, beside the Slack client.
   * @returns The bench.
   */
  static async start(
    overrides: NodeJS.ProcessEnv = {},
    providers: readonly ProviderOverride[] = [],
  ): Promise<ChatBench> {
    const slack = await SlackHarness.start();

    slack.team(ACME);
    slack.team(GLOBEX);

    const api = await ApiHarness.start(
      {
        ...slack.env,
        OURO_RUN_SIMULATOR_SECRET: BENCH_SIMULATOR_SECRET,
        OURO_RUN_CONTROL_SWEEP_SECONDS: "3600",
        OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400",
        ...overrides,
      },
      [slack.provider, ...providers],
    );

    slack.attach(api.baseUrl);

    // The suite is the clock: a pass that fired on its own would send what a test is about to
    // assert has not been sent.
    const timers = api.nest.get(SchedulerRegistry);

    for (const name of [CHAT_DISPATCH_TIMEOUT, CHAT_UPKEEP_TIMEOUT]) {
      if (timers.doesExist("timeout", name)) {
        timers.deleteTimeout(name);
      }
    }

    return new ChatBench(api, slack);
  }

  /** Empty the database and Slack's memory, between tests. */
  async reset(): Promise<void> {
    // Detached work from the test that just ended must not write into the next one's tables.
    await this.idle();
    await this.api.truncate();
    this.slack.reset();
  }

  /** Wait for the work Slack's requests were acknowledged ahead of — replies, results. */
  async idle(): Promise<void> {
    await this.api.nest.get(SlackInboundService).idle();
  }

  /** Stop both, and hold that nothing reached outside the harness. */
  async close(): Promise<void> {
    await this.api.close();
    await this.slack.close();
    this.slack.assertNoEscapes();
  }

  /**
   * One dispatch pass at an instant — exactly what the `chat-dispatch` timer runs: the escalation
   * pass, then the outbox.
   *
   * @param now - The instant. Now, by default.
   * @returns What each half did.
   */
  async tick(
    now: Date = new Date(),
  ): Promise<{ escalation: EscalationReport; dispatch: ChatDispatchReport }> {
    const escalation = await this.api.nest.get(ChatEscalation).pass(now);
    const dispatch = await this.api.nest.get(ChatDispatcher).tick(now);

    return { escalation, dispatch };
  }

  /**
   * One upkeep pass's digest half at an instant — what the `chat-upkeep` timer runs.
   *
   * @param now - The instant.
   */
  async digestPass(now: Date): Promise<void> {
    await this.api.nest.get(ChatPublisher).digestPass(now);
  }

  /**
   * A signed-in owner with a workspace of their own.
   *
   * @param name - The owner's display name.
   * @returns Both.
   */
  async owned(name = "Ken Suenobu"): Promise<{ owner: Person; workspace: Workspace }> {
    const owner = await this.api.signIn({ displayName: name });
    const workspace = await this.api.workspace(owner);

    return { owner, workspace };
  }

  /**
   * A member of a workspace, signed in.
   *
   * @param workspace - The workspace.
   * @param role - Their role.
   * @param name - Their display name.
   * @returns The person.
   */
  async member(
    workspace: Pick<Workspace, "id">,
    role: "admin" | "member" | "viewer",
    name: string,
  ): Promise<Person> {
    const person = await this.api.signIn({ displayName: name });

    await this.api.join(workspace.id, person, role);

    return person;
  }

  /**
   * Install the Slack app into a workspace, through the OAuth round trip.
   *
   * @param owner - An owner or admin of the workspace.
   * @param workspace - The workspace.
   * @param team - The Slack workspace being installed.
   * @returns Where the callback sent the browser — `…/settings?slack=connected#integrations`.
   */
  async install(
    owner: Person,
    workspace: Pick<Workspace, "slug">,
    team: HarnessTeam,
  ): Promise<string> {
    const begun = await this.api
      .as(owner)("get", "/api/v1/slack/oauth/install")
      .set(TENANT_HEADER, workspace.slug)
      .redirects(0)
      .expect(302);
    const state = new URL(String(begun.headers.location)).searchParams.get("state") ?? "";
    const cookie = setCookie(begun, OAUTH_STATE_COOKIE).split(";")[0] ?? "";
    const code = this.slack.oauthCode(team.id);
    const finished = await this.api
      .anonymous(
        "get",
        `/api/v1/slack/oauth/callback?code=${code}&state=${encodeURIComponent(state)}`,
      )
      .set("Cookie", `${this.api.jarFor(owner)}; ${cookie}`)
      .set(TENANT_HEADER, workspace.slug)
      .redirects(0)
      .expect(302);

    return String(finished.headers.location);
  }

  /**
   * Bind one of the connected workspace's channels for a purpose, through its route.
   *
   * @param owner - An owner or admin.
   * @param workspace - The workspace.
   * @param platformChannelId - Slack's id for the channel.
   * @param purpose - What it is for.
   * @returns The channel, as the service now lists it.
   */
  async bind(
    owner: Person,
    workspace: Pick<Workspace, "slug">,
    platformChannelId: string,
    purpose: SlackChannelPurpose,
  ): Promise<SlackChannelResource> {
    const listed = bodyOf<SlackChannelsResource>(
      await this.api
        .as(owner)("post", "/api/v1/slack/channels/refresh")
        .set(TENANT_HEADER, workspace.slug)
        .expect(200),
    );
    const channel = listed.channels.find((one) => one.platformChannelId === platformChannelId);

    if (channel === undefined) {
      throw new Error(`Slack lists no channel ${platformChannelId} for this workspace.`);
    }

    const bound = bodyOf<SlackChannelsResource>(
      await this.api
        .as(owner)("put", `/api/v1/slack/channels/${channel.id}/binding`)
        .set(TENANT_HEADER, workspace.slug)
        .send({ purpose })
        .expect(200),
    );

    return bound.channels.find((one) => one.id === channel.id) ?? channel;
  }

  /**
   * Ask for a link as a Slack user: type `/ouro link` and read the reply.
   *
   * @param team - The Slack workspace.
   * @param slackUserId - Who types it.
   * @returns The reply, and the path of the link it offers (undefined when it offers none).
   */
  async linkOffer(
    team: HarnessTeam,
    slackUserId: string,
  ): Promise<{ reply: RecordedReply; path: string | undefined }> {
    const emitted = await this.slack.emitCommand({
      team: team.id,
      user: slackUserId,
      text: "link",
    });
    const reply = await this.slack.reply(emitted.responseUrl);
    const url = this.slack.buttonsOf({ blocks: reply.body.blocks as unknown[], attachments: [] })[0]
      ?.url;

    return { reply, path: url === undefined ? undefined : new URL(url).pathname };
  }

  /**
   * Link a Slack identity to a person: `/ouro link`, then the confirmation page, as them.
   *
   * @param team - The Slack workspace.
   * @param slackUserId - The Slack user.
   * @param person - The Ouroboros account that confirms.
   */
  async link(team: HarnessTeam, slackUserId: string, person: Person): Promise<void> {
    const { path } = await this.linkOffer(team, slackUserId);

    if (path === undefined) {
      throw new Error(`/ouro link offered ${slackUserId} no link.`);
    }

    await this.api.as(person)("post", path).expect(200);
  }

  /**
   * Type `/ouro <text>` as a Slack user and read what they were told, once the work is done.
   *
   * @param team - The Slack workspace it is typed in.
   * @param slackUserId - Who types it.
   * @param text - The text after `/ouro`.
   * @returns The first ephemeral reply's text.
   */
  async typed(team: HarnessTeam, slackUserId: string, text: string): Promise<string> {
    const emitted = await this.slack.emitCommand({ team: team.id, user: slackUserId, text });
    const reply = await this.slack.reply(emitted.responseUrl);

    await this.idle();

    return String(reply.body.text);
  }

  /**
   * Press a button as a Slack user and read what they were told, once the work is done.
   *
   * @param press - Who pressed what, on which message.
   * @returns The acknowledgement, the ephemeral reply and its text.
   */
  async press(
    press: EmittedPress,
  ): Promise<{ emitted: Emitted; reply: RecordedReply; text: string }> {
    const emitted = await this.slack.emitPress(press);
    const reply = await this.slack.reply(emitted.responseUrl);

    await this.idle();

    return { emitted, reply, text: String(reply.body.text) };
  }

  /**
   * An instant no earlier than any row the test has written — a pass at it claims them all.
   *
   * The database stamps a row with its own clock, which may run a moment ahead of this process's.
   *
   * @returns Two seconds from now.
   */
  soon(): Date {
    return new Date(Date.now() + 2000);
  }

  /**
   * A workspace with Slack installed and its loops channel bound.
   *
   * @param team - The Slack workspace. {@link ACME} by default.
   * @returns The owner, the workspace and the bound loops channel.
   */
  async connected(
    team: HarnessTeam = ACME,
  ): Promise<{ owner: Person; workspace: Workspace; loops: SlackChannelResource }> {
    const { owner, workspace } = await this.owned();

    await this.install(owner, workspace, team);

    const first = team.channels[0];

    if (first === undefined) {
      throw new Error(`Team ${team.id} declares no channel to bind.`);
    }

    return { owner, workspace, loops: await this.bind(owner, workspace, first.id, "loops") };
  }

  /**
   * Rows of a table of the application's schema, read on the suite's own connection.
   *
   * @param table - The table.
   * @param where - A `where` clause, with `$n` placeholders.
   * @param values - Their values.
   * @returns The rows.
   */
  async rows<T extends Record<string, unknown>>(
    table: string,
    where = "true",
    values: readonly unknown[] = [],
  ): Promise<T[]> {
    return (
      await this.api.sql.query<T>(`select * from ${SCHEMA_NAME}.${table} where ${where}`, [
        ...values,
      ])
    ).rows;
  }
}
