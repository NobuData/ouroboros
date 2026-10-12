/**
 * The few things this service asks of Slack, as a port (BZ.1,
 * [#535](https://github.com/NobuData/ouroboros/issues/535)).
 *
 * No Slack SDK: the install, the linking flow and the acknowledgements need six calls, each one
 * HTTPS request, and a port this small is what lets every test run against a fake
 * (`slack.client.fixture.ts`). BZ.2's publisher (#536) will widen it; nothing here posts a card.
 *
 * **A failed call is a value.** Every method answers `{ok: false, error}` with Slack's own
 * error code rather than throwing, because two of those codes — `invalid_auth`,
 * `token_revoked` and their kin ({@link REVOKED_ERRORS}) — are not failures to retry but the
 * platform saying the install is over, and the caller has to be able to tell them apart.
 */

import { Injectable } from "@nestjs/common";

import { SLACK_API_URL } from "./slack.app";

/** The injection token for {@link SlackApi}. */
export const SLACK_API = Symbol("SLACK_API");

/** How long one call to Slack may take. Inside Slack's own 3-second acknowledgement window. */
export const SLACK_CALL_TIMEOUT_MS = 2500;

/**
 * Slack's error codes that mean *this token no longer works and will not again* — the app was
 * removed, the token revoked, or the workspace deactivated. A connection that meets one is
 * flipped to `revoked`, and nothing retries.
 */
export const REVOKED_ERRORS: ReadonlySet<string> = new Set([
  "invalid_auth",
  "token_revoked",
  "account_inactive",
  "token_expired",
  "not_authed",
]);

/** A call's answer: what was asked for, or Slack's error code. */
export type SlackResult<T> =
  ({ readonly ok: true } & T) | { readonly ok: false; readonly error: string };

/** What `oauth.v2.access` grants. */
export interface SlackInstallGrant {
  /** The bot token (`xoxb-…`) — sealed at once, never logged. */
  readonly botToken: string;
  readonly botUserId: string;
  /** The Slack app's id (`A07…`). */
  readonly appId: string;
  /** The scopes Slack actually granted, which may be fewer than were asked for. */
  readonly scopes: readonly string[];
  /** The Slack workspace's id (`T024AB`) and name. */
  readonly teamId: string;
  readonly teamName: string;
  /** The Slack user who approved the install. */
  readonly installerUserId: string | null;
}

/** One conversation `conversations.list` reports. */
export interface SlackChannelSummary {
  readonly id: string;
  /** Without the leading `#`, as Slack reports it. */
  readonly name: string;
  readonly isPrivate: boolean;
  /** Whether the bot is a member — it cannot post otherwise. */
  readonly isMember: boolean;
  readonly isArchived: boolean;
  readonly memberCount: number | null;
}

/** What `users.info` says about one person. */
export interface SlackUserProfile {
  readonly id: string;
  /** The display name, falling back to the real name. */
  readonly displayName: string;
  /** The profile email — needs `users:read.email`, and is an assist, never proof. */
  readonly email: string | null;
}

/** A reply to an interaction or a slash command, sent to its `response_url`. */
export interface SlackReply {
  /** The text shown. */
  readonly text: string;
  /** Only the person who acted sees it. Every reply this module sends is. */
  readonly ephemeral: true;
  /** A single link button under the text, when the reply offers one. */
  readonly link?: { readonly label: string; readonly url: string };
}

