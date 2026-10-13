import "server-only";

/**
 * The Slack plane, as the Chat Ops page calls it (CA.1,
 * [#541](https://github.com/NobuData/ouroboros/issues/541)) — one page's calls to one tag, kept
 * together the way `app/api/research.ts` keeps the research plane's.
 *
 * Nine operations: the **connection**, its **verification** (BZ.1,
 * [#535](https://github.com/NobuData/ouroboros/issues/535)) and the **retry** of what it could not
 * deliver (CA.5, #545), and the workspace's **channels** —
 * listed, re-listed from Slack, bound to a purpose and unbound (#541's own routes) — and the
 * **on-call designee** the routing card names and changes (#543).
 *
 * ### The workspace is the session's
 * No call names a workspace. Any member reads the connection and the channels; verifying,
 * re-listing, binding and unbinding are an `owner`'s or an `admin`'s — decided by the service,
 * whose refusal the page prints rather than pre-empts.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** Where Slack stands for the workspace — `openapi.yaml` § `SlackConnection`. */
export type SlackConnection = components["schemas"]["SlackConnection"];

/** How the messages published through the connection are faring — `openapi.yaml` § `SlackDelivery`. */
export type SlackDelivery = components["schemas"]["SlackDelivery"];

/** What a verification answers: its result, and the connection as it now stands. */
export type SlackVerification = components["schemas"]["SlackVerification"];

/** One channel of the connected Slack workspace — `openapi.yaml` § `SlackChannel`. */
export type SlackChannel = components["schemas"]["SlackChannel"];

/** The workspace's channels, as last listed from Slack — `openapi.yaml` § `SlackChannels`. */
export type SlackChannels = components["schemas"]["SlackChannels"];

/** What a channel is bound for — which default routes point at it. */
export type ChannelPurpose = NonNullable<SlackChannel["purpose"]>;

/** Who a route's **+ DM on-call** reaches, and who could be designated instead. */
export type ChatOnCall = components["schemas"]["OnCall"];

/** The Slack connection and its channels, as `ouroboros-rest` serves them. */
export const chatops = {
  /**
   * Where Slack stands for the workspace.
   *
   * @param client The client to call through. Defaults to the server-side one.
   * @param signal Aborts the read.
   * @returns The connection — its state, its app, its scopes and its last verification.
   * @throws {ApiError} What the service answered.
   */
  async connection(client: ApiClient = api(), signal?: AbortSignal): Promise<SlackConnection> {
    return unwrap(await client.GET("/api/v1/slack/connection", { signal }));
  },

  /**
   * Ask Slack whether the connection's token still works.
   *
   * @param client The client to call through.
   * @returns The result, and the connection as it now stands.
   * @throws {ApiError} `403` for a reader who is not an owner or an admin.
   */
  async verify(client: ApiClient = api()): Promise<SlackVerification> {
    return unwrap(await client.POST("/api/v1/slack/connection/verify", {}));
  },

  /**
   * Queue the connection's dead-lettered messages again (CA.5,
   * [#545](https://github.com/NobuData/ouroboros/issues/545)).
   *
   * @param client The client to call through.
   * @returns The connection as it now stands, its dead letters pending again.
   * @throws {ApiError} `409 slack_not_connected`; `403` for a reader who is not an owner or an
   *   admin.
   */
  async retryDelivery(client: ApiClient = api()): Promise<SlackConnection> {
    return unwrap(await client.POST("/api/v1/slack/connection/delivery/retry", {}));
  },

  /**
   * The workspace's channels, as last listed.
   *
   * @param client The client to call through.
   * @param signal Aborts the read.
   * @returns The channels and when they were listed.
   * @throws {ApiError} What the service answered.
   */
  async channels(client: ApiClient = api(), signal?: AbortSignal): Promise<SlackChannels> {
    return unwrap(await client.GET("/api/v1/slack/channels", { signal }));
  },

  /**
   * List the channels from Slack again — how a channel the bot was just invited to shows up.
   *
   * @param client The client to call through.
   * @returns The channels, as Slack now lists them.
   * @throws {ApiError} `409 slack_not_connected`; `502` when Slack refuses; `403` for a reader
   *   who is not an owner or an admin.
   */
  async refresh(client: ApiClient = api()): Promise<SlackChannels> {
    return unwrap(await client.POST("/api/v1/slack/channels/refresh", {}));
  },

  /**
   * Bind a channel to a purpose.
   *
   * @param id The channel.
   * @param purpose What it is for.
   * @param client The client to call through.
   * @returns The channels, with the binding made.
   * @throws {ApiError} `409 slack_channel_not_joined` when the bot is not in the channel,
   *   `409 slack_channel_archived`, `409 slack_not_connected`, `404 slack_channel_not_found`,
   *   `403` for a reader who is not an owner or an admin.
   */
  async bind(id: string, purpose: ChannelPurpose, client: ApiClient = api()): Promise<SlackChannels> {
    return unwrap(
      await client.PUT("/api/v1/slack/channels/{id}/binding", {
        params: { path: { id } },
        body: { purpose },
      }),
    );
  },

  /**
   * Take a channel's purpose away.
   *
   * @param id The channel.
   * @param client The client to call through.
   * @returns The channels, with the binding gone.
   * @throws {ApiError} `404 slack_channel_not_found`; `403` for a reader who is not an owner or
   *   an admin.
   */
  async unbind(id: string, client: ApiClient = api()): Promise<SlackChannels> {
    return unwrap(
      await client.DELETE("/api/v1/slack/channels/{id}/binding", {
        params: { path: { id } },
      }),
    );
  },

  /**
   * Who the **+ DM on-call** affix reaches (CA.3,
   * [#543](https://github.com/NobuData/ouroboros/issues/543)).
   *
   * @param client The client to call through.
   * @param signal Aborts the read.
   * @returns The designee, and the members who could be designated.
   * @throws {ApiError} What the service answered.
   */
  async onCall(client: ApiClient = api(), signal?: AbortSignal): Promise<ChatOnCall> {
    return unwrap(await client.GET("/api/v1/chat/on-call", { signal }));
  },

  /**
   * Designate the on-call member, or nobody.
   *
   * @param memberId The member; null removes the designee.
   * @param client The client to call through.
   * @returns The resource as it now stands.
   * @throws {ApiError} `404 chat_member_not_found`; `422 chat_on_call_not_linked` for a member
   *   with no linked Slack identity; `403` for a reader who is not an owner or an admin.
   */
  async setOnCall(memberId: string | null, client: ApiClient = api()): Promise<ChatOnCall> {
    return unwrap(await client.PUT("/api/v1/chat/on-call", { body: { memberId } }));
  },
};
