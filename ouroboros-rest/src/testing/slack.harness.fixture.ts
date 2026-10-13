/**
 * Slack, for the integration suites (BZ.6, [#540](https://github.com/NobuData/ouroboros/issues/540))
 * — a local stand-in that is both halves of the platform:
 *
 * ```
 * receiver   an HTTP server on loopback that answers the Web API methods this service calls and
 *            the `response_url`s it replies to, and records every one
 * emitter    signs a body exactly as Slack does and sends it to the application under test
 * ```
 *
 * **Nothing leaves the machine.** The application is given the real `HttpSlackApi` over
 * {@link SlackHarness.fetch}, which sends `https://slack.com/api/…` and `https://hooks.slack.com/…`
 * to the receiver and refuses every other address — recording it in {@link SlackHarness.escaped},
 * which {@link SlackHarness.assertNoEscapes} holds empty. So the client's own request building,
 * its `Retry-After` reading and its `response_url` host rule are under test, not replaced.
 *
 * **The receiver has a world.** {@link SlackHarness.team} declares a Slack workspace: its bot
 * token, its channels and its people. A method called with a token no team holds — or one
 * {@link SlackHarness.revoke}d — answers `invalid_auth`, as Slack does. Messages posted are kept
 * per channel with the `ts` they were given, and an update replaces the one it names.
 *
 * **Failures are scripted, one call at a time.** {@link SlackHarness.script} queues answers for
 * a method — a `429` with `Retry-After`, an error code, a delay — consumed in order by the next
 * calls to it; when the queue is empty the method answers normally again.
 *
 * **The emitter can lie.** Every `emit*` takes {@link Tamper}: another timestamp, another
 * signature, a header left out, or a body changed after signing. {@link SlackHarness.redeliver}
 * sends the last event again, freshly signed, as Slack does on a doubt.
 *
 * It is a real server, so the e2e leg (#545) can start one beside the stack; what that leg still
 * has to add is a setting that points the service's Web API base at it.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts`.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import request from "supertest";

import { SLACK_API_URL } from "../modules/slack/slack.app";
import { HttpSlackApi, SLACK_API } from "../modules/slack/slack.client";
import {
  SLACK_SIGNATURE_HEADER,
  SLACK_TIMESTAMP_HEADER,
  slackSignature,
} from "../modules/slack/slack.signature";
import type { ProviderOverride } from "./harness.fixture";

/** The Slack app the harness is: what the application under test is configured with. */
export const SLACK_APP = {
  clientId: "5400000000.5400000000540",
  clientSecret: "bz6-client-secret-that-must-not-leak",
  signingSecret: "bz6-signing-secret-0123456789abcdef",
} as const;

/** Where a `response_url` the emitter hands out lives — a host the client will post to. */
export const RESPONSE_URL_BASE = "https://hooks.slack.com/commands";

/** The three inbound routes. */
export const SLACK_EVENTS = "/api/v1/slack/events";
export const SLACK_COMMANDS = "/api/v1/slack/commands";
export const SLACK_INTERACTIVITY = "/api/v1/slack/interactivity";

/** A channel of a declared team. */
export interface HarnessChannel {
  readonly id: string;
  readonly name: string;
  readonly isPrivate?: boolean;
  /** Whether the bot is in it. Defaults to true. */
  readonly isMember?: boolean;
  readonly isArchived?: boolean;
  readonly members?: number;
}

/** A person of a declared team. */
export interface HarnessUser {
  readonly id: string;
  readonly name: string;
  readonly email?: string;
}

/** A Slack workspace the receiver knows. */
export interface HarnessTeam {
  readonly id: string;
  readonly name: string;
  readonly botToken: string;
  readonly botUserId: string;
  readonly channels: readonly HarnessChannel[];
  readonly users: readonly HarnessUser[];
  /** The scopes the install grants. Defaults to {@link DEFAULT_SCOPES}. */
  readonly scopes?: readonly string[];
}

/** The scopes an install grants unless a team says otherwise. */
export const DEFAULT_SCOPES = [
  "chat:write",
  "commands",
  "channels:read",
  "groups:read",
  "im:write",
  "users:read",
  "users:read.email",
] as const;

