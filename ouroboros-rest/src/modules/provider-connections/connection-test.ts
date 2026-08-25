/**
 * The card foot's answer — what **Test connection** says
 * ([#230](https://github.com/NobuData/ouroboros/issues/230), decision **P9**).
 *
 * A validation's outcome as one resource: the status the column was set to, the pill the
 * card's head draws, the note its foot prints, and the parts they were composed from. The
 * composition is `provider.adapter.ts`'s — `validationPill` and `validationNote` are the two
 * functions AC.1 wrote so every adapter's answer becomes the same two lines — and this file
 * only carries their answers across the wire beside the facts, so a card can draw the note
 * whole *and* tell a `503` from a `401` without parsing it.
 *
 * **A failure carries no latency**, and that is not an omission. `ProviderValidationFailure`
 * has no such field, for the reason `provider.adapter.ts` gives at length: a timing on a
 * request that did not succeed measures the failure, not the provider. `latencyMs` is
 * therefore `null` on every failure, and a client rendering `△ 503 upstream · retrying` has
 * nothing to append — which is what mockup 07 draws.
 */

import type { ProviderConnectionStatus } from "../db/schema";
import {
  validationNote,
  validationPill,
  type ProviderValidation,
} from "../providers/provider.adapter";
import {
  PROVIDER_ERROR_RETRYABLE,
  PROVIDER_ERROR_STATUS,
  type ProviderErrorClass,
  type ProviderStatusPill,
} from "../providers/provider.errors";

/** What one test found, as the card reads it. */
export interface ProviderTestResource {
  /** The connection that was tested. */
  readonly connectionId: string;
  /** When the check finished, ISO 8601 — the instant `lastCheckedAt` now carries. */
  readonly checkedAt: string;
  /** What `provider_connections.status` was set to: `active`, or `error` for every failure. */
  readonly status: ProviderConnectionStatus;
  /** The pill the card's head draws — `connected`, `degraded upstream`, `key rejected`. */
  readonly pill: ProviderStatusPill;
  /**
   * The foot's note, after the glyph — `200`, `503 upstream · retrying`, `key rejected (401)`.
   *
   * The `· retrying` is the taxonomy's word for a retryable class, appended by
   * `validationNote`; it says the condition is worth trying again, not that anything is being
   * retried. The glyph and the `· 38ms` are the card's, from `pill.tone` and `latencyMs`.
   */
  readonly note: string;
  /** Milliseconds the check took, or **null** on a failure — see this file's header. */
  readonly latencyMs: number | null;
  /** Which of the taxonomy's five a failure was, or null on a success. */
  readonly errorClass: ProviderErrorClass | null;
  /** Whether trying again could plausibly succeed without anybody changing anything. */
  readonly retryable: boolean;
  /** The adapter's own phrase, unchanged — what `note` was composed from. */
  readonly detail: string;
}

/**
 * A validation as the resource.
 *
 * @param connectionId - The connection that was tested.
 * @param validation - What the adapter found.
 * @param at - When the check finished.
 * @returns The resource.
 */
export function testResource(
  connectionId: string,
  validation: ProviderValidation,
  at: Date,
): ProviderTestResource {
  const failed = validation.status === "failed";

  return {
    connectionId,
    checkedAt: at.toISOString(),
    status: failed ? PROVIDER_ERROR_STATUS[validation.errorClass] : "active",
    pill: validationPill(validation),
    note: validationNote(validation),
    latencyMs: failed ? null : validation.latencyMs,
    errorClass: failed ? validation.errorClass : null,
    retryable: failed ? PROVIDER_ERROR_RETRYABLE[validation.errorClass] : false,
    detail: validation.detail,
  };
}
