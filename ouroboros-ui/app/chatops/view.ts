import type { ChannelPurpose, SlackChannel, SlackChannels, SlackConnection } from "@/app/api/chatops";
import type {
  ChatMirror,
  ChatMirrorEntry,
  MirrorAction,
  MirrorCommand,
  MirrorResolution,
  MirrorSeverity,
} from "@/app/api/chatops-mirror";
import type { Reading } from "@/app/api/reading";
import { ageOfSeconds, relativeAgo } from "@/app/format";
import { settingsSectionPath } from "@/app/paths";
import { CONSOLE_PREFIX } from "@/app/shell/console";

/**
 * What the Chat Ops page says and decides (CA.1,
 * [#541](https://github.com/NobuData/ouroboros/issues/541)) — mockup 19's head, the connection
 * health strip, the install journey and the channel bindings, as data. Framework-free, so the
 * copy and every *which state shows what* rule is testable alone.
 *
 * The page has one subject — the workspace's Slack connection — and five things it can be
 * (`SlackConnection.state`): no app registered on the deployment, an app nobody installed here,
 * connected, revoked, or failing. Each function below answers one question about that state, and
 * the components only draw the answers.
 */

/* ------------------------------------------------------------------ what the page reads */

/** What the page is drawn from: the connection, and the channels beside it. */
export interface ChatOpsPage {
  /** Where Slack stands for the workspace. */
  readonly connection: SlackConnection;
  /** The workspace's channels — a reading of their own, so a failed list costs only the lists. */
  readonly channels: Reading<SlackChannels>;
}

/** Where this origin serves the page's poll. */
export const CHATOPS_ENDPOINT = "/api/chatops";

/**
 * How often the page is re-read, in seconds — the product's own cadence, so a connection Slack
 * revoked shows on the strip without a reload.
 */
export const CHATOPS_POLL_SECONDS = 15;

/** What is said when the connection could not be reached. */
export const UNREACHABLE_CHATOPS = "The Slack connection could not be reached.";

/** What is said when the connection answered something that could not be read. */
export const UNREADABLE_CHATOPS = "The Slack connection could not be read.";

/** The retry banner's headline when a re-read failed and the page shows what it last read. */
export const STALE_HEADLINE = "The Slack connection could not be re-read.";

/** The headline where the first read failed, so there is nothing to show yet. */
export const UNREAD_HEADLINE = "The Slack connection could not be read.";

/** What stands in for the channel lists when only they could not be read. */
export const CHANNELS_UNREAD = "The Slack channels could not be read.";

/** What the `<main>` is labelled while the page's reads are in flight. */
export const LOADING_LABEL = "Loading Chat Ops";

/**
 * Whether a value is the page's payload — enough of its shape to draw from.
 *
 * @param value What the route answered.
 * @returns Whether the connection and the channels' reading are both present.
 */
export function isChatOpsPage(value: unknown): value is ChatOpsPage {
  if (typeof value !== "object" || value === null) return false;

  const { connection, channels } = value as {
    connection?: { state?: unknown } | null;
    channels?: { ok?: unknown } | null;
  };

  return typeof connection?.state === "string" && typeof channels?.ok === "boolean";
}

/* ------------------------------------------------------------------ the head */

/** The eyebrow over the headline. */
export const CHATOPS_EYEBROW = "Chat Ops";

/** The page's thesis. Verbatim from mockup 19. */
export const CHATOPS_HEADLINE = "The loop reports where your team already lives.";

/** The subline. Verbatim from mockup 19. */
export const CHATOPS_SUBLINE =
  "Finished loops announce themselves. Blocked builds ask their question in-channel and wait. " +
  "Every control in this app is also a command — or a sentence.";

/** The ghost action's label. The caret is the mockup's: it opens the channel picker. */
export const ADD_CHANNEL_LABEL = "+ Add channel ▾";

/**
 * Why a reader who is not an owner or an admin cannot bind a channel — the reason every inert
 * binding control carries. The roles are named as the Members card shows them.
 */
export const BIND_ROLE_REASON = "Binding a channel is for an Owner or a Maintainer.";

/**
 * Whether **+ Add channel ▾** is offered: only while Slack is connected. A revoked or failing
 * connection lists nothing worth binding, and before an install there is nothing to list.
 *
 * @param connection The connection.
 * @returns Whether the action is drawn.
 */
export function offersAddChannel(connection: Pick<SlackConnection, "state">): boolean {
  return connection.state === "connected";
}

/** What **Open #channel ↗** draws from. */
export interface OpenChannelLink {
  /** `Open #ouroboros-loops ↗`. */
  readonly label: string;
  /** The Slack deep link, as the service built it. */
  readonly href: string;
}

/**
 * The head's link to the channel bound for loops — the real conversation, in Slack.
 *
 * **Absent rather than dead.** With no connection, no channel bound for `loops`, or no link for
 * it, there is nothing honest to open, so the answer is null and the head draws no action.
 *
 * @param page The connection and the channels.
 * @returns The link, or null.
 */
export function openChannelLink(page: ChatOpsPage): OpenChannelLink | null {
  if (page.connection.state !== "connected" || !page.channels.ok) return null;

  const loops = page.channels.value.channels.find(
    (channel) => channel.purpose === "loops" && !channel.archived && channel.url !== "",
  );

  return loops === undefined ? null : { label: `Open #${loops.name} ↗`, href: loops.url };
}

/* ------------------------------------------------------------------ the health strip */

/** The strip's accessible name. */
export const HEALTH_LABEL = "Slack connection";

/** The status word for each state that has a connection behind it. */
export const STATUS_WORDS = { connected: "active", revoked: "revoked", error: "error" } as const;

