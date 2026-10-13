"use server";

/**
 * What the Chat Ops page asks the service to do (CA.1,
 * [#541](https://github.com/NobuData/ouroboros/issues/541)): verify the connection, list the
 * channels from Slack again, bind a channel to a purpose and unbind it. Each answers the fresh
 * payload or `{ error }` rather than throwing — a refusal is something the page prints beside
 * the control that was pressed, in the service's own words, and never a spinner left turning.
 */

import { type ChannelPurpose, type SlackChannels, type SlackVerification, chatops } from "@/app/api/chatops";
import { isApiError } from "@/app/api/errors";

import type { ChatOpsOutcome } from "./view";

/**
 * Run a write, turning the service's refusal into an outcome.
 *
 * @param write The call.
 * @returns The value, or the refusal's sentence. Anything that was not an answer from the
 *   service is rethrown.
 */
async function outcomeOf<T>(write: () => Promise<T>): Promise<ChatOpsOutcome<T>> {
  try {
    return await write();
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { error: error.message };
  }
}

/**
 * Ask Slack whether the connection's token still works.
 *
 * @returns The verification — its result and the connection as it now stands — or the refusal.
 */
export async function verifyConnection(): Promise<ChatOpsOutcome<SlackVerification>> {
  return outcomeOf(() => chatops.verify());
}

/**
 * List the workspace's channels from Slack again.
 *
 * @returns The channels as Slack now lists them, or the refusal.
 */
export async function refreshChannels(): Promise<ChatOpsOutcome<SlackChannels>> {
  return outcomeOf(() => chatops.refresh());
}

/**
 * Bind a channel to a purpose.
 *
 * @param id The channel.
 * @param purpose What it is for.
 * @returns The channels with the binding made, or the refusal — for a channel the bot is not
 *   in, the service's sentence says to invite it.
 */
export async function bindChannel(id: string, purpose: ChannelPurpose): Promise<ChatOpsOutcome<SlackChannels>> {
  return outcomeOf(() => chatops.bind(id, purpose));
}

/**
 * Take a channel's purpose away.
 *
 * @param id The channel.
 * @returns The channels with the binding gone, or the refusal.
 */
export async function unbindChannel(id: string): Promise<ChatOpsOutcome<SlackChannels>> {
  return outcomeOf(() => chatops.unbind(id));
}
