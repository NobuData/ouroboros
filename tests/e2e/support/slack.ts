/**
 * The suite's Slack, as a client — and as Slack itself
 * ([#545](https://github.com/NobuData/ouroboros/issues/545), the chatops leg).
 *
 * `fixtures/slack-stub/server.mjs` is the **receiving** half: the workspace `ouroboros-rest`
 * posts to. This file drives its controls, reads what was posted, and is the **emitting** half —
 * it signs a body exactly as Slack does (`v0=HMAC-SHA256(secret, "v0:<ts>:<raw body>")`,
 * `slack.signature.ts`'s scheme, restated the way `receiver.ts` restates the webhook's) and sends
 * it to the service's three inbound routes. Between them they are
 * `ouroboros-rest/src/testing/slack.harness.fixture.ts` (BZ.6, #540), split at the process
 * boundary a compose stack has.
 *
 * **Nothing here knows what the service will answer.** A command's result arrives at the
 * `response_url` the emit handed out, on the stub; the leg reads it from there.
 */

import { createHmac } from "node:crypto";

import { REST_URL, SLACK_URL } from "./stack";

/** The signing secret `docker-compose.e2e.yml` gives `rest` — the one Slack would sign with. */
export const SLACK_SIGNING_SECRET = "e2e-slack-signing-secret-0123456789abcdef";

/** Where the service reaches the stub — the origin a `response_url` must be on to be answered. */
export const SLACK_INTERNAL_ORIGIN = "http://slack-stub:8080";

/** Where Slack's consent screen is: what the install redirects the browser to. */
export const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";

/** A channel of a declared workspace. */
export interface SlackStubChannel {
  /** Slack's id for it — `C071LOOPS`. */
  readonly id: string;
  /** Without the `#`. */
  readonly name: string;
  readonly isPrivate?: boolean;
  /** Whether the bot is in it. Defaults to true. */
  readonly isMember?: boolean;
  readonly isArchived?: boolean;
  readonly members?: number;
}

/** A workspace the stub stands in for. */
export interface SlackStubTeam {
  readonly id: string;
  readonly name: string;
  /** The token an install is granted, and every later call must carry. */
  readonly botToken: string;
  readonly botUserId: string;
  readonly channels: readonly SlackStubChannel[];
  readonly users: readonly {
    readonly id: string;
    readonly name: string;
    readonly email?: string;
  }[];
}

/**
 * The seeded workspace, as Slack: `R__dev_seed_workspace_triage_slack.sql`'s team, its three
 * bound channels and its two linked people, with a bot token the stub will honour — which the
 * seed's own (an unsealable placeholder) is not.
 */
export const SEEDED_SLACK_TEAM: SlackStubTeam = {
  id: "T024AB",
  name: "acme-robotics",
  botToken: "xoxb-e2e-acme-robotics-0123456789",
  botUserId: "U07OUROBOT",
  channels: [
    { id: "C071LOOPS", name: "ouroboros-loops", members: 24 },
    { id: "C072ALERT", name: "helios-alerts", members: 11 },
    { id: "C073LEADS", name: "eng-leads", isPrivate: true, members: 5 },
  ],
  users: [
    { id: "U07KEN", name: "Ken Suenobu", email: "ken@acme-robotics.dev" },
    { id: "U07MAYA", name: "Maya Chen", email: "maya@acme-robotics.dev" },
  ],
};

/** One Web API call the service made, as the stub recorded it. */
export interface SlackCall {
  /** The method — `chat.postMessage`. */
  readonly method: string;
  /** Whether it carried a bearer token. */
  readonly authorized: boolean;
  /** Its form fields; `blocks` and `attachments` are JSON strings, as sent. */
  readonly form: Readonly<Record<string, string>>;
  readonly status: number;
  readonly answer: Readonly<Record<string, unknown>>;
}

/** A message as the stub holds it. */
export interface SlackMessage {
  readonly team: string;
  /** The channel's Slack id — or `D…` for a DM. */
  readonly channel: string;
  readonly ts: string;
  /** How many times it has been edited. */
  readonly edits: number;
  readonly text: string;
  readonly blocks: readonly unknown[];
  readonly attachments: readonly unknown[];
}

/** A button of a message, as a person would see it. */
export interface SlackButton {
  readonly label: string;
  readonly actionId: string | undefined;
  readonly value: string | undefined;
  readonly url: string | undefined;
}

/** One scripted answer to a method's next call. */
export type SlackScripted =
  { readonly error: string } | { readonly rateLimit: number } | { readonly delayMs: number };

/**
 * Ask the stub's controls for something.
 *
 * @param method - `GET` or `POST`.
 * @param name - The control, under `/__slack/`.
 * @param body - A JSON body.
 * @returns The parsed answer.
 * @throws {Error} Naming the fixture when it does not answer — the marker
 *   `scripts/verify-failure-modes.sh` looks for with the stub stopped.
 */
