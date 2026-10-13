import type { ChatOnCall, SlackChannel, SlackChannels, SlackConnection } from "@/app/api/chatops";
import type {
  ChatMirror,
  ChatMirrorEntry,
  MirrorCard,
  MirrorCommand,
  MirrorLine,
} from "@/app/api/chatops-mirror";
import type { ConsoleGrammar } from "@/app/api/console";
import type {
  NotificationRoute,
  NotificationRouteChat,
  NotificationRoutes,
} from "@/app/api/settings-integrations";
import type { ChatOpsPage } from "@/app/chatops/view";

import { grammar } from "./console";

/**
 * Fixtures for the Chat Ops page (#541): a connection in each of its five states, the seeded
 * workspace's channels, and the poll answer a screen suite hands its loop.
 */

/** The instant every fixture is aged against — the page's `readAt`. */
export const CHATOPS_READ_AT = "2026-10-12T14:00:00.000Z";

/** Where the install starts, as the service names it. */
export const INSTALL_PATH = "/api/v1/slack/oauth/install";

/** The sentence the service refuses a bind with when the bot is not in the channel. */
export const NOT_JOINED_MESSAGE =
  "Ouroboros is not a member of #helios-private. Invite it with /invite @Ouroboros, then try again.";

/**
 * A connection — connected and healthy unless told otherwise.
 *
 * @param over What differs.
 * @returns The connection.
 */
export function connection(over: Partial<SlackConnection> = {}): SlackConnection {
  return {
    state: "connected",
    configured: true,
    installPath: INSTALL_PATH,
    connectionId: "5eed0541-0000-4000-8000-000000000001",
    workspace: { id: "T024AB", name: "acme-robotics" },
    appId: "A0541",
    appVersion: "v2.4",
    scopes: ["chat:write", "channels:read", "groups:read"],
    missingScopes: [],
    statusDetail: null,
    installedAt: "2026-10-01T09:00:00.000Z",
    lastVerifiedAt: "2026-10-12T13:58:00.000Z",
    channels: { total: 4, joined: 3 },
    socketMode: false,
    delivery: { state: "idle" } as SlackConnection["delivery"],
    ...over,
  };
}

/** A deployment that registered no Slack app. */
export function notConfigured(): SlackConnection {
  return connection({
    state: "not_configured",
    configured: false,
    installPath: null,
    connectionId: null,
    workspace: null,
    appId: null,
    appVersion: null,
    scopes: [],
    installedAt: null,
    lastVerifiedAt: null,
    channels: { total: 0, joined: 0 },
  });
}

/** An app this workspace has not installed. */
export function notConnected(): SlackConnection {
  return { ...notConfigured(), state: "not_connected", configured: true, installPath: INSTALL_PATH };
}

/** A connection Slack revoked, with its reason. */
export function revoked(): SlackConnection {
  return connection({ state: "revoked", statusDetail: "app_uninstalled" });
}

/**
 * One channel — public, joined and unbound unless told otherwise.
 *
 * @param name Its name, without the `#`.
 * @param over What differs.
 * @returns The channel.
 */
export function channel(name: string, over: Partial<SlackChannel> = {}): SlackChannel {
  return {
    id: `5eed0541-0000-4000-8000-${name.length.toString().padStart(4, "0")}${[...name]
      .reduce((sum, letter) => sum + letter.charCodeAt(0), 0)
      .toString()
      .padStart(8, "0")}`,
    platformChannelId: `C0${name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6)}`,
    name,
    isPrivate: false,
    joined: true,
    memberCount: 24,
    purpose: null,
    archived: false,
    url: `https://app.slack.com/client/T024AB/C0${name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6)}`,
    routes: [],
    ...over,
  };
}

/** The four channels a freshly connected workspace lists: nothing bound, one private and unjoined, one archived. */
export function unboundChannels(): SlackChannel[] {
  return [
    channel("ouroboros-loops"),
    channel("helios-alerts", { memberCount: 9 }),
    channel("helios-private", { isPrivate: true, joined: false, memberCount: null }),
    channel("old-builds", { archived: true }),
  ];
}

/** The same workspace once its loops and alerts channels are bound. */
export function boundChannelList(): SlackChannel[] {
  return [
    channel("ouroboros-loops", { purpose: "loops", routes: ["blocking_question", "loop_finished"] }),
    channel("helios-alerts", { purpose: "alerts", memberCount: 9, routes: ["build_failure"] }),
    channel("helios-private", { isPrivate: true, joined: false, memberCount: null }),
    channel("old-builds", { archived: true }),
  ];
}

/**
 * The channels payload.
 *
 * @param list The channels. Defaults to the unbound workspace's.
 * @param over What differs.
 * @returns The payload.
 */
export function channels(list: SlackChannel[] = unboundChannels(), over: Partial<SlackChannels> = {}): SlackChannels {
  return { connected: true, refreshedAt: "2026-10-12T13:55:00.000Z", channels: list, ...over };
}

/* ------------------------------------------------------------------ the routing card (#543) */