/** A state the strip is drawn for. */
export type HealthState = keyof typeof STATUS_WORDS;

/** What the strip says when every asked-for scope was granted. */
export const SCOPES_OK = "scopes ✓";

/** What the strip says of a connection whose token was never checked. */
export const NEVER_VERIFIED = "not verified yet";

/** The strip's two controls. */
export const VERIFY_LABEL = "Verify now";
export const VERIFYING_LABEL = "Verifying…";
export const REINSTALL_LABEL = "Re-install";

/** What is said when a verification could not be made at all. */
export const VERIFY_FAILED = "The connection could not be verified. Try again.";

/** What each broken state means, said under the strip. */
export const REVOKED_NOTE =
  "Slack no longer accepts this app's token, so nothing reaches your channels until the app is installed again.";
export const ERROR_NOTE = "The connection is failing, so messages may not reach your channels.";

/** Who can repair a broken connection, for a reader who cannot. */
export const REINSTALL_ROLE_NOTE = "An Owner or a Maintainer can re-install the app.";

/** What is said where the deployment's app went away under an existing install. */
export const REINSTALL_UNAVAILABLE =
  "This deployment no longer has a Slack app registered, so there is nothing to re-install yet.";

/**
 * Whether the strip is drawn: whenever a connection exists — working, revoked or failing.
 *
 * @param connection The connection.
 * @returns Whether its state is one the strip reports.
 */
export function showsHealth(connection: Pick<SlackConnection, "state">): boolean {
  return connection.state in STATUS_WORDS;
}

/**
 * The scopes segment.
 *
 * @param missing The scopes the app asks for that Slack did not grant.
 * @returns `scopes ✓`, or `2 scopes missing: chat:write, groups:read` — the names are there to be
 *   read, because *which* scope is what an operator needs to fix it.
 */
export function scopesText(missing: readonly string[]): string {
  if (missing.length === 0) return SCOPES_OK;

  const noun = missing.length === 1 ? "scope" : "scopes";

  return `${String(missing.length)} ${noun} missing: ${missing.join(", ")}`;
}

/**
 * The status segment: the word, and the platform's reason when it gave one.
 *
 * @param connection The connection's state and Slack's reason.
 * @returns `active`, `revoked — app_uninstalled`, `error — ratelimited`.
 */
export function statusText(connection: Pick<SlackConnection, "state" | "statusDetail">): string {
  const word = (STATUS_WORDS as Readonly<Record<string, string | undefined>>)[connection.state] ?? connection.state;
  const reason = connection.statusDetail;

  return reason === null || reason === "" ? word : `${word} — ${reason}`;
}

/**
 * The app segment — the manifest version the app was installed at.
 *
 * @param appVersion The version as the service holds it — `v1.0`, or `2.4`.
 * @returns `app v1.0`, or null when the version is not known.
 */
export function appText(appVersion: string | null): string | null {
  if (appVersion === null || appVersion.trim() === "") return null;

  return `app v${appVersion.trim().replace(/^v/i, "")}`;
}

/**
 * The verification segment.
 *
 * @param lastVerifiedAt When the token was last seen to work.
 * @param now The instant the page was read.
 * @returns `verified 2m ago`, or `not verified yet`.
 */
export function verifiedText(lastVerifiedAt: string | null, now: Date): string {
  return lastVerifiedAt === null ? NEVER_VERIFIED : `verified ${relativeAgo(lastVerifiedAt, now)}`;
}

/** One segment of the strip. */
export interface HealthFact {
  /** A stable key. */
  readonly key: "workspace" | "app" | "scopes" | "status" | "verified";
  /** What it says. */
  readonly text: string;
  /** Whether it reports something wrong — drawn in a hue as well as said in words. */
  readonly tone: "plain" | "ok" | "warn" | "err";
}

/** The hue each status takes — beside the word, never instead of it. */
const STATUS_TONE: Readonly<Record<HealthState, HealthFact["tone"]>> = {
  connected: "ok",
  revoked: "err",
  error: "err",
};

/**
 * The strip's segments, in order: workspace · app · scopes · status · verified.
 *
 * @param connection The connection.
 * @param now The instant the page was read.
 * @returns The segments. The workspace and the app are left out when the service does not know
 *   them; the other three are always said.
 */
export function healthFacts(connection: SlackConnection, now: Date): readonly HealthFact[] {
  const facts: HealthFact[] = [];
  const app = appText(connection.appVersion);

  if (connection.workspace !== null) facts.push({ key: "workspace", text: connection.workspace.name, tone: "plain" });
  if (app !== null) facts.push({ key: "app", text: app, tone: "plain" });

  facts.push({
    key: "scopes",
    text: scopesText(connection.missingScopes),
    tone: connection.missingScopes.length === 0 ? "plain" : "warn",
  });
  facts.push({
    key: "status",
    text: statusText(connection),
    tone: (STATUS_TONE as Readonly<Record<string, HealthFact["tone"] | undefined>>)[connection.state] ?? "plain",
  });
  facts.push({ key: "verified", text: verifiedText(connection.lastVerifiedAt, now), tone: "plain" });

  return facts;
}

/** What separates two segments. */
export const FACT_SEPARATOR = "·";

/**
 * The strip as one line, for a test or a reader's clipboard.
 *
 * @param connection The connection.
 * @param now The instant the page was read.
 * @returns `acme-robotics · app v2.4 · scopes ✓ · active · verified 2m ago`.
 */
export function healthLine(connection: SlackConnection, now: Date): string {
  return healthFacts(connection, now)
    .map((fact) => fact.text)
    .join(` ${FACT_SEPARATOR} `);
}

