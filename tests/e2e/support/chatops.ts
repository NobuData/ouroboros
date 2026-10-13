/**
 * What the chatops leg knows about the Chat Ops page and the Slack plane behind it
 * ([#545](https://github.com/NobuData/ouroboros/issues/545), CA.5) — the page's own words, the
 * reads the leg checks the page against, the install it stands on, and the four breakages
 * `scripts/verify-chatops.sh` makes.
 *
 * The copy is restated here rather than imported from `ouroboros-ui/app/chatops/view.ts`: this
 * suite reads the product from outside, and a label that changed in both places at once would
 * be a rename nobody was asked about.
 */

import { type BrowserContext, type Page, expect } from "@playwright/test";

import { psql } from "./insights";
import { requestAs } from "./rest";
import { SEED_OWNER, SEED_TENANT } from "./seed";
import { SESSION_COOKIE, sessionTokenOf, signIn } from "./session";
import { type SlackStubTeam, SEEDED_SLACK_TEAM, oauthCode } from "./slack";
import { REST_URL } from "./stack";
import { selectWorkspace } from "./workspace";

/** Where the page lives. */
export const CHATOPS_PATH = "/chatops";

/** The page's words the leg reads — `app/chatops/view.ts`, restated. */
export const CHATOPS_COPY = {
  headline: "The loop reports where your team already lives.",
  health: "Slack connection",
  verify: "Verify now",
  reinstall: "Re-install",
  addChannel: "+ Add channel ▾",
  pickerTitle: "Add a channel",
  bind: "Bind",
  done: "Done",
  boundTitle: "Bound channels",
  stream: "Published and invoked",
  composer: "Run a command",
  commandsTitle: "COMMANDS",
  routingTitle: "WHAT GETS PUBLISHED WHERE",
  routingRoleNote: "Changing what gets published where is for an Owner or a Maintainer.",
  unlinkedLabel: "Your Slack identity",
  unlinkedTitle: "Your Slack identity is not linked.",
  linkCommand: "/ouro link",
  openSlack: "Open Slack ↗",
  deliveryLabel: "Slack delivery",
  deliveryRetry: "Retry now",
  deliveryAudit: "Open the audit log",
  deliveryRoleNote: "An Owner or a Maintainer can retry them.",
  historyLabel: "Channel history",
  historyNote:
    "Slack is disconnected, so this is the record as it stood. Nothing new is published, and nothing can be run from here, until the app is installed again.",
  revokedNote:
    "Slack no longer accepts this app's token, so nothing reaches your channels until the app is installed again.",
  invalidAuthReason: "Slack no longer recognises the app's token.",
  rejoined: "I invited it — refresh",
  escalated: "⚠ escalated",
} as const;

/** The seeded channels' ids in this workspace — `R__dev_seed_workspace_triage_slack.sql`. */
export const SEEDED_CHANNELS = {
  loops: {
    id: "5eed009c-0000-4000-8000-0000000000a1",
    slack: "C071LOOPS",
    name: "ouroboros-loops",
  },
  alerts: { id: "5eed009c-0000-4000-8000-0000000000a2", slack: "C072ALERT", name: "helios-alerts" },
  leads: { id: "5eed009c-0000-4000-8000-0000000000a3", slack: "C073LEADS", name: "eng-leads" },
} as const;

/** The seeded connection's row. */
export const SEEDED_CONNECTION_ID = "5eed009c-0000-4000-8000-000000000001";

/**
 * A channel the leg adds to the workspace for itself: the one it binds through the picker, moves
 * a route to, and has the bot removed from — so none of that is done to a channel the seed, and
 * every other leg's baseline, depends on.
 */
export const DRILLS = { slack: "C074DRILL", name: "e2e-drills" } as const;

/** The seeded workspace as Slack, with the leg's own channel in it. */
export const LEG_TEAM: SlackStubTeam = {
  ...SEEDED_SLACK_TEAM,
  channels: [...SEEDED_SLACK_TEAM.channels, { id: DRILLS.slack, name: DRILLS.name, members: 2 }],
};

/** The connection, as far as the leg reads it — `openapi.yaml` § `SlackConnection`. */
export interface Connection {
  readonly state: string;
  readonly statusDetail: string | null;
  readonly appVersion: string | null;
  readonly viewerLinked: boolean;
  readonly delivery: {
    readonly state: string;
    readonly pending: number;
    readonly retrying: number;
    readonly deadLettered: number;
    readonly stuck: number;
    readonly affectedRoutes: readonly string[];
    readonly lastError: string | null;
  };
}

/** One channel, as far as the leg reads it — `openapi.yaml` § `SlackChannel`. */
export interface Channel {
  readonly id: string;
  readonly platformChannelId: string;
  readonly name: string;
  readonly joined: boolean;
  readonly purpose: "loops" | "alerts" | "leads" | null;
}

/**
 * Where Slack stands for the caller's workspace.
 *
 * @param context - Whose session.
 * @returns The connection.
 */