/** The calls. */
export interface SlackApi {
  /**
   * Exchange an OAuth code for a workspace's bot token.
   *
   * @param input - The app's credentials, the code and the redirect URI the install began with.
   * @returns The grant, or Slack's error.
   */
  exchangeCode(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<SlackResult<{ grant: SlackInstallGrant }>>;

  /**
   * Ask whether a bot token still works.
   *
   * @param botToken - The token.
   * @returns The workspace it belongs to, or Slack's error — a {@link REVOKED_ERRORS} member
   *   when the install is over.
   */
  authTest(botToken: string): Promise<SlackResult<{ teamId: string; botUserId: string }>>;

  /**
   * List the workspace's public and private channels.
   *
   * @param botToken - The token.
   * @returns Every channel, across pages, or Slack's error.
   */
  listChannels(
    botToken: string,
  ): Promise<SlackResult<{ channels: readonly SlackChannelSummary[] }>>;

  /**
   * Read one person's profile.
   *
   * @param botToken - The token.
   * @param userId - The Slack user's id.
   * @returns Their display name and, if granted, email — or Slack's error.
   */
  userProfile(botToken: string, userId: string): Promise<SlackResult<{ user: SlackUserProfile }>>;

  /**
   * Open a Socket Mode connection.
   *
   * @param appToken - The app-level token (`xapp-…`).
   * @returns The WebSocket URL to connect to, or Slack's error.
   */
  openSocket(appToken: string): Promise<SlackResult<{ url: string }>>;

  /**
   * Answer an interaction or a slash command after its acknowledgement.
   *
   * @param responseUrl - The `response_url` Slack sent with it. Only `https://hooks.slack.com`
   *   is ever posted to.
   * @param reply - What to show the person who acted.
   * @returns Whether Slack took it.
   */
  respond(responseUrl: string, reply: SlackReply): Promise<SlackResult<object>>;
}

/** Hosts a `response_url` may name. Anything else is not Slack's and is not posted to. */
const RESPONSE_HOSTS: ReadonlySet<string> = new Set(["hooks.slack.com", "hooks.slack-gov.com"]);

/**
 * A reply as the Block Kit payload Slack takes.
 *
 * @param reply - The reply.
 * @returns The body to post to a `response_url`.
 */
export function replyPayload(reply: SlackReply): Record<string, unknown> {
  const blocks: Record<string, unknown>[] = [
    { type: "section", text: { type: "mrkdwn", text: reply.text } },
  ];

  if (reply.link !== undefined) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: reply.link.label },
          url: reply.link.url,
        },
      ],
    });
  }

  return { response_type: "ephemeral", replace_original: false, text: reply.text, blocks };
}

/**
 * A string field of an untyped object.
 *
 * @param source - What Slack answered.
 * @param key - The field.
 * @returns The string, or undefined when absent or of another type.
 */