/**
 * One chat route — stored, on, unlocked and with no channel unless told otherwise.
 *
 * @param kind Its kind.
 * @param chat What it publishes and where; null makes it a route that is not a chat route.
 * @param over What differs on the route itself.
 * @returns The route.
 */
export function chatRoute(
  kind: string,
  chat: Partial<NotificationRouteChat> | null,
  over: Partial<NotificationRoute> = {},
): NotificationRoute {
  return {
    kind,
    channel: "slack",
    config: {} as NotificationRoute["config"],
    enabled: true,
    locked: false,
    lockedReason: null,
    delivering: true,
    stored: true,
    updatedAt: "2026-10-10T09:00:00.000Z",
    updatedBy: null,
    chat: chat === null ? null : { label: kind, note: null, channel: null, dmOnCall: false, ...chat },
    ...over,
  };
}

/**
 * A route's channel, as the route names it.
 *
 * @param name The bound channel's name.
 * @param over What differs.
 * @returns The channel, with the id {@link channel} gives the same name.
 */
export function routeChannel(name: string, over: Partial<NonNullable<NotificationRouteChat["channel"]>> = {}) {
  return { id: channel(name).id, name, joined: true, archived: false, ...over };
}

/**
 * The seeded workspace's routes: an email route that is no chat route, then mockup 19's five in
 * the service's order — the stage-transition one off, unstored and with no channel.
 *
 * @returns The routes payload.
 */
export function chatRoutes(): NotificationRoutes {
  return {
    items: [
      chatRoute("daily_digest", null, { channel: "email" }),
      chatRoute("custom:loop-finished", { label: "Loop finished (merged)", channel: routeChannel("ouroboros-loops") }),
      chatRoute("custom:blocking-questions", {
        label: "Blocking questions",
        channel: routeChannel("ouroboros-loops"),
        dmOnCall: true,
      }),
      chatRoute("custom:build-failures", { label: "Build failures", channel: routeChannel("helios-alerts") }),
      chatRoute("custom:weekly-insights", { label: "Weekly insights report" }, { enabled: false, delivering: false }),
      chatRoute(
        "custom:stage-transitions",
        { label: "Every stage transition", note: "noisy, off by default" },
        { enabled: false, delivering: false, stored: false, updatedAt: null },
      ),
    ],
    channels: [],
  };
}

/**
 * The on-call resource — Maya Chen designated and linked, two candidates — unless told otherwise.
 *
 * @param over What differs.
 * @returns The resource.
 */
export function onCall(over: Partial<ChatOnCall> = {}): ChatOnCall {
  return {
    scope: "decisions",
    designee: { memberId: "member-maya", name: "Maya Chen", linked: true },
    assignedAt: "2026-10-09T08:00:00.000Z",
    candidates: [
      { memberId: "member-ken", name: "Ken Suenobu" },
      { memberId: "member-maya", name: "Maya Chen" },
    ],
    ...over,
  };
}

/**
 * The page's payload.
 *
 * @param of The connection, and what is read beside it.
 * @returns The page.
 */
export function chatOpsPage(
  of: {
    connection?: SlackConnection;
    channels?: SlackChannels;
    grammar?: ConsoleGrammar;
    routes?: NotificationRoutes;
    onCall?: ChatOnCall;
  } = {},
): ChatOpsPage {
  const conn = of.connection ?? connection();

  return {
    connection: conn,
    channels: {
      ok: true,
      value: of.channels ?? (conn.state === "connected" ? channels() : channels([], { connected: false, refreshedAt: null })),
    },
    grammar: { ok: true, value: of.grammar ?? grammar() },
    routes: { ok: true, value: of.routes ?? chatRoutes() },
    onCall: { ok: true, value: of.onCall ?? onCall() },
  };
}

/**
 * A poll's answer carrying a page — the shape `createPoll` reads.
 *
 * @param payload The page.
 * @returns The answer.
 */
export function fresh(payload: ChatOpsPage) {
  return { state: "fresh" as const, payload, etag: null, pollAfterSeconds: 15 };
}

/** A promise a test settles by hand — never left hanging, which poisons later cases. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

/* ------------------------------------------------------------------ the channel mirror (#542) */

/** The day every mirror fixture is posted on, at noon UTC — one local day in any zone but the two at the date line. */
export const MIRROR_DAY = "2026-10-12";

/**
 * An instant on the fixtures' day.
 *
 * @param clock `HH:MM`, UTC.
 * @param day The day. Defaults to {@link MIRROR_DAY}.
 * @returns The instant, ISO 8601.
 */
export function at(clock: string, day: string = MIRROR_DAY): string {
  return `${day}T${clock}:00.000Z`;
}

/**
 * A card — a finished loop, unless told otherwise.
 *
 * @param over What differs.
 * @returns The card.
 */
export function mirrorCard(over: Partial<MirrorCard> = {}): MirrorCard {
  return {
    type: "card",
    id: "5eed0542-0000-4000-8000-000000000001",
    at: at("11:58"),
    family: "loop_finished",
    severity: "ok",
    mark: "✓",
    headline: "Loop #1846 finished — PR #512 merged",
    lines: ["#474 Debounce e-stop interrupt handler"],
    stats: "14/14 checks · 11m cycle · $0.94 · claude-fable-5",
    actions: [
      { id: "pr", label: "View PR ↗", href: "/prs/5eed0512", style: "default" },
      { id: "run", label: "Run console", href: "/runs/5eed1846", style: "default" },
    ],
    footnote: null,
    state: null,
    resolution: null,
    escalatedAt: null,
    ...over,
  };
}