export async function connectionOf(context: BrowserContext): Promise<Connection> {
  const connection = await requestAs<Connection>(
    context,
    "GET",
    "/api/v1/slack/connection",
    null,
    "GET /api/v1/slack/connection",
  );

  if (connection === null) throw new Error("GET /api/v1/slack/connection answered nothing");
  return connection;
}

/**
 * The workspace's channels, as last listed.
 *
 * @param context - Whose session.
 * @returns The channels.
 */
export async function channelsOf(context: BrowserContext): Promise<readonly Channel[]> {
  const listed = await requestAs<{ channels: readonly Channel[] }>(
    context,
    "GET",
    "/api/v1/slack/channels",
    null,
    "GET /api/v1/slack/channels",
  );

  return listed?.channels ?? [];
}

/**
 * One listed channel, by its Slack id.
 *
 * @param context - Whose session.
 * @param slackId - `C074DRILL`.
 * @returns The channel.
 * @throws {Error} When the workspace lists none by that id.
 */
export async function channelBySlackId(context: BrowserContext, slackId: string): Promise<Channel> {
  const channel = (await channelsOf(context)).find((one) => one.platformChannelId === slackId);

  if (channel === undefined) throw new Error(`the workspace lists no channel ${slackId}`);
  return channel;
}

/**
 * Install the Slack app into the session's workspace **without a browser** — the two requests a
 * browser makes around Slack's consent screen, with the stub's code in the screen's place.
 *
 * It is what every test of the chain leg stands on, so that one of them run alone
 * (`scripts/verify-chatops.sh`) is not refused for a connection another test would have made.
 * The page's own journey — the redirect, the consent screen's return, the landing in Settings —
 * is walked once, in the browser, by the leg's first test.
 *
 * @param context - An owner's or an admin's session.
 * @param team - The workspace to install.
 * @returns When the callback has answered *connected*.
 * @throws {Error} When either request answers anything else.
 */
export async function installSlack(
  context: BrowserContext,
  team: SlackStubTeam = LEG_TEAM,
): Promise<void> {
  const token = await sessionTokenOf(context, "installSlack");
  const session = `${SESSION_COOKIE}=${token}`;
  const install = await fetch(`${REST_URL}/api/v1/slack/oauth/install`, {
    headers: { cookie: session },
    redirect: "manual",
  });
  const authorize = install.headers.get("location");
  const state = install.headers.getSetCookie().map((cookie) => cookie.split(";")[0] ?? "");

  if (install.status !== 302 || authorize === null) {
    throw new Error(`the Slack install answered ${install.status}: ${await install.text()}`);
  }

  const callback = new URL(`${REST_URL}/api/v1/slack/oauth/callback`);
  callback.searchParams.set("code", await oauthCode(team.id));
  callback.searchParams.set("state", new URL(authorize).searchParams.get("state") ?? "");

  const landed = await fetch(callback, {
    headers: { cookie: [session, ...state].join("; ") },
    redirect: "manual",
  });
  const where = landed.headers.get("location") ?? "";

  if (!where.includes("slack=connected")) {
    throw new Error(`the Slack install's callback answered ${landed.status} → ${where}`);
  }
}

/**
 * Stand in for Slack's consent screen in a page: the install's redirect to `slack.com` is
 * answered with the redirect back that an approving admin's click produces.
 *
 * @param page - The page that will navigate to the install.
 * @param team - The workspace being installed.
 * @returns When the route is in place.
 */