async function control<Answer>(
  method: "GET" | "POST",
  name: string,
  body?: Readonly<Record<string, unknown>>,
): Promise<Answer> {
  let response: Response;

  try {
    response = await fetch(`${SLACK_URL}/__slack/${name}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (reason) {
    throw new Error(
      `the Slack stub is not answering at ${SLACK_URL} — the chatops leg publishes to it and ` +
        `reads what arrived (fixtures/slack-stub). ${String(reason)}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `the Slack stub answered ${method} /__slack/${name} with ${response.status}: ` +
        (await response.text()),
    );
  }

  return (await response.json()) as Answer;
}

/**
 * Forget every team, call, message, reply, script and code.
 *
 * @returns When the stub has.
 */
export async function resetSlack(): Promise<void> {
  await control("POST", "reset");
}

/**
 * Declare a workspace — replacing one with the same id.
 *
 * @param team - The workspace.
 * @returns When the stub knows it.
 */
export async function declareTeam(team: SlackStubTeam): Promise<void> {
  await control("POST", "team", { team });
}

/**
 * An OAuth code that installs a declared workspace — exchangeable once, as Slack's is.
 *
 * @param teamId - The workspace.
 * @returns The code the consent screen would redirect back with.
 */
export async function oauthCode(teamId: string): Promise<string> {
  return (await control<{ code: string }>("POST", "code", { teamId })).code;
}

/**
 * Revoke a workspace's token, or honour it again.
 *
 * @param teamId - The workspace.
 * @param revoked - Whether its token stops working.
 * @returns When the stub has taken it.
 */
export async function revokeTeam(teamId: string, revoked = true): Promise<void> {
  await control("POST", "revoke", { teamId, revoked });
}

/**
 * Remove the bot from a channel, or invite it back.
 *
 * @param teamId - The workspace.
 * @param channel - The channel's Slack id.
 * @param isMember - Whether the bot is in it afterwards.
 * @returns When the stub has taken it.
 */
export async function setBotMembership(
  teamId: string,
  channel: string,
  isMember: boolean,
): Promise<void> {
  await control("POST", "membership", { teamId, channel, isMember });
}

/**
 * Script a method's next answers, consumed in order; afterwards it answers normally again.
 *
 * @param method - The Web API method — `chat.postMessage`.
 * @param answers - What its next calls answer.
 * @returns When the stub has taken them.
 */
export async function scriptSlack(
  method: string,
  ...answers: readonly SlackScripted[]
): Promise<void> {
  await control("POST", "script", { method, answers });
}

/**
 * The calls the service made to one method since the last reset, oldest first.
 *
 * @param method - The Web API method.
 * @returns The calls.
 */
export async function slackCalls(method: string): Promise<readonly SlackCall[]> {
  const { calls } = await control<{ calls: readonly SlackCall[] }>("GET", "calls");

  return calls.filter((call) => call.method === method);
}

/**
 * The messages in one channel, as they now stand, oldest first.
 *
 * @param channel - The channel's Slack id, or a DM's (`D07KEN`).
 * @returns The messages.
 */
export async function slackMessages(channel: string): Promise<readonly SlackMessage[]> {
  const { messages } = await control<{ messages: readonly SlackMessage[] }>("GET", "messages");

  return messages.filter((message) => message.channel === channel);
}

/**
 * Every button under a Block Kit tree, depth first.
 *
 * @param node - A block, an attachment, a list of either, or anything beneath one.
 * @returns The button elements.
 */
function buttonsIn(node: unknown): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(buttonsIn);
  if (typeof node !== "object" || node === null) return [];

  const element = node as Record<string, unknown>;

  return element.type === "button" ? [element] : Object.values(element).flatMap(buttonsIn);
}

/**
 * A message's buttons, as a person would see them.
 *
 * @param message - The message.
 * @returns Each button's label, `action_id`, `value` and `url`.
 */
export function buttonsOf(message: Pick<SlackMessage, "blocks" | "attachments">): SlackButton[] {
  return buttonsIn([message.blocks, message.attachments]).map((button) => {
    const label = (button.text as { text?: unknown } | undefined)?.text;

    return {
      label: typeof label === "string" ? label : "",
      actionId: typeof button.action_id === "string" ? button.action_id : undefined,
      value: typeof button.value === "string" ? button.value : undefined,
      url: typeof button.url === "string" ? button.url : undefined,
    };
  });
}

/**
 * Everything a message says, flattened — its fallback text and every string in its blocks.
 *
 * @param message - The message.
 * @returns The text, for a `toContain`.
 */
export function textOf(message: Pick<SlackMessage, "text" | "blocks" | "attachments">): string {
  return `${message.text} ${JSON.stringify([message.blocks, message.attachments])}`;
}

