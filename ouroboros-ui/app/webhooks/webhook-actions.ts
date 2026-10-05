"use server";

/**
 * The webhook surfaces' reads and writes, as Server Actions
 * (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495)).
 *
 * The browser cannot reach `ouroboros-rest` (`app/api/server.ts`), so the sheets call these.
 * Each turns the service's refusal into a value — `{ok: false, reason}`, with `fields` when the
 * refusal named any — so a refused write stays in the sheet with the service's sentence instead
 * of replacing the page. Anything that is not the service refusing (a redirect to sign in, a
 * dropped connection) keeps travelling.
 *
 * **Every write that lands re-reads the page** (`refresh()`), so the Integrations tile's
 * *2 active* and the Audit card's *Stream to SIEM* row say what is now true. A test ping is the
 * exception: it never counts toward an endpoint's health, so nothing on the page changed.
 *
 * **The role gate is the service's.** A Server Action is a POST anybody can reach; every route
 * behind these is owners and admins only.
 *
 * **A signing secret appears in exactly two answers** — {@link createWebhook} and
 * {@link rotateWebhookSecret} — and goes nowhere else from here.
 */

import { refresh } from "next/cache";

import { isApiError } from "@/app/api/errors";
import {
  type CreateWebhookRequest,
  type DeliveryQuery,
  type UpdateWebhookRequest,
  type WebhookDelivery,
  type WebhookDeliveryPage,
  type WebhookEndpoint,
  type WebhookList,
  type WebhookSecret,
  settingsWebhooks,
} from "@/app/api/settings-webhooks";

import {
  DELIVERIES_FAILED,
  READ_FAILED,
  WRITE_FAILED,
  type WebhookWrite,
  draftFieldErrors,
  refusalSentence,
} from "./view";

/**
 * Run one call, keeping a refusal as a value.
 *
 * @param call The call.
 * @param options.fallback What to say when the service gave no sentence.
 * @param options.writes Whether a success changed something the page draws — re-read it then.
 * @returns Its outcome.
 * @throws Anything that is not the service refusing.
 */
async function answered<T>(
  call: () => Promise<T>,
  options: { fallback: string; writes: boolean },
): Promise<WebhookWrite<T>> {
  let value: T;

  try {
    value = await call();
  } catch (error) {
    if (!isApiError(error)) throw error;

    const fields = draftFieldErrors(error.details);

    return {
      ok: false,
      reason: refusalSentence(error.message, options.fallback),
      code: error.code,
      ...(Object.keys(fields).length > 0 ? { fields } : {}),
    };
  }

  if (options.writes) refresh();

  return { ok: true, value };
}

/** A write: the default sentence, and the page re-read on success. */
const WRITE = { fallback: WRITE_FAILED, writes: true } as const;

/**
 * Read every endpoint, the active count, the SIEM row and the registry.
 *
 * @returns The list, or why it could not be read.
 */
export async function readWebhooks(): Promise<WebhookWrite<WebhookList>> {
  return answered(() => settingsWebhooks.list(), { fallback: READ_FAILED, writes: false });
}

/**
 * Create an endpoint — the answer carries its signing secret, once.
 *
 * @param body The endpoint.
 * @returns The endpoint and its secret, or why not, with errors per field.
 */
export async function createWebhook(
  body: CreateWebhookRequest,
): Promise<WebhookWrite<WebhookSecret>> {
  return answered(() => settingsWebhooks.create(body), WRITE);
}

/**
 * Edit, enable or disable an endpoint.
 *
 * @param id The endpoint.
 * @param body Only what changed.
 * @returns The endpoint as stored, or why not, with errors per field.
 */
export async function updateWebhook(
  id: string,
  body: UpdateWebhookRequest,
): Promise<WebhookWrite<WebhookEndpoint>> {
  return answered(() => settingsWebhooks.update(id, body), WRITE);
}

/**
 * Delete an endpoint and its delivery log.
 *
 * @param id The endpoint.
 * @returns Nothing, or why not.
 */
export async function deleteWebhook(id: string): Promise<WebhookWrite<null>> {
  return answered(async () => {
    await settingsWebhooks.remove(id);
    return null;
  }, WRITE);
}

/**
 * Rotate an endpoint's signing secret — the answer carries the new one, once.
 *
 * @param id The endpoint.
 * @returns The endpoint and its new secret, or why not.
 */
export async function rotateWebhookSecret(id: string): Promise<WebhookWrite<WebhookSecret>> {
  return answered(() => settingsWebhooks.rotateSecret(id), WRITE);
}

/**
 * Send a test ping now.
 *
 * @param id The endpoint.
 * @returns The delivery-log row the ping produced — succeeded or failed — or why it was not sent.
 */
export async function pingWebhook(id: string): Promise<WebhookWrite<WebhookDelivery>> {
  return answered(() => settingsWebhooks.ping(id), { fallback: WRITE_FAILED, writes: false });
}

/**
 * Read one page of an endpoint's delivery log.
 *
 * @param id The endpoint.
 * @param query The status to narrow by, and the page.
 * @returns The page, or why it could not be read.
 */
export async function readDeliveries(
  id: string,
  query: DeliveryQuery,
): Promise<WebhookWrite<WebhookDeliveryPage>> {
  return answered(() => settingsWebhooks.deliveries(id, query), {
    fallback: DELIVERIES_FAILED,
    writes: false,
  });
}

/**
 * Queue a dead-lettered event again.
 *
 * @param id The endpoint.
 * @param deliveryId The dead-lettered attempt.
 * @returns The new pending attempt, or why not.
 */
export async function redeliverDelivery(
  id: string,
  deliveryId: string,
): Promise<WebhookWrite<WebhookDelivery>> {
  return answered(() => settingsWebhooks.redeliver(id, deliveryId), WRITE);
}