export async function approveInstallIn(page: Page, team: SlackStubTeam = LEG_TEAM): Promise<void> {
  await page.route("https://slack.com/oauth/v2/authorize**", async (route) => {
    const asked = new URL(route.request().url());
    const back = new URL(asked.searchParams.get("redirect_uri") ?? "");

    back.searchParams.set("code", await oauthCode(team.id));
    back.searchParams.set("state", asked.searchParams.get("state") ?? "");

    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<script>location.replace(${JSON.stringify(back.toString())})</script>`,
    });
  });
}

/**
 * Open the Chat Ops page as somebody, and wait until it is the read page rather than its
 * skeleton — the route streams, and the skeleton carries the same head.
 *
 * @param context - The browser context to sign in.
 * @param page - The page.
 * @param options - Who (the owner by default), and which channel's mirror the address names.
 * @returns When the page's own content is drawn.
 */
export async function openChatOps(
  context: BrowserContext,
  page: Page,
  options: { readonly userId?: string; readonly channel?: string } = {},
): Promise<void> {
  await signIn(context, options.userId ?? SEED_OWNER.id);
  await selectWorkspace(context, SEED_TENANT.slug);
  await page.goto(
    options.channel === undefined ? CHATOPS_PATH : `${CHATOPS_PATH}?channel=${options.channel}`,
  );
  await drawnChatOps(page);
}

/**
 * Wait until the page is the read page: its `<main>` there exactly once, shown, and not the
 * skeleton.
 *
 * While the route streams in, React holds the arriving page in a hidden container beside the
 * skeleton it is about to replace, so for a moment `main.chatops` matches twice — and the
 * skeleton carries the same head. Asked in one look, as `copilot.spec.ts`'s `drawnCopilot` asks
 * of its seats.
 *
 * @param page - The page.
 * @returns When the page's own content is drawn.
 */
export async function drawnChatOps(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const found = document.querySelectorAll("main.chatops");

    return (
      found.length === 1 &&
      found[0].closest("[hidden]") === null &&
      !found[0].hasAttribute("aria-busy")
    );
  });
  await expect(page.locator("main.chatops")).toBeVisible();
}

/** The connection's columns an install rewrites — kept so the leg can put the seed's back. */
const CONNECTION_COLUMNS = [
  "workspace_name",
  "bot_token_sealed",
  "bot_user_id",
  "install_meta",
  "status",
  "status_detail",
  "installed_by",
  "installed_at",
  "last_verified_at",
] as const;

/**
 * Remember the seeded connection as it stands, and how to put it back.
 *
 * The chain leg re-installs the seeded workspace's Slack app so that the service holds a token
 * the stub honours. Every leg after it should find what the seed wrote — the strip's `app v2.4`
 * among it — so the row is copied aside first and written back afterwards, whole.
 *
 * @returns A function that restores the row.
 */
export async function holdSeededConnection(): Promise<() => Promise<void>> {
  const copy = "ouroboros.e2e_chatops_connection";

  await psql(
    `drop table if exists ${copy}; ` +
      `create table ${copy} as select id, ${CONNECTION_COLUMNS.join(", ")} ` +
      `from ouroboros.chat_connections where id = '${SEEDED_CONNECTION_ID}'`,
  );

  return async () => {
    await psql(
      `update ouroboros.chat_connections c set ` +
        CONNECTION_COLUMNS.map((column) => `${column} = held.${column}`).join(", ") +
        ` from ${copy} held where c.id = held.id; drop table ${copy}`,
    );
  };
}

/**
 * Deliver whatever the connection's outbox is still holding, and wait until it holds nothing.
 *
 * Before the leg re-installs it the seeded connection can deliver nothing, so by the time this
 * leg runs — late, after legs whose loops asked questions — its outbox may hold messages waiting
 * out a backoff, or given up on. With a token the stub honours they can all go: the dead letters
 * are queued again through the product's own retry, the waiting ones are made due now, and the
 * dispatcher's next ticks send them. What follows then starts from a quiet queue, which is what
 * lets it say *one* message was not delivered and mean the one it refused.
 *
 * @param context - An owner's or an admin's session.
 * @returns When nothing is pending, retrying or dead-lettered.
 */
export async function drainDelivery(context: BrowserContext): Promise<void> {
  await requestAs(
    context,
    "POST",
    "/api/v1/slack/connection/delivery/retry",
    null,
    "retrying the connection's dead letters",
  );
  await psql(
    `update ouroboros.chat_outbox set next_attempt_at = now() ` +
      `where connection_id = '${SEEDED_CONNECTION_ID}' and status = 'pending'`,
  );

  await expect
    .poll(
      async () => {
        const { delivery } = await connectionOf(context);

        return delivery.pending + delivery.retrying + delivery.deadLettered;
      },
      {
        message: "the connection's outbox must drain once Slack (the stub) takes its messages",
        timeout: 45_000,
      },
    )
    .toBe(0);
}

/* ------------------------------------------------------------------ the breakages */

/** The variable `scripts/verify-chatops.sh` sets. */
export const CHATOPS_BREAK_VARIABLE = "OURO_E2E_CHATOPS_BREAK";

/**
 * The layers the chain can be broken at, each beneath the service at the moment the test has
 * arranged its state:
 *
 * - `publishing` — Slack refuses every post, so no card reaches a channel;
 * - `interactivity` — the button press arrives signed with another secret, so the handler
 *   refuses it and nothing is answered;
 * - `dispatcher` — the connection is marked failing in the database while the commands run, so
 *   the dispatcher answers Slack what it does not answer the console;
 * - `timer` — the short escalation window is withdrawn before the decision is filed, so its
 *   timer starts with the kind's own thirty minutes and does not fire.
 */
export const CHATOPS_BREAKS = ["publishing", "interactivity", "dispatcher", "timer"] as const;

/** One of {@link CHATOPS_BREAKS}. */
export type ChatOpsBreak = (typeof CHATOPS_BREAKS)[number];

/**
 * Whether a breakage was asked for.
 *
 * @param name - The breakage a test knows how to make.
 * @returns `true` when {@link CHATOPS_BREAK_VARIABLE} names it.
 * @throws {Error} When the variable names no known breakage — a typo must not read as a clean run.
 */
export function brokenChatOps(name: ChatOpsBreak): boolean {
  const asked = process.env[CHATOPS_BREAK_VARIABLE];
  if (asked === undefined || asked === "") return false;

  if (!CHATOPS_BREAKS.includes(asked as ChatOpsBreak)) {
    throw new Error(
      `${CHATOPS_BREAK_VARIABLE}=${asked} names no known breakage; expected one of: ` +
        CHATOPS_BREAKS.join(", "),
    );
  }

  return asked === name;
}