/**
 * What the strip says under its segments when the connection is broken.
 *
 * @param connection The connection's state.
 * @returns The sentence, or null for a working connection.
 */
export function brokenNote(connection: Pick<SlackConnection, "state">): string | null {
  if (connection.state === "revoked") return REVOKED_NOTE;
  if (connection.state === "error") return ERROR_NOTE;

  return null;
}

/** What a broken connection offers the reader. */
export type Repair =
  /** A link that starts the install again. */
  | { readonly kind: "reinstall"; readonly href: string }
  /** A sentence: who can, or why nobody can yet. */
  | { readonly kind: "note"; readonly text: string };

/**
 * How a revoked or failing connection is repaired, for this reader.
 *
 * @param connection The connection's state and where its install starts.
 * @param mayAdminister Whether the reader is an owner or an admin.
 * @returns **Re-install** for an owner or an admin, who can fix it for everyone else, or null
 *   for a working connection.
 */
export function repairFor(
  connection: Pick<SlackConnection, "state" | "installPath">,
  mayAdminister: boolean,
): Repair | null {
  if (connection.state !== "revoked" && connection.state !== "error") return null;
  if (!mayAdminister) return { kind: "note", text: REINSTALL_ROLE_NOTE };
  if (connection.installPath === null) return { kind: "note", text: REINSTALL_UNAVAILABLE };

  return { kind: "reinstall", href: connection.installPath };
}

/**
 * What a verification that answered says, where its result is not simply *verified* — the strip
 * itself shows the rest.
 *
 * @param result The verification's result.
 * @returns A sentence when Slack could not be asked, or null.
 */
export function verificationNote(result: string): string | null {
  return result === "unreachable" ? "Slack could not be reached, so the connection was not re-checked." : null;
}

/* ------------------------------------------------------------------ the install journey */

/** The setup guide — `docs/CHATOPS_SETUP.md`, where the manifest and the credentials are. */
export const SETUP_GUIDE_HREF = "https://github.com/NobuData/ouroboros/blob/main/docs/CHATOPS_SETUP.md";

/** The guide link's label. */
export const SETUP_GUIDE_LABEL = "Read the setup guide ↗";

/** Why there is an app to register at all — said in both no-connection states. */
export const REGISTRATION_NOTE =
  "Ouroboros does not ship a shared Slack app. Each deployment registers its own app in its own " +
  "Slack workspace, so your Slack only ever talks to your deployment.";

/** The journey on a deployment with no Slack app. */
export const NOT_CONFIGURED_TITLE = "This deployment has no Slack app yet";

/** What registering one involves, in order. */
export const SETUP_STEPS: readonly string[] = [
  "Create the app in your Slack workspace from the manifest in the setup guide.",
  "Give this deployment the app's credentials: OURO_SLACK_CLIENT_ID, OURO_SLACK_CLIENT_SECRET and OURO_SLACK_SIGNING_SECRET.",
  "Restart the deployment so it picks them up.",
  "Come back to this page and install the app into your Slack workspace.",
];

/** The steps' accessible name. */
export const SETUP_STEPS_LABEL = "Registering a Slack app";

/** What is missing on a deployment with no app, and who supplies it. */
export const NOT_CONFIGURED_MISSING =
  "What is missing: this deployment has no Slack app credentials, so there is nothing to install yet.";
export const NOT_CONFIGURED_WHO =
  "Whoever operates this deployment registers the app. An Owner or a Maintainer then installs it from this page.";

/** The journey where the app is registered and this workspace has not installed it. */
export const NOT_CONNECTED_TITLE = "Install the Slack app into your workspace";
export const NOT_CONNECTED_LEAD =
  "This deployment's Slack app is registered. This workspace has not installed it yet.";
export const INSTALL_NOTE =
  "Installing takes you to Slack to approve the app, then brings you back here to bind your first channels.";
export const INSTALL_LABEL = "Install";

/** What is missing, and who can supply it, for a reader who cannot install. */
export const NOT_CONNECTED_MISSING = "What is missing: this workspace has not installed the Slack app.";
export const INSTALL_ROLE_NOTE = "An Owner or a Maintainer can install it.";

/** Which journey the page body is. */
export type Journey = "not_configured" | "not_connected";

/**
 * Which install journey the page shows, if any.
 *
 * @param connection The connection's state.
 * @returns The journey, or null once a connection exists.
 */
export function journeyFor(connection: Pick<SlackConnection, "state">): Journey | null {
  return connection.state === "not_configured" || connection.state === "not_connected" ? connection.state : null;
}

/**
 * Where **Install** leads, for this reader.
 *
 * @param connection The connection's state and where its install starts.
 * @param mayAdminister Whether the reader is an owner or an admin.
 * @returns The install's address — only where an app is registered, nothing is installed, and
 *   the reader may install it. Null otherwise: no Install action is drawn.
 */
export function installHref(
  connection: Pick<SlackConnection, "state" | "installPath">,
  mayAdminister: boolean,
): string | null {
  return connection.state === "not_connected" && mayAdminister ? connection.installPath : null;
}

/* ------------------------------------------------------------------ purposes */

/** The three purposes, in the order they are offered. */
export const PURPOSES: readonly ChannelPurpose[] = ["loops", "alerts", "leads"];

/** Each purpose's name. */
export const PURPOSE_LABELS: Readonly<Record<ChannelPurpose, string>> = {
  loops: "Loops",
  alerts: "Alerts",
  leads: "Leads",
};

/** The default routes each purpose switches on, in one line. */
export const PURPOSE_ROUTES: Readonly<Record<ChannelPurpose, string>> = {
  loops: "Blocking questions, with a DM to the on-call person · loop finished · stage transitions (off)",
  alerts: "Build failures",
  leads: "The weekly digest",
};