/** One Web API call the application made. */
export interface RecordedCall {
  /** The method — `chat.postMessage`. */
  readonly method: string;
  /** The bearer token it carried, or undefined. */
  readonly token: string | undefined;
  /** Its form fields. `blocks` and `attachments` are JSON strings, as sent. */
  readonly form: Readonly<Record<string, string>>;
  /** The HTTP status it was answered with. */
  readonly status: number;
  /** The body it was answered with. */
  readonly answer: Readonly<Record<string, unknown>>;
}

/** One reply the application posted to a `response_url`. */
export interface RecordedReply {
  /** The full `response_url`. */
  readonly url: string;
  /** The Block Kit payload, parsed. */
  readonly body: Readonly<Record<string, unknown>>;
}

/** A message as the receiver holds it. */
export interface PostedMessage {
  readonly team: string;
  readonly channel: string;
  readonly ts: string;
  /** How many times it has been edited. */
  readonly edits: number;
  readonly text: string;
  readonly blocks: readonly unknown[];
  readonly attachments: readonly unknown[];
}

/** One scripted answer to a method's next call. */
export type Scripted =
  /** `429` with `Retry-After`, as Slack rate-limits. */
  | { readonly rateLimit: number }
  /** `200 {ok: false, error}` — a Web API refusal. */
  | { readonly error: string }
  /** Answer normally, after this long. */
  | { readonly delayMs: number };

/** How an emitted request departs from what Slack would send. */
export interface Tamper {
  /** The timestamp header's value, in place of now. */
  readonly timestamp?: string;
  /** The signature header's value, in place of the true one. */
  readonly signature?: string;
  /** Headers left out entirely. */
  readonly omit?: readonly ("signature" | "timestamp")[];
  /** The bytes actually sent, in place of the ones signed. */
  readonly sentBody?: string;
  /** The secret signed with, in place of the app's. */
  readonly secret?: string;
}

/** A slash command, as the emitter sends one. */
export interface EmittedCommand {
  readonly team: string;
  readonly user: string;
  /** The channel it was typed in. Defaults to the team's first. */
  readonly channel?: string;
  /** The text after `/ouro`. */
  readonly text: string;
}

/** A button press, as the emitter sends one. */
export interface EmittedPress {
  readonly team: string;
  readonly user: string;
  /** The pressed button's `action_id` and `value`. */
  readonly action: { readonly actionId: string; readonly value: string };
  /** The message the button is on, or null to send a press that names none. */
  readonly message: { readonly channel: string; readonly ts: string } | null;
}

/** What an emit hands back: the acknowledgement, and where the result will be posted. */
export interface Emitted {
  /** The application's answer to the request itself. */
  readonly response: request.Response;
  /** The `response_url` the request carried, or undefined for an event. */
  readonly responseUrl: string | undefined;
  /** How long the acknowledgement took, in milliseconds. */
  readonly ackMs: number;
}

/** How long {@link SlackHarness.waitFor} waits before giving up. */
export const WAIT_TIMEOUT_MS = 5000;

/** The form body of a request, as fields. */
function formOf(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body));
}

/** A JSON-string form field, parsed — `[]` when absent or not a list. */
function listOf(value: string | undefined): unknown[] {
  try {
    const parsed: unknown = JSON.parse(value ?? "[]");

    return Array.isArray(parsed) ? (parsed as unknown[]) : [];
  } catch {
    return [];
  }
}

/** Every button in a message's blocks and attachments, depth-first. */
function buttonsIn(
  node: unknown,
  found: Record<string, unknown>[] = [],
): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const item of node) {
      buttonsIn(item, found);
    }
  } else if (typeof node === "object" && node !== null) {
    const record = node as Record<string, unknown>;

    if (record.type === "button") {
      found.push(record);
    }
    for (const value of Object.values(record)) {
      buttonsIn(value, found);
    }
  }

  return found;
}

export class SlackHarness {
  /** Every Web API call made, oldest first. */
  readonly calls: RecordedCall[] = [];

  /** Every `response_url` reply posted, oldest first. */
  readonly replies: RecordedReply[] = [];