function text(source: unknown, key: string): string | undefined {
  if (typeof source !== "object" || source === null) {
    return undefined;
  }

  const value = (source as Record<string, unknown>)[key];

  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * An object field of an untyped object.
 *
 * @param source - What Slack answered.
 * @param key - The field.
 * @returns The object, or undefined.
 */
function part(source: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof source !== "object" || source === null) {
    return undefined;
  }

  const value = (source as Record<string, unknown>)[key];

  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** {@link SlackApi} over HTTPS. */
@Injectable()
export class HttpSlackApi implements SlackApi {
  /** @param fetchImpl - The fetch to call through; the platform's by default. */
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  /** @inheritdoc */
  async exchangeCode(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<SlackResult<{ grant: SlackInstallGrant }>> {
    const answer = await this.call("oauth.v2.access", {
      form: {
        client_id: input.clientId,
        client_secret: input.clientSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
      },
    });

    if (!answer.ok) {
      return answer;
    }

    const botToken = text(answer.body, "access_token");
    const botUserId = text(answer.body, "bot_user_id");
    const appId = text(answer.body, "app_id");
    const teamId = text(part(answer.body, "team"), "id");
    const teamName = text(part(answer.body, "team"), "name");

    // A user-token-only grant, or an Enterprise Grid org install, has no bot token or team.
    if (
      botToken === undefined ||
      botUserId === undefined ||
      appId === undefined ||
      teamId === undefined ||
      teamName === undefined
    ) {
      return { ok: false, error: "incomplete_grant" };
    }

    return {
      ok: true,
      grant: {
        botToken,
        botUserId,
        appId,
        teamId,
        teamName,
        scopes: (text(answer.body, "scope") ?? "").split(",").filter((scope) => scope !== ""),
        installerUserId: text(part(answer.body, "authed_user"), "id") ?? null,
      },
    };
  }

  /** @inheritdoc */
  async authTest(botToken: string): Promise<SlackResult<{ teamId: string; botUserId: string }>> {
    const answer = await this.call("auth.test", { token: botToken });

    if (!answer.ok) {
      return answer;
    }

    const teamId = text(answer.body, "team_id");
    const botUserId = text(answer.body, "user_id");

    return teamId === undefined || botUserId === undefined
      ? { ok: false, error: "incomplete_answer" }
      : { ok: true, teamId, botUserId };
  }

  /** @inheritdoc */
  async listChannels(
    botToken: string,
  ): Promise<SlackResult<{ channels: readonly SlackChannelSummary[] }>> {
    const channels: SlackChannelSummary[] = [];
    let cursor = "";

    // Bounded: twenty pages of two hundred is more channels than a picker can show, and a
    // cursor Slack never empties must not hold a request open.
    for (let page = 0; page < 20; page += 1) {
      const answer = await this.call("conversations.list", {
        token: botToken,
        form: {
          types: "public_channel,private_channel",
          exclude_archived: "false",
          limit: "200",
          ...(cursor === "" ? {} : { cursor }),
        },
      });

      if (!answer.ok) {
        return answer;
      }

      const listed = (answer.body as Record<string, unknown>).channels;

      for (const channel of Array.isArray(listed) ? listed : []) {
        const id = text(channel, "id");
        const name = text(channel, "name");

        if (id === undefined || name === undefined) {
          continue;
        }

        const row = channel as Record<string, unknown>;

        channels.push({
          id,
          name,
          isPrivate: row.is_private === true,
          isMember: row.is_member === true,
          isArchived: row.is_archived === true,
          memberCount: typeof row.num_members === "number" ? row.num_members : null,
        });
      }

      cursor = text(part(answer.body, "response_metadata"), "next_cursor") ?? "";

      if (cursor === "") {
        break;
      }
    }

    return { ok: true, channels };
  }

  /** @inheritdoc */
  async userProfile(
    botToken: string,
    userId: string,
  ): Promise<SlackResult<{ user: SlackUserProfile }>> {
    const answer = await this.call("users.info", { token: botToken, form: { user: userId } });

    if (!answer.ok) {
      return answer;
    }

    const user = part(answer.body, "user");
    const profile = part(user, "profile");
    const displayName =
      text(profile, "display_name") ?? text(profile, "real_name") ?? text(user, "name");

    return displayName === undefined
      ? { ok: false, error: "incomplete_answer" }
      : { ok: true, user: { id: userId, displayName, email: text(profile, "email") ?? null } };
  }

  /** @inheritdoc */
  async openSocket(appToken: string): Promise<SlackResult<{ url: string }>> {
    const answer = await this.call("apps.connections.open", { token: appToken });

    if (!answer.ok) {
      return answer;
    }

    const url = text(answer.body, "url");

    return url === undefined ? { ok: false, error: "incomplete_answer" } : { ok: true, url };
  }

  /** @inheritdoc */
  async respond(responseUrl: string, reply: SlackReply): Promise<SlackResult<object>> {
    let target: URL;

    try {
      target = new URL(responseUrl);
    } catch {
      return { ok: false, error: "response_url_malformed" };
    }

    if (target.protocol !== "https:" || !RESPONSE_HOSTS.has(target.hostname)) {
      return { ok: false, error: "response_url_not_slack" };
    }

    try {
      const response = await this.fetchImpl(target, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(replyPayload(reply)),
        signal: AbortSignal.timeout(SLACK_CALL_TIMEOUT_MS),
      });

      return response.ok ? { ok: true } : { ok: false, error: `http_${response.status}` };
    } catch {
      return { ok: false, error: "unreachable" };
    }
  }

  /**
   * Call one Web API method.
   *
   * @param method - The method name, e.g. `auth.test`.
   * @param request - The bearer token, when the method takes one, and its form fields.
   * @returns Slack's answer body when it says `ok`, else its error code. A network failure, a
   *   non-JSON answer and a timeout are `unreachable` — never a rejection.
   */
  private async call(
    method: string,
    request: { token?: string; form?: Record<string, string> },
  ): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
    try {
      const response = await this.fetchImpl(`${SLACK_API_URL}/${method}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          ...(request.token === undefined ? {} : { authorization: `Bearer ${request.token}` }),
        },
        body: new URLSearchParams(request.form ?? {}).toString(),
        signal: AbortSignal.timeout(SLACK_CALL_TIMEOUT_MS),
      });
      const body: unknown = await response.json();

      if (typeof body === "object" && body !== null && (body as { ok?: unknown }).ok === true) {
        return { ok: true, body };
      }

      return { ok: false, error: text(body, "error") ?? `http_${response.status}` };
    } catch {
      return { ok: false, error: "unreachable" };
    }
  }
}