/**
 * A purpose's name, for a value this build may not know.
 *
 * @param purpose The purpose as served.
 * @returns `Loops`, or the value itself for one added after this build.
 */
export function purposeLabel(purpose: string): string {
  return (PURPOSE_LABELS as Readonly<Record<string, string | undefined>>)[purpose] ?? purpose;
}

/* ------------------------------------------------------------------ the post-install block */

/** The block a connected workspace with no bound channel sees. */
export const FIRST_CHANNELS_TITLE = "Bind your first channels";
export const FIRST_CHANNELS_LEAD =
  "Slack is connected. Choose the channel each kind of message goes to — binding a channel switches on that purpose's default routes.";

/** The reminder that the bot has to be in a channel before it can post there. */
export const INVITE_COMMAND = "/invite @Ouroboros";
export const INVITE_REMINDER_LEAD = "Ouroboros can only post where it is a member. In each channel, send";
export const INVITE_REMINDER_TAIL = "first.";

/**
 * The label of a purpose's button in the post-install block.
 *
 * @param purpose The purpose.
 * @returns `Choose a Loops channel`.
 */
export function chooseChannelLabel(purpose: ChannelPurpose): string {
  return `Choose ${purpose === "alerts" ? "an" : "a"} ${PURPOSE_LABELS[purpose]} channel`;
}

/* ------------------------------------------------------------------ channels */

/**
 * The channels that can be offered: every one Slack has not archived, bound ones first and then
 * by name.
 *
 * @param channels The channels as served.
 * @returns The picker's rows.
 */
export function offeredChannels(channels: readonly SlackChannel[]): readonly SlackChannel[] {
  return [...channels]
    .filter((channel) => !channel.archived)
    .sort(
      (a, b) => Number(b.purpose !== null) - Number(a.purpose !== null) || a.name.localeCompare(b.name),
    );
}

/**
 * The channels that have a purpose, in the purposes' order and then by name.
 *
 * @param channels The channels as served.
 * @returns The page's bound list.
 */
export function boundChannels(channels: readonly SlackChannel[]): readonly SlackChannel[] {
  return [...channels]
    .filter((channel) => channel.purpose !== null)
    .sort(
      (a, b) =>
        PURPOSES.indexOf(a.purpose as ChannelPurpose) - PURPOSES.indexOf(b.purpose as ChannelPurpose) ||
        a.name.localeCompare(b.name),
    );
}

/**
 * Which body a connected page draws under the strip.
 *
 * @param page The connection and the channels.
 * @returns `first` — the post-install block — while no channel has a purpose; `bound` once one
 *   does; `unread` when the channels could not be read; null when Slack is not connected.
 */
export function channelsBody(page: ChatOpsPage): "first" | "bound" | "unread" | null {
  if (page.connection.state !== "connected") return null;
  if (!page.channels.ok) return "unread";

  return boundChannels(page.channels.value.channels).length === 0 ? "first" : "bound";
}

/**
 * A channel's name as Slack writes it.
 *
 * @param channel The channel.
 * @returns `#ouroboros-loops`.
 */
export function channelName(channel: Pick<SlackChannel, "name">): string {
  return `#${channel.name}`;
}

/** The mark a private channel wears. */
export const PRIVATE_MARK = "private";

/**
 * How many people are in a channel.
 *
 * @param memberCount The count, or null when Slack did not say.
 * @returns `24 members`, `1 member`, or null.
 */
export function membersText(memberCount: number | null): string | null {
  if (memberCount === null) return null;

  return `${String(memberCount)} ${memberCount === 1 ? "member" : "members"}`;
}

/** Whether the bot is in a channel, in words. */
export const BOT_IN = "bot is a member";
export const BOT_OUT = "bot is not in this channel";

/**
 * Whether the bot is in a channel, in words.
 *
 * @param channel The channel.
 * @returns One of the two phrases.
 */
export function botText(channel: Pick<SlackChannel, "joined">): string {
  return channel.joined ? BOT_IN : BOT_OUT;
}

/**
 * What a channel is already bound for, in the picker.
 *
 * @param channel The channel.
 * @returns `bound for Loops`, or null for an unbound one.
 */
export function boundText(channel: Pick<SlackChannel, "purpose">): string | null {
  return channel.purpose === null ? null : `bound for ${purposeLabel(channel.purpose)}`;
}

/** What a bound channel with no route says. */
export const NO_ROUTES = "no routes point here";

/**
 * The route kinds pointed at a channel.
 *
 * @param routes The kinds, as the service names them.
 * @returns `routes: blocking_question, loop_finished`, or {@link NO_ROUTES}.
 */
export function routesText(routes: readonly string[]): string {
  return routes.length === 0 ? NO_ROUTES : `routes: ${routes.join(", ")}`;
}

/* ------------------------------------------------------------------ the bound list */

/** The bound list's title, and its controls. */
export const BOUND_TITLE = "Bound channels";
export const OPEN_LABEL = "Open ↗";
export const UNBIND_LABEL = "Unbind";
export const UNBINDING_LABEL = "Unbinding…";

/** What is said when an unbind could not be made at all. */
export const UNBIND_FAILED = "The channel could not be unbound. Try again.";

/**
 * The accessible name of a row's **Open ↗** — the label alone is the same on every row.
 *
 * @param channel The channel.
 * @returns `Open #helios-alerts in Slack`.
 */
export function openName(channel: Pick<SlackChannel, "name">): string {
  return `Open ${channelName(channel)} in Slack`;
}

/**
 * The accessible name of a row's **Unbind**.
 *
 * @param channel The channel.
 * @returns `Unbind #helios-alerts`.
 */