  /** Addresses the application tried to fetch that are not Slack's. Must stay empty. */
  readonly escaped: string[] = [];

  private readonly teams = new Map<string, HarnessTeam>();
  private readonly revoked = new Set<string>();
  private readonly messages: PostedMessage[] = [];
  private readonly scripts = new Map<string, Scripted[]>();
  private readonly codes = new Map<string, string>();
  private lastEvent: Record<string, unknown> | undefined;
  private sequence = 0;
  private target: string | undefined;

  /**
   * @param server - The receiver, already listening.
   * @param origin - Where it is listening.
   */
  private constructor(
    private readonly server: Server,
    private readonly origin: string,
  ) {}

  /**
   * Start the receiver on a loopback port the operating system chooses.
   *
   * @param port - A fixed port, for a caller that runs it beside a stack. `0` otherwise.
   * @returns The harness.
   */
  static async start(port = 0): Promise<SlackHarness> {
    // The handler needs the harness and the harness needs the listening server.
    const holder: { harness?: SlackHarness } = {};
    const server = createServer((incoming, outgoing) => {
      void holder.harness?.handle(incoming, outgoing);
    });

    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

    const harness = new SlackHarness(
      server,
      `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
    );

    holder.harness = harness;

    return harness;
  }

  /** The environment that registers this harness's Slack app with the application under test. */
  get env(): NodeJS.ProcessEnv {
    return {
      OURO_SLACK_CLIENT_ID: SLACK_APP.clientId,
      OURO_SLACK_CLIENT_SECRET: SLACK_APP.clientSecret,
      OURO_SLACK_SIGNING_SECRET: SLACK_APP.signingSecret,
    };
  }

  /** The provider override that gives the application the real client, over {@link fetch}. */
  get provider(): ProviderOverride {
    return { provide: SLACK_API, useValue: new HttpSlackApi(this.fetch) };
  }

  /**
   * The fetch the application's Slack client calls through: Slack's two hosts go to the
   * receiver, and nothing else goes anywhere.
   */
  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));

    if (url.href.startsWith(`${SLACK_API_URL}/`)) {
      return fetch(`${this.origin}/api/${url.pathname.slice("/api/".length)}`, init);
    }
    if (url.protocol === "https:" && url.hostname === "hooks.slack.com") {
      return fetch(`${this.origin}/hooks${url.pathname}${url.search}`, init);
    }

    this.escaped.push(url.href);
    throw new Error(`The Slack harness refuses a call to ${url.origin}: tests reach no network.`);
  };

  /**
   * Say where the application under test is listening, for the emitter.
   *
   * @param baseUrl - Its origin — `ApiHarness.baseUrl`.
   */
  attach(baseUrl: string): void {
    this.target = baseUrl;
  }

  /* ------------------------------------------------------------------ the world */

  /**
   * Declare a Slack workspace.
   *
   * @param team - The workspace.
   * @returns The same team, for the caller to keep.
   */
  team(team: HarnessTeam): HarnessTeam {
    this.teams.set(team.id, team);
    this.revoked.delete(team.id);

    return team;
  }

  /**
   * Mint an OAuth code that `oauth.v2.access` exchanges for a team's bot token.
   *
   * @param teamId - The workspace being installed into.
   * @returns The code Slack would hand the browser.
   */
  oauthCode(teamId: string): string {
    this.sequence += 1;

    const code = `code-${String(this.sequence)}`;

    this.codes.set(code, teamId);

    return code;
  }

  /**
   * Revoke a team's bot token: every call with it answers `invalid_auth` from now on.
   *
   * @param teamId - The workspace.
   */
  revoke(teamId: string): void {
    this.revoked.add(teamId);
  }

  /**
   * Queue answers for a method's next calls.
   *
   * @param method - The Web API method — `chat.postMessage`.
   * @param answers - What its next calls are answered with, in order.
   */
  script(method: string, ...answers: readonly Scripted[]): void {
    this.scripts.set(method, [...(this.scripts.get(method) ?? []), ...answers]);
  }

  /**
   * Forget everything recorded and scripted, and every message. Declared teams stay.
   *
   * Called between tests: the application's database is truncated, and the receiver's memory of
   * what was posted must go with it.
   */
  reset(): void {
    this.calls.length = 0;
    this.replies.length = 0;
    this.messages.length = 0;
    this.scripts.clear();
    this.codes.clear();
    this.revoked.clear();
    this.lastEvent = undefined;
  }

  /** Stop the receiver. */
  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /* ------------------------------------------------------------------ what was recorded */

  /**
   * The calls made to one method.
   *
   * @param method - The Web API method.
   * @returns Them, oldest first.
   */
  callsTo(method: string): RecordedCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  /**
   * The messages now standing in a channel — each as last edited.
   *
   * @param channel - Slack's channel id.
   * @returns Them, oldest first.
   */
  messagesIn(channel: string): PostedMessage[] {
    return this.messages.filter((message) => message.channel === channel);
  }

  /**
   * The buttons of a message, as a person would see them.
   *
   * @param message - The message.
   * @returns Each button's label, `action_id`, `value` and `url`.
   */
  buttonsOf(message: Pick<PostedMessage, "blocks" | "attachments">): {
    label: string;
    actionId: string | undefined;
    value: string | undefined;
    url: string | undefined;
  }[] {
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
   * The replies posted to one `response_url`.
   *
   * @param responseUrl - The url an emit handed out.
   * @returns Their texts, oldest first.
   */
  repliesTo(responseUrl: string | undefined): RecordedReply[] {
    return this.replies.filter((reply) => reply.url === responseUrl);
  }

  /**
   * Wait until something is true — the application works after it acknowledges.
   *
   * @param probe - Answers the value once it exists, undefined (or false) until then.
   * @param what - What is being waited for, for the failure message.
   * @returns The value.
   * @throws {Error} When it does not come true within {@link WAIT_TIMEOUT_MS}.
   */
  async waitFor<T>(
    probe: () => T | undefined | false | Promise<T | undefined | false>,
    what: string,
  ): Promise<T> {
    const deadline = Date.now() + WAIT_TIMEOUT_MS;

    for (;;) {
      const value = await probe();

      if (value !== undefined && value !== false) {
        return value;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out after ${String(WAIT_TIMEOUT_MS)}ms waiting for ${what}.`);
      }

      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }

  /**
   * Wait for the nth reply to a `response_url`.
   *
   * @param responseUrl - The url an emit handed out.
   * @param count - How many replies to wait for. The first by default.
   * @returns That reply.
   */
  async reply(responseUrl: string | undefined, count = 1): Promise<RecordedReply> {
    return this.waitFor(
      () => this.repliesTo(responseUrl)[count - 1],
      `reply ${String(count)} to ${responseUrl ?? "no response_url"}`,
    );
  }

  /** @throws {Error} When the application tried to reach an address that is not the harness. */
  assertNoEscapes(): void {
    if (this.escaped.length > 0) {
      throw new Error(`The application called outside the harness: ${this.escaped.join(", ")}`);
    }
  }

  /* ------------------------------------------------------------------ the emitter */

  /**
   * Send a signed request to the application, as Slack would.
   *
   * @param path - The inbound route.
   * @param body - The exact bytes to sign.
   * @param contentType - The body's media type.
   * @param tamper - How the request departs from an honest one.
   * @returns The application's answer and how long it took.
   */
  async send(
    path: string,
    body: string,
    contentType: string,
    tamper: Tamper = {},
  ): Promise<{ response: request.Response; ackMs: number }> {
    if (this.target === undefined) {
      throw new Error("SlackHarness.attach(baseUrl) must be called before anything is emitted.");
    }

    const timestamp = tamper.timestamp ?? String(Math.floor(Date.now() / 1000));
    const signature =
      tamper.signature ??
      slackSignature(tamper.secret ?? SLACK_APP.signingSecret, timestamp, Buffer.from(body));
    const omitted = new Set(tamper.omit ?? []);
    let pending = request(this.target).post(path).set("Content-Type", contentType);

    if (!omitted.has("timestamp")) {
      pending = pending.set(SLACK_TIMESTAMP_HEADER, timestamp);
    }
    if (!omitted.has("signature")) {
      pending = pending.set(SLACK_SIGNATURE_HEADER, signature);
    }

    const started = performance.now();
    const response = await pending.send(tamper.sentBody ?? body);

    return { response, ackMs: performance.now() - started };
  }

  /**
   * Emit an Events API delivery.
   *
   * @param event - The outer event body — `{type, team_id, event_id, event}`.
   * @param tamper - How the request departs from an honest one.
   * @returns The acknowledgement.
   */
  async emitEvent(event: Record<string, unknown>, tamper: Tamper = {}): Promise<Emitted> {
    this.lastEvent = event;

    return {
      ...(await this.send(SLACK_EVENTS, JSON.stringify(event), "application/json", tamper)),
      responseUrl: undefined,
    };
  }

  /**
   * Send the last event again, freshly signed — Slack's redelivery.
   *
   * @returns The acknowledgement.
   * @throws {Error} When no event has been emitted.
   */
  async redeliver(): Promise<Emitted> {
    if (this.lastEvent === undefined) {
      throw new Error("There is no event to redeliver.");
    }

    return this.emitEvent(this.lastEvent);
  }

  /**
   * Emit the `/ouro` slash command.
   *
   * @param command - Who typed what, where.
   * @param tamper - How the request departs from an honest one.
   * @returns The acknowledgement and the `response_url` the result will be posted to.
   */
  async emitCommand(command: EmittedCommand, tamper: Tamper = {}): Promise<Emitted> {
    const responseUrl = this.responseUrl();
    const team = this.teams.get(command.team);
    const body = new URLSearchParams({
      command: "/ouro",
      text: command.text,
      team_id: command.team,
      user_id: command.user,
      channel_id: command.channel ?? team?.channels[0]?.id ?? "",
      response_url: responseUrl,
      trigger_id: `trigger-${String(this.sequence)}`,
    }).toString();

    return {
      ...(await this.send(SLACK_COMMANDS, body, "application/x-www-form-urlencoded", tamper)),
      responseUrl,
    };
  }

  /**
   * Emit a button press (`block_actions`).
   *
   * @param press - Who pressed what, on which message.
   * @param tamper - How the request departs from an honest one.
   * @returns The acknowledgement and the `response_url` the result will be posted to.
   */
  async emitPress(press: EmittedPress, tamper: Tamper = {}): Promise<Emitted> {
    const responseUrl = this.responseUrl();
    const payload = {
      type: "block_actions",
      team: { id: press.team },
      user: { id: press.user },
      response_url: responseUrl,
      actions: [{ type: "button", action_id: press.action.actionId, value: press.action.value }],
      ...(press.message === null
        ? {}
        : {
            channel: { id: press.message.channel },
            message: { ts: press.message.ts },
            container: { channel_id: press.message.channel, message_ts: press.message.ts },
          }),
    };
    const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();

    return {
      ...(await this.send(SLACK_INTERACTIVITY, body, "application/x-www-form-urlencoded", tamper)),
      responseUrl,
    };
  }

  /** @returns A fresh `response_url`, on the host the client is willing to post to. */
  private responseUrl(): string {
    this.sequence += 1;

    return `${RESPONSE_URL_BASE}/${String(this.sequence)}`;
  }

  /* ------------------------------------------------------------------ the receiver */

  /**
   * Answer one request to the receiver.
   *
   * @param incoming - The request.
   * @param outgoing - Its response.
   */
  private async handle(incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];

    for await (const chunk of incoming) {
      chunks.push(chunk as Buffer);
    }

    const raw = Buffer.concat(chunks).toString("utf8");
    const path = (incoming.url ?? "").split("?")[0] ?? "";

    if (path.startsWith("/hooks/")) {
      this.replies.push({
        url: `https://hooks.slack.com${(incoming.url ?? "").slice("/hooks".length)}`,
        body: JSON.parse(raw) as Record<string, unknown>,
      });
      outgoing.writeHead(200, { "content-type": "text/plain" }).end("ok");

      return;
    }

    const method = path.replace(/^\/api\//, "");
    const form = formOf(raw);
    const token = /^Bearer (.+)$/.exec(incoming.headers.authorization ?? "")?.[1];
    const scripted = this.scripts.get(method)?.shift();
    let status = 200;
    let answer: Record<string, unknown>;
    const headers: Record<string, string> = { "content-type": "application/json" };

    if (scripted !== undefined && "rateLimit" in scripted) {
      status = 429;
      headers["retry-after"] = String(scripted.rateLimit);
      answer = { ok: false, error: "ratelimited" };
    } else if (scripted !== undefined && "error" in scripted) {
      answer = { ok: false, error: scripted.error };
    } else {
      if (scripted !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, scripted.delayMs));
      }
      answer = this.answer(method, token, form);
    }

    this.calls.push({ method, token, form, status, answer });
    outgoing.writeHead(status, headers).end(JSON.stringify(answer));
  }

  /**
   * What a Web API method answers, from the declared world.
   *
   * @param method - The method.
   * @param token - The bearer token it carried.
   * @param form - Its fields.
   * @returns Slack's answer body.
   */
  private answer(
    method: string,
    token: string | undefined,
    form: Record<string, string>,
  ): Record<string, unknown> {
    if (method === "oauth.v2.access") {
      const team = this.teams.get(this.codes.get(form.code ?? "") ?? "");

      if (form.client_id !== SLACK_APP.clientId || form.client_secret !== SLACK_APP.clientSecret) {
        return { ok: false, error: "invalid_client_id" };
      }
      if (team === undefined) {
        return { ok: false, error: "invalid_code" };
      }

      // A code is exchanged once.
      this.codes.delete(form.code ?? "");

      return {
        ok: true,
        access_token: team.botToken,
        bot_user_id: team.botUserId,
        app_id: "A0BZ6HARNESS",
        scope: (team.scopes ?? DEFAULT_SCOPES).join(","),
        team: { id: team.id, name: team.name },
        authed_user: { id: team.users[0]?.id },
      };
    }

    const team = [...this.teams.values()].find((known) => known.botToken === token);

    if (team === undefined || this.revoked.has(team.id)) {
      return { ok: false, error: "invalid_auth" };
    }

    switch (method) {
      case "auth.test":
        return { ok: true, team_id: team.id, user_id: team.botUserId };
      case "conversations.list":
        return {
          ok: true,
          channels: team.channels.map((channel) => ({
            id: channel.id,
            name: channel.name,
            is_private: channel.isPrivate ?? false,
            is_member: channel.isMember ?? true,
            is_archived: channel.isArchived ?? false,
            num_members: channel.members ?? 3,
          })),
          response_metadata: { next_cursor: "" },
        };
      case "users.info": {
        const user = team.users.find((known) => known.id === form.user);

        return user === undefined
          ? { ok: false, error: "user_not_found" }
          : {
              ok: true,
              user: {
                id: user.id,
                name: user.name,
                profile: { display_name: user.name, real_name: user.name, email: user.email },
              },
            };
      }
      case "conversations.open":
        return team.users.some((known) => known.id === form.users)
          ? { ok: true, channel: { id: `D${(form.users ?? "").slice(1)}` } }
          : { ok: false, error: "user_not_found" };
      case "chat.postMessage": {
        this.sequence += 1;

        const ts = `17000000${String(this.sequence).padStart(2, "0")}.000100`;

        this.messages.push({
          team: team.id,
          channel: form.channel ?? "",
          ts,
          edits: 0,
          text: form.text ?? "",
          blocks: listOf(form.blocks),
          attachments: listOf(form.attachments),
        });

        return { ok: true, channel: form.channel, ts };
      }
      case "chat.update": {
        const at = this.messages.findIndex(
          (message) => message.channel === form.channel && message.ts === form.ts,
        );
        const standing = this.messages[at];

        if (standing === undefined) {
          return { ok: false, error: "message_not_found" };
        }

        this.messages[at] = {
          ...standing,
          edits: standing.edits + 1,
          text: form.text ?? "",
          blocks: listOf(form.blocks),
          attachments: listOf(form.attachments),
        };

        return { ok: true, channel: form.channel, ts: form.ts };
      }
      default:
        return { ok: false, error: "unknown_method" };
    }
  }
}