/** A blocking question, still open: its answers lead to the inbox item. */
export function openQuestion(over: Partial<MirrorCard> = {}): MirrorCard {
  return mirrorCard({
    id: "5eed0542-0000-4000-8000-000000000002",
    at: at("12:07"),
    family: "protected_path",
    severity: "warn",
    mark: "⏸",
    headline: "Build paused — a question for you",
    lines: ["Loop #1851 (#479 OTA rollback): wants to add one line to boot/rollback_flag.c — a protected path. Allow?"],
    stats: null,
    actions: [
      { id: "allow_once", label: "Allow once", href: "/inbox?item=5eed0460", style: "primary" },
      { id: "deny", label: "Deny", href: "/inbox?item=5eed0460", style: "danger" },
      { id: "diff", label: "View diff →", href: "/prs/5eed0514/verification", style: "default" },
    ],
    footnote: "paused 4m · escalates to the Needs-you inbox in 26m",
    state: "open",
    ...over,
  });
}

/** The same question once somebody answered it: no actions, and who answered. */
export function resolvedQuestion(over: Partial<MirrorCard> = {}): MirrorCard {
  return openQuestion({
    actions: [],
    footnote: null,
    state: "resolved",
    resolution: { outcome: "allow once", actor: "Maya Chen", at: at("12:11") },
    ...over,
  });
}

/**
 * A system line.
 *
 * @param over What differs.
 * @returns The line.
 */
export function mirrorLine(over: Partial<MirrorLine> = {}): MirrorLine {
  return {
    type: "line",
    id: "5eed0542-0000-4000-8000-000000000003",
    at: at("12:11"),
    text: "✓ Maya Chen answered: allow once — loop #1851 resumed (14:11)",
    ...over,
  };
}

/**
 * A command — `/ouro status`, typed in Slack and answered at once — unless told otherwise.
 *
 * @param over What differs.
 * @returns The command.
 */
export function mirrorCommand(over: Partial<MirrorCommand> = {}): MirrorCommand {
  return {
    type: "command",
    id: "5eed0542-0000-4000-8000-000000000004",
    at: at("12:12"),
    surface: "slack",
    text: "/ouro status",
    author: { name: "Ken Suenobu" },
    outcome: "ok",
    reply: {
      text: "3 loops live · 12 queued · farm 4/5 online · spend today $18.60 · needs-you: 3",
      link: null,
      at: at("12:12"),
    },
    result: null,
    ...over,
  };
}

/** A dry run acknowledged and still running: a reply with a link, and no result yet. */
export function pendingDryRun(over: Partial<MirrorCommand> = {}): MirrorCommand {
  return mirrorCommand({
    id: "5eed0542-0000-4000-8000-000000000005",
    at: at("12:13"),
    text: "/ouro dry-run #486 feature-loop",
    outcome: "async_pending",
    reply: {
      text: "Dry run started — no writes, no PRs. Results in ~3 min → follow in Workflow Copilot",
      link: { label: "Open Copilot →", href: "/workflows/copilot?run=5eed0562" },
      at: at("12:13"),
    },
    ...over,
  });
}

/** A green build, publishing its PR. */
export function buildGreen(over: Partial<MirrorCard> = {}): MirrorCard {
  return mirrorCard({
    id: "5eed0542-0000-4000-8000-000000000006",
    at: at("12:31"),
    family: "build_green",
    severity: "accent",
    mark: "⟳",
    headline: "Loop #1847 build 3 green — 63/63 · publishing PR #514 rev 2",
    lines: [],
    stats: null,
    actions: [{ id: "verification", label: "PR verification →", href: "/prs/5eed0514/verification", style: "default" }],
    ...over,
  });
}

/** The seeded stream: a completion, a resolved question, its line, two commands and a green build. */
export function mirrorEntries(): ChatMirrorEntry[] {
  return [mirrorCard(), resolvedQuestion(), mirrorLine(), mirrorCommand(), pendingDryRun(), buildGreen()];
}

/**
 * One page of a channel's mirror — `#ouroboros-loops`, the seeded stream, the start of history.
 *
 * @param over What differs.
 * @returns The page.
 */
export function mirror(over: Partial<ChatMirror> = {}): ChatMirror {
  return {
    channel: channel("ouroboros-loops", { purpose: "loops", routes: ["blocking_question", "loop_finished"] }),
    platform: "slack",
    appVersion: "v2.4",
    entries: mirrorEntries(),
    olderCursor: null,
    ...over,
  };
}

/**
 * A poll's answer carrying a page of a mirror.
 *
 * @param payload The page.
 * @returns The answer.
 */
export function freshMirror(payload: ChatMirror = mirror()) {
  return { state: "fresh" as const, payload, etag: null, pollAfterSeconds: 15 };
}
