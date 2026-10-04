/**
 * The webhook management routes' refusals (BR.3, [#487](https://github.com/NobuData/ouroboros/issues/487)).
 *
 * **No refusal carries a secret.** Each takes only ids, names, hosts and codes — there is no
 * parameter a signing secret could be passed to, so *a secret is never in an error message* holds
 * at every call site by construction (`webhooks.secrecy.spec.ts` greps it too).
 */

import { ConflictError, InvalidRequestError, NotFoundError } from "../errors/error.envelope";
import type { SsrfRefusal } from "./webhook.ssrf";

/** Every code this module raises. */
export const WEBHOOK_ERRORS = {
  notFound: "webhook_not_found",
  nameTaken: "webhook_name_taken",
  siemTaken: "webhook_siem_taken",
  siemRequiresAudit: "webhook_siem_requires_audit",
  targetRefused: "webhook_target_refused",
  subscriptionInvalid: "webhook_subscription_invalid",
  registryVersionUnknown: "webhook_registry_version_unknown",
  deliveryNotFound: "webhook_delivery_not_found",
  notRedeliverable: "webhook_delivery_not_redeliverable",
} as const;

/**
 * No such endpoint in this workspace.
 *
 * @param id - The id asked for.
 * @returns A `404`.
 */
export function webhookNotFound(id: string): NotFoundError {
  return new NotFoundError(WEBHOOK_ERRORS.notFound, "No such webhook endpoint.", { id });
}

/**
 * The workspace already has an endpoint of this name — names are what the delivery log shows.
 *
 * @param name - The name.
 * @returns A `409`.
 */
export function webhookNameTaken(name: string): ConflictError {
  return new ConflictError(
    WEBHOOK_ERRORS.nameTaken,
    `This workspace already has a webhook endpoint named ${name}.`,
    { name },
  );
}

/**
 * The workspace already has a SIEM route; there is one, so "the SIEM" has one answer.
 *
 * @param existingId - The current SIEM endpoint.
 * @returns A `409`.
 */
export function webhookSiemTaken(existingId: string): ConflictError {
  return new ConflictError(
    WEBHOOK_ERRORS.siemTaken,
    "This workspace already streams to a SIEM endpoint. Unmark that one first.",
    { existingId },
  );
}

/**
 * A SIEM route must subscribe to the audit trail.
 *
 * @returns A `422`.
 */
export function webhookSiemRequiresAudit(): InvalidRequestError {
  return new InvalidRequestError(
    WEBHOOK_ERRORS.siemRequiresAudit,
    "A SIEM endpoint must subscribe to audit.*.",
    { field: "eventFamilies" },
  );
}

/**
 * The URL policy refused the target.
 *
 * @param reason - The refusal code.
 * @param target - The host or address refused — never a path or query.
 * @returns A `422`.
 */
export function webhookTargetRefused(reason: SsrfRefusal, target: string): InvalidRequestError {
  return new InvalidRequestError(
    WEBHOOK_ERRORS.targetRefused,
    reason === "internal_address"
      ? `${target} is an internal address. Ask your operator to allow it in OURO_WEBHOOK_INTERNAL_ALLOWLIST if it is a genuine internal collector.`
      : `The webhook URL was refused (${reason}).`,
    { field: "url", reason, target },
  );
}

/**
 * A subscription entry is not a family wildcard or a registered type.
 *
 * @param problems - One sentence per refused entry.
 * @returns A `422`.
 */
export function webhookSubscriptionInvalid(problems: readonly string[]): InvalidRequestError {
  return new InvalidRequestError(WEBHOOK_ERRORS.subscriptionInvalid, problems.join("; "), {
    field: "eventFamilies",
  });
}

/**
 * The registry has no such version.
 *
 * @param version - The version asked for.
 * @param latest - The newest.
 * @returns A `422`.
 */
export function webhookRegistryVersionUnknown(
  version: number,
  latest: number,
): InvalidRequestError {
  return new InvalidRequestError(
    WEBHOOK_ERRORS.registryVersionUnknown,
    `The event registry has versions 1 to ${String(latest)}.`,
    { field: "registryVersion", version, latest },
  );
}

/**
 * No such delivery for this endpoint.
 *
 * @param id - The delivery asked for.
 * @returns A `404`.
 */
export function webhookDeliveryNotFound(id: string): NotFoundError {
  return new NotFoundError(WEBHOOK_ERRORS.deliveryNotFound, "No such webhook delivery.", { id });
}

/**
 * Only the latest attempt at an event, once dead-lettered, can be redelivered.
 *
 * @param id - The delivery.
 * @param status - Its status.
 * @returns A `409`.
 */
export function webhookNotRedeliverable(id: string, status: string): ConflictError {
  return new ConflictError(
    WEBHOOK_ERRORS.notRedeliverable,
    "Only a dead-lettered delivery with no later attempt can be redelivered.",
    { id, status },
  );
}