export function unbindName(channel: Pick<SlackChannel, "name">): string {
  return `Unbind ${channelName(channel)}`;
}

/** The link to where notification routes are edited. */
export const MANAGE_SETTINGS_LABEL = "Manage in Settings →";
export const MANAGE_SETTINGS_PATH = settingsSectionPath("notifications");

/* ------------------------------------------------------------------ the picker */

/** The picker's title, and its title when it was opened for one purpose. */
export const PICKER_TITLE = "Add a channel";

/**
 * The picker's title.
 *
 * @param preset The purpose it was opened for, or null.
 * @returns `Add a channel`, or `Add a channel for Loops`.
 */
export function pickerTitle(preset: ChannelPurpose | null): string {
  return preset === null ? PICKER_TITLE : `${PICKER_TITLE} for ${PURPOSE_LABELS[preset]}`;
}

/** What the picker says over its list. */
export const PICKER_NOTE =
  "Choose a channel, then say what it is for. Ouroboros can only post in channels it is a member of.";

/** The list's accessible name. */
export const PICKER_LIST_LABEL = "Slack channels";

/** What an empty list says. */
export const NO_CHANNELS =
  "Slack listed no channels for this workspace. Create one in Slack, or refresh if you just did.";

/** The re-list control. */
export const REFRESH_LABEL = "Refresh from Slack";
export const REFRESHING_LABEL = "Refreshing…";
export const REFRESH_FAILED = "The channels could not be refreshed from Slack. Try again.";

/** What the list says of when it was read from Slack, before it ever was. */
export const NEVER_LISTED = "Not listed from Slack yet.";

/**
 * When the list was last read from Slack.
 *
 * @param refreshedAt The instant, or null.
 * @param now The instant the page was read.
 * @returns `Listed from Slack 2m ago.`, or {@link NEVER_LISTED}.
 */
export function listedText(refreshedAt: string | null, now: Date): string {
  return refreshedAt === null ? NEVER_LISTED : `Listed from Slack ${relativeAgo(refreshedAt, now)}.`;
}

/**
 * The question the second step asks.
 *
 * @param channel The chosen channel.
 * @returns `What is #ouroboros-loops for?`
 */
export function purposeQuestion(channel: Pick<SlackChannel, "name">): string {
  return `What is ${channelName(channel)} for?`;
}

/** The second step's controls. */
export const BIND_LABEL = "Bind";
export const BINDING_LABEL = "Binding…";
export const BACK_LABEL = "Back to channels";
export const DONE_LABEL = "Done";
export const CHOOSE_PURPOSE_REASON = "Choose what the channel is for first.";

/** What is said when a bind could not be made at all. */
export const BIND_FAILED = "The channel could not be bound. Try again.";

/**
 * What a channel the bot is not in says before anything is asked of the service.
 *
 * @param channel The chosen channel.
 * @returns The explanation: where to type the invite, and that private channels are no
 *   different.
 */
export function notJoinedNote(channel: Pick<SlackChannel, "name" | "isPrivate">): string {
  const lead = `Ouroboros is not in ${channelName(channel)}, so it cannot post there yet.`;
  const how = `In Slack, open the channel and send ${INVITE_COMMAND}, then refresh here.`;
  const kind = channel.isPrivate
    ? "This is a private channel: the bot cannot join it on its own, and has to be invited the same way."
    : "Private channels are added the same way.";

  return `${lead} ${how} ${kind}`;
}

/**
 * What the picker says once a channel is bound.
 *
 * @param channel The channel.
 * @param purpose What it was bound for.
 * @returns `#ouroboros-loops is bound for Loops.`
 */
export function boundNotice(channel: Pick<SlackChannel, "name">, purpose: ChannelPurpose): string {
  return `${channelName(channel)} is bound for ${PURPOSE_LABELS[purpose]}.`;
}

/**
 * What the picker says once a channel is unbound.
 *
 * @param channel The channel.
 * @returns `#ouroboros-loops is no longer bound.`
 */
export function unboundNotice(channel: Pick<SlackChannel, "name">): string {
  return `${channelName(channel)} is no longer bound.`;
}

/* ------------------------------------------------------------------ writes */

/** What a write answers: the fresh value, or the service's sentence about why not. */
export type ChatOpsOutcome<T> = T | { readonly error: string };

/**
 * Whether a write was refused.
 *
 * @param outcome What the action answered.
 * @returns Whether it is a refusal rather than the value.
 */
export function refused<T extends object>(outcome: ChatOpsOutcome<T>): outcome is { readonly error: string } {
  return "error" in outcome && typeof outcome.error === "string";
}

/**
 * The sentence a refusal prints.
 *
 * @param message The service's own.
 * @param fallback What to say when it gave none.
 * @returns The service's sentence where it has one — it is written for a person.
 */
export function refusalText(message: string, fallback: string): string {
  return message.trim() === "" ? fallback : message;
}

/* ------------------------------------------------------------------ the channel mirror */

/*
 * CA.2 ([#542](https://github.com/NobuData/ouroboros/issues/542)). The card draws **records** —
 * what Ouroboros published to a channel and what was invoked there — and every word of an entry
 * is the service's. What is written below is only the frame around them: the label that says
 * this is a mirror, the composer's honesty about what it can send, and the card's own states.
 */

/** Where the browser reads a channel's mirror from. */
export const MIRROR_ENDPOINT = "/api/chatops/mirror";

/** The address parameter that names the channel whose mirror is showing. */
export const MIRROR_PARAM = "channel";

/** What is said when the mirror could not be reached, and when its answer could not be read. */
export const UNREACHABLE_MIRROR = "The channel mirror could not be reached.";
export const UNREADABLE_MIRROR = "The channel mirror could not be read.";

