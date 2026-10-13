"use server";

/**
 * What the Chat Ops page's routing card asks the service to do (CA.3,
 * [#543](https://github.com/NobuData/ouroboros/issues/543)): switch a route on or off, point it
 * at another bound channel, and designate who **+ DM on-call** reaches.
 *
 * The routes are #488's — the same `PATCH /api/v1/settings/notifications/{kind}` Settings →
 * Notifications saves through — so this card and that one are two views of one store. Each
 * action answers the resource as it now stands or `{ error }` rather than throwing: a refusal is
 * printed on the row whose control was pressed, in the service's own words.
 *
 * **The role gate is the service's.** A Server Action is a POST anybody can reach; both routes
 * are an `owner`'s or an `admin`'s.
 */

import { type ChatOnCall, chatops } from "@/app/api/chatops";
import { isApiError } from "@/app/api/errors";
import { type NotificationRoute, settingsIntegrations } from "@/app/api/settings-integrations";

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
 * Switch a route on or off.
 *
 * @param kind The route.
 * @param enabled Whether the workspace wants it.
 * @returns The route as it now stands, or the refusal — switching on a route with no channel is
 *   the service's to refuse, and its sentence says so.
 */
export async function setRouteEnabled(kind: string, enabled: boolean): Promise<ChatOpsOutcome<NotificationRoute>> {
  return outcomeOf(() => settingsIntegrations.updateRoute(kind, { enabled }));
}

/**
 * Point a route at a bound channel.
 *
 * @param kind The route.
 * @param chatChannelId The bound channel.
 * @returns The route as it now stands, or the refusal.
 */
export async function setRouteChannel(
  kind: string,
  chatChannelId: string,
): Promise<ChatOpsOutcome<NotificationRoute>> {
  return outcomeOf(() => settingsIntegrations.updateRoute(kind, { chatChannelId }));
}

/**
 * Designate the on-call member, or nobody.
 *
 * @param memberId The member; null removes the designee.
 * @returns The on-call resource as it now stands, or the refusal.
 */
export async function setOnCall(memberId: string | null): Promise<ChatOpsOutcome<ChatOnCall>> {
  return outcomeOf(() => chatops.setOnCall(memberId));
}