/* ------------------------------------------------------------------ the emitter */

/** How an emitted request departs from what Slack would send — for the break-it runs. */
export interface SlackTamper {
  /** The secret signed with, in place of the app's. */
  readonly secret?: string;
}

/** What an emit hands back. */
export interface SlackEmitted {
  /** The status the service acknowledged with. */
  readonly status: number;
  /** The acknowledgement's body, as text. */
  readonly body: string;
  /** The path on the stub the result will be posted to, or undefined for an event. */
  readonly replyPath: string | undefined;
}

/** What `response_url`s are numbered from, with a per-process prefix so two runs cannot collide. */
let emitted = 0;
const RUN = Date.now().toString(36);

/**
 * The signature Slack would put on a body.
 *
 * @param secret - The signing secret.
 * @param timestamp - `x-slack-request-timestamp`.
 * @param body - The exact bytes sent.
 * @returns `v0=<hex>`.
 */
export function slackSignature(secret: string, timestamp: string, body: string): string {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:`).update(body).digest("hex")}`;
}

/**
 * Send a signed request to one of the service's inbound routes, as Slack would.
 *
 * @param path - The route — `/api/v1/slack/commands`.
 * @param body - The exact bytes to sign and send.
 * @param contentType - The body's media type.
 * @param tamper - How the request departs from an honest one.
 * @returns The service's acknowledgement.
 */
async function send(
  path: string,
  body: string,
  contentType: string,
  tamper: SlackTamper,
): Promise<{ status: number; body: string }> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const response = await fetch(`${REST_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": contentType,
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": slackSignature(tamper.secret ?? SLACK_SIGNING_SECRET, timestamp, body),
    },
    body,
  });

  return { status: response.status, body: await response.text() };
}

/**
 * A fresh `response_url` on the stub, and the path its reply will be kept under.
 *
 * @returns Both.
 */
function responseUrl(): { url: string; path: string } {
  emitted += 1;

  const path = `/hooks/e2e/${RUN}/${String(emitted)}`;

  return { url: `${SLACK_INTERNAL_ORIGIN}${path}`, path };
}

/**
 * Type `/ouro <text>` in Slack.
 *
 * @param command - Which workspace, who typed it, in which channel, and the text after `/ouro`.
 * @param tamper - How the request departs from an honest one.
 * @returns The acknowledgement, and where the result will be posted.
 */
export async function emitCommand(
  command: {
    readonly team: string;
    readonly user: string;
    readonly channel: string;
    readonly text: string;
  },
  tamper: SlackTamper = {},
): Promise<SlackEmitted> {
  const reply = responseUrl();
  const body = new URLSearchParams({
    command: "/ouro",
    text: command.text,
    team_id: command.team,
    user_id: command.user,
    channel_id: command.channel,
    response_url: reply.url,
    trigger_id: `trigger-${RUN}-${String(emitted)}`,
  }).toString();

  return {
    ...(await send("/api/v1/slack/commands", body, "application/x-www-form-urlencoded", tamper)),
    replyPath: reply.path,
  };
}

/**
 * Press a button on a message in Slack (`block_actions`).
 *
 * @param press - Which workspace, who pressed, which button, on which message.
 * @param tamper - How the request departs from an honest one.
 * @returns The acknowledgement, and where the result will be posted.
 */
export async function emitPress(
  press: {
    readonly team: string;
    readonly user: string;
    readonly button: Pick<SlackButton, "actionId" | "value">;
    readonly message: Pick<SlackMessage, "channel" | "ts">;
  },
  tamper: SlackTamper = {},
): Promise<SlackEmitted> {
  const reply = responseUrl();
  const payload = {
    type: "block_actions",
    team: { id: press.team },
    user: { id: press.user },
    response_url: reply.url,
    actions: [{ type: "button", action_id: press.button.actionId, value: press.button.value }],
    channel: { id: press.message.channel },
    message: { ts: press.message.ts },
    container: { channel_id: press.message.channel, message_ts: press.message.ts },
  };
  const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();

  return {
    ...(await send(
      "/api/v1/slack/interactivity",
      body,
      "application/x-www-form-urlencoded",
      tamper,
    )),
    replyPath: reply.path,
  };
}

/**
 * The replies posted to one `response_url`, oldest first.
 *
 * @param replyPath - The path an emit handed back.
 * @returns Each reply's text.
 */
export async function slackReplies(replyPath: string | undefined): Promise<readonly string[]> {
  const { replies } = await control<{
    replies: readonly { path: string; body: { text?: unknown } }[];
  }>("GET", "replies");

  return replies
    .filter((reply) => reply.path === replyPath)
    .map((reply) => (typeof reply.body.text === "string" ? reply.body.text : ""));
}