/** The card's own unread state, and the banner over a stream that could not be re-read. */
export const MIRROR_UNREAD = "The channel mirror could not be read.";
export const MIRROR_STALE_HEADLINE = "The channel mirror could not be re-read.";

/** What the card says before its first answer. */
export const MIRROR_READING = "Reading the mirror…";

/**
 * Where one page of a channel's mirror is read from.
 *
 * @param channelId The channel.
 * @param before An `olderCursor`, for the page before it. The latest page when omitted.
 * @returns `/api/chatops/mirror?channel=…`, with the cursor when there is one.
 */
export function mirrorEndpoint(channelId: string, before?: string | null): string {
  const asked = new URLSearchParams({ [MIRROR_PARAM]: channelId });

  if (before !== undefined && before !== null && before !== "") asked.set("before", before);

  return `${MIRROR_ENDPOINT}?${asked.toString()}`;
}

/**
 * The page's address with a channel's mirror showing.
 *
 * @param channelId The channel.
 * @returns `?channel=…` — relative, so whatever path the page is served under is kept.
 */
export function mirrorAddress(channelId: string): string {
  return `?${new URLSearchParams({ [MIRROR_PARAM]: channelId }).toString()}`;
}

/**
 * Whether a value is a page of a mirror — the guard on what the route answered.
 *
 * @param value What arrived.
 * @returns True when it carries a channel and a list of entries.
 */
export function isChatMirror(value: unknown): value is ChatMirror {
  if (typeof value !== "object" || value === null) return false;

  const page = value as { channel?: unknown; entries?: unknown };

  return typeof page.channel === "object" && page.channel !== null && Array.isArray(page.entries);
}

/**
 * Which channel's mirror the page shows.
 *
 * @param channels The workspace's channels, as served.
 * @param wanted The channel the address names, or null when it names none.
 * @returns The named channel when it is a bound one, else the first bound channel — or null
 *   when nothing is bound, which is the post-install step's page and not the mirror's.
 */
export function mirrorChannel(channels: readonly SlackChannel[], wanted: string | null): SlackChannel | null {
  const bound = boundChannels(channels);

  return bound.find((channel) => channel.id === wanted) ?? bound[0] ?? null;
}

/* ---- the card's head ---- */

/** The platforms a mirror can be of, as the tag and the segment name them. */
export const PLATFORM_LABELS: Readonly<Record<ChatMirror["platform"], string>> = { slack: "Slack" };

/** The segment's accessible name, and its second, not-yet-available half. */
export const PLATFORM_SEGMENT_LABEL = "Chat platform";
export const TEAMS_LABEL = "Teams";

/** Why Teams cannot be chosen — printed beside the segment, not only on it. */
export const TEAMS_REASON = "arrives with CB.2 (#547)";

/** The chip that says what this card is, and the note behind it. */
export const MIRROR_LABEL = "mirror";
export const MIRROR_TOOLTIP =
  "this is Ouroboros's record of what it published — the conversation lives in Slack";

/** The accessible name of the control that opens that note. */
export const MIRROR_TIP_LABEL = "What mirror means";

/**
 * The card's accessible name.
 *
 * @param channel The channel.
 * @returns `Mirror of #ouroboros-loops`.
 */
export function mirrorName(channel: Pick<SlackChannel, "name">): string {
  return `Mirror of ${channelName(channel)}`;
}

/**
 * The head's meta line, from connection truth.
 *
 * @param memberCount How many people are in the channel, or null when Slack did not say.
 * @param appVersion The installed app's version, or null when the connection does not say.
 * @returns `24 members · Ouroboros app v2.4`, either half alone, or null — never a placeholder.
 */
export function mirrorMeta(memberCount: number | null, appVersion: string | null): string | null {
  const app = appText(appVersion);
  const parts = [membersText(memberCount), app === null ? null : `Ouroboros ${app}`].filter(
    (part): part is string => part !== null,
  );

  return parts.length === 0 ? null : parts.join(` ${FACT_SEPARATOR} `);
}

/**
 * What the freshness tag reads.
 *
 * @param updatedAt When the mirror was last read or confirmed, epoch milliseconds — or null
 *   before the first answer.
 * @param nowSeconds The reader's clock, in whole seconds.
 * @returns `updated 12s ago`, or `reading…`.
 */
export function mirrorFreshness(updatedAt: number | null, nowSeconds: number): string {
  if (updatedAt === null) return MIRROR_FRESH_READING;

  return `updated ${ageOfSeconds(nowSeconds - updatedAt / 1000)} ago`;
}

/** The freshness tag before the first answer, and what pressing it does. */
export const MIRROR_FRESH_READING = "reading…";
export const MIRROR_FRESH_TITLE = "Read the mirror again now";

/* ---- the stream ---- */

/** The stream's accessible name. */
export const STREAM_LABEL = "Published and invoked";

/** Who a card is from: the app, marked as one. */
export const BOT_NAME = "Ouroboros";
export const APP_TAG = "APP";

/** The marker on a command that was typed in this app rather than in Slack. */
export const CONSOLE_SURFACE_MARK = "console";

/** Who ran a command nobody is linked to, and what stands where their initials would. */
export const UNKNOWN_AUTHOR = "Unlinked member";
export const UNKNOWN_INITIALS = "?";

/** The annotation on a question that was escalated. */
export const ESCALATED_MARK = "⚠ escalated";

/** What a command still waiting for its result says under its acknowledgement. */
export const PENDING_NOTE = "still running — the result appears here when it finishes";

/** The control that pages backwards, and what it says while a page is on its way. */
export const LOAD_EARLIER_LABEL = "Load earlier";
export const LOADING_EARLIER_LABEL = "Loading earlier…";
export const EARLIER_FAILED = "Earlier entries could not be read. Try again.";

/** A zone seam: the reader's own when omitted, a fixed one in a test. */
type Zone = string | undefined;

/**
 * An instant as the stream's clock writes it.
 *
 * @param iso The instant.
 * @param timeZone The zone. The reader's own when omitted.
 * @returns `14:11` — twenty-four hours, in the reader's zone — or `""` for a stamp that cannot
 *   be read.
 */
export function clockText(iso: string, timeZone?: Zone): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";

  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(at);
}

/**
 * The local day an instant falls on, as a sortable key.
 *
 * @param at The instant.
 * @param timeZone The zone. The reader's own when omitted.
 * @returns `2026-10-12`.
 */
export function dayKey(at: Date, timeZone?: Zone): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(at);
}

/** The two days that are named rather than dated. */
export const TODAY_LABEL = "Today";
export const YESTERDAY_LABEL = "Yesterday";

/** A day, in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What a day's divider says.
 *
 * @param at Any instant of the day.
 * @param now The reader's clock.
 * @param timeZone The zone. The reader's own when omitted.
 * @returns `Today`, `Yesterday`, or `Mon 5 Oct` — with the year once it is not this one.
 */
export function dayLabel(at: Date, now: Date, timeZone?: Zone): string {
  const key = dayKey(at, timeZone);

  if (key === dayKey(now, timeZone)) return TODAY_LABEL;
  if (key === dayKey(new Date(now.getTime() - DAY_MS), timeZone)) return YESTERDAY_LABEL;

  const sameYear = key.slice(0, 4) === dayKey(now, timeZone).slice(0, 4);

  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
    timeZone,
  })
    .format(at)
    .replace(",", "");
}

/** One local day of the stream. */
export interface MirrorDay {
  /** The day, as {@link dayKey} writes it. */
  readonly key: string;
  /** What its divider says. */
  readonly label: string;
  /** Its entries, oldest first. */
  readonly entries: readonly ChatMirrorEntry[];
}

/**
 * The key an entry is held and drawn by. A card and a command are rows of two tables, so an id
 * alone is not enough.
 *
 * @param entry The entry.
 * @returns `card:<id>`.
 */
export function entryKey(entry: Pick<ChatMirrorEntry, "type" | "id">): string {
  return `${entry.type}:${entry.id}`;
}

/**
 * The entries held, with a page read since folded in.
 *
 * A page replaces what is held of the entries it carries — a question that was open is now
 * resolved, a command that was pending now has its result — and adds the ones not seen before.
 * Nothing held is dropped: the latest page slides forward as the channel is written to, and the
 * entries that fall off its start are still the reader's, as are the earlier pages they loaded.
 *
 * @param held What is on screen.
 * @param page What was read.
 * @returns Both, by instant and then by id — the order the service pages in.
 */
export function mergeMirror(
  held: readonly ChatMirrorEntry[],
  page: readonly ChatMirrorEntry[],
): readonly ChatMirrorEntry[] {
  const byKey = new Map<string, ChatMirrorEntry>();

  for (const entry of held) byKey.set(entryKey(entry), entry);
  for (const entry of page) byKey.set(entryKey(entry), entry);

  return [...byKey.values()].sort((left, right) => {
    const gap = Date.parse(left.at) - Date.parse(right.at);
    if (gap !== 0 && !Number.isNaN(gap)) return gap;

    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

/**
 * The stream, grouped by the reader's local day.
 *
 * @param entries The entries, oldest first.
 * @param now The reader's clock.
 * @param timeZone The zone. The reader's own when omitted.
 * @returns The days, oldest first.
 */
export function mirrorDays(entries: readonly ChatMirrorEntry[], now: Date, timeZone?: Zone): readonly MirrorDay[] {
  const days: { key: string; label: string; entries: ChatMirrorEntry[] }[] = [];

  for (const entry of entries) {
    const at = new Date(entry.at);
    const key = Number.isNaN(at.getTime()) ? "" : dayKey(at, timeZone);
    const last = days.at(-1);

    if (last !== undefined && last.key === key) last.entries.push(entry);
    else days.push({ key, label: key === "" ? "" : dayLabel(at, now, timeZone), entries: [entry] });
  }

  return days;
}

/**
 * How a resolved question reads where its buttons were.
 *
 * @param resolution The answer, who gave it and when.
 * @param timeZone The zone. The reader's own when omitted.
 * @returns `resolved: allow once — Maya Chen (14:11)`; without the dash part when nobody is
 *   named, and without the time when the stamp cannot be read.
 */
export function resolutionText(resolution: MirrorResolution, timeZone?: Zone): string {
  const clock = clockText(resolution.at, timeZone);
  const who = resolution.actor === null || resolution.actor.trim() === "" ? "" : ` — ${resolution.actor.trim()}`;

  return `resolved: ${resolution.outcome}${who}${clock === "" ? "" : ` (${clock})`}`;
}

/**
 * A person's initials, for their avatar.
 *
 * @param name Their name, or null when the command is nobody's we know.
 * @returns `KS` for *Ken Suenobu*, `K` for *Ken*, {@link UNKNOWN_INITIALS} for nobody.
 */
export function initials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter((word) => word !== "");

  if (words.length === 0) return UNKNOWN_INITIALS;

  const first = [...words[0]!][0] ?? "";
  const last = words.length > 1 ? ([...words.at(-1)!][0] ?? "") : "";

  return `${first}${last}`.toUpperCase();
}

/**
 * Whether an address is a page of this application.
 *
 * @param href The address.
 * @returns True for a path — `/prs/512` — and false for anything with an origin of its own.
 */
export function isInApp(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

/** The button treatment each of a card action's styles takes. */
export const ACTION_TONES: Readonly<Record<MirrorAction["style"], "primary" | "danger" | "ghost">> = {
  primary: "primary",
  danger: "danger",
  default: "ghost",
};

/** The severities the sheet draws; anything else is drawn as `info`. */
export const MIRROR_SEVERITIES: readonly MirrorSeverity[] = ["ok", "warn", "accent", "err", "info"];

/**
 * The severity a card is drawn in.
 *
 * @param severity What the record says.
 * @returns It, or `info` for one this build has no treatment for — the words are still the
 *   record's.
 */
export function cardSeverity(severity: string): MirrorSeverity {
  return (MIRROR_SEVERITIES as readonly string[]).includes(severity) ? (severity as MirrorSeverity) : "info";
}

/**
 * Whether a command's reply is drawn as a failure.
 *
 * @param outcome How the command came out.
 * @returns True for `error`, `denied` and `unlinked`. The words stay the stored ones.
 */
export function replyFailed(outcome: MirrorCommand["outcome"]): boolean {
  return outcome === "error" || outcome === "denied" || outcome === "unlinked";
}

/* ---- the card's states ---- */

/** What a bound channel with nothing in its mirror says. */
export const MIRROR_EMPTY_TITLE = "Nothing has been published to this channel yet";

/**
 * The line under that title.
 *
 * @param channel The channel.
 * @returns What will appear here, once there is something.
 */
export function mirrorEmptyNote(channel: Pick<SlackChannel, "name">): string {
  return `What Ouroboros posts to ${channelName(channel)}, and the commands run there, will be recorded here.`;
}

/**
 * The warning on a channel the bot was removed from.
 *
 * @param channel The channel.
 * @returns What happened, what it costs and how to mend it — in #541's words for the invite.
 */
export function removedNote(channel: Pick<SlackChannel, "name">): string {
  return `Ouroboros was removed from ${channelName(channel)}, so nothing new is being posted there. In Slack, open the channel and send ${INVITE_COMMAND} to bring it back.`;
}

/**
 * The warning on a channel archived in Slack.
 *
 * @param channel The channel.
 * @returns What it means for the mirror.
 */
export function archivedNote(channel: Pick<SlackChannel, "name">): string {
  return `${channelName(channel)} is archived in Slack, so nothing new is being posted there.`;
}

/**
 * What stands over the stream when the channel is not one Ouroboros can post to.
 *
 * @param channel The channel, as the mirror last read it.
 * @returns The warning, or null for a channel in good standing.
 */
export function standingNote(channel: Pick<SlackChannel, "name" | "joined" | "archived">): string | null {
  if (channel.archived) return archivedNote(channel);

  return channel.joined ? null : removedNote(channel);
}

/* ---- the composer ---- */

/** The composer's accessible name, its button and the button while a line is out. */
export const COMPOSER_LABEL = "Run a command";
export const SEND_LABEL = "Send";
export const SENDING_LABEL = "Sending…";

/** Why plain text cannot be sent — said, beside the way to where it can be. */
export const PLAIN_TEXT_HINT = "messages live in Slack — commands work here";

/** What the composer says while it holds nothing that is not a command. */
export const COMPOSER_HINT = "commands work here — start with /ouro";

/** Why **Send** is inert while the box holds no command yet. */
export const SEND_NEEDS_COMMAND = "Type a command after /ouro first.";

/**
 * The composer's placeholder.
 *
 * @param channel The channel.
 * @returns `Message #ouroboros-loops — or /ouro …`.
 */
export function composerPlaceholder(channel: Pick<SlackChannel, "name">): string {
  return `Message ${channelName(channel)} — or ${CONSOLE_PREFIX} …`;
}

/** What the composer's box holds, as far as sending goes. */
export type ComposerMode =
  /** Nothing. */
  | "empty"
  /** The start of the prefix, or the prefix with no command after it yet. */
  | "prefix"
  /** A command: it can be sent. */
  | "command"
  /** Anything else — a message, which lives in Slack. */
  | "plain";

/**
 * What the box holds.
 *
 * @param text The box's whole content.
 * @returns See {@link ComposerMode}. A prefix still being typed is not yet a message: the reader
 *   is not told their command cannot be sent three letters into typing it.
 */
export function composerMode(text: string): ComposerMode {
  const typed = text.toLowerCase();

  if (typed.trim() === "") return "empty";
  if (CONSOLE_PREFIX.startsWith(typed)) return "prefix";
  if (!typed.startsWith(`${CONSOLE_PREFIX} `)) return "plain";

  return typed.slice(CONSOLE_PREFIX.length).trim() === "" ? "prefix" : "command";
}

/**
 * Why **Send** cannot be pressed.
 *
 * @param mode What the box holds.
 * @param sending Whether a line is out.
 * @returns The reason, or undefined when it can be pressed.
 */
export function sendReason(mode: ComposerMode, sending: boolean): string | undefined {
  if (sending) return SENDING_LABEL;
  if (mode === "plain") return PLAIN_TEXT_HINT;

  return mode === "command" ? undefined : SEND_NEEDS_COMMAND;
}

/* ---- the bound list's way in ---- */

/** A bound row's control for showing its mirror, and what it reads on the row that is showing. */
export const SHOW_MIRROR_LABEL = "Show mirror";
export const SHOWING_MIRROR_LABEL = "Showing";

/**
 * The accessible name of a row's **Show mirror**.
 *
 * @param channel The channel.
 * @returns `Show the mirror of #helios-alerts`.
 */
export function showMirrorName(channel: Pick<SlackChannel, "name">): string {
  return `Show the mirror of ${channelName(channel)}`;
}
