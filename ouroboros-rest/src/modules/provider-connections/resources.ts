/**
 * Row → resource, for the credential lifecycle — the same seam `pricing/resources.ts` and
 * `provider-health/resources.ts` keep.
 *
 * The rows are the database's (snake_case, `Date`s, a sealed column); the resources are the
 * contract's (camelCase, ISO 8601, and exactly what `openapi.yaml` promises). Two things are
 * decided here rather than at every future call site.
 *
 * ---------------------------------------------------------------------------
 * **1. There is nowhere in this shape for a credential to go.**
 *
 * {@link ProviderConnectionResource} has no field that could hold one. What it has is
 * {@link ProviderConnectionResource.mask} — a string of four bullets and four characters,
 * computed from the plaintext by `masking.ts` and unable to be turned back into it. That is
 * AD.2 ([#223](https://github.com/NobuData/ouroboros/issues/223))'s *masked suffix only,
 * computed server-side*, made structural rather than tested for: the function that builds a
 * resource does not take an envelope and does not take a plaintext, so there is no path by
 * which one reaches a list payload.
 *
 * The contract test the ticket asks for — *greps every list and read payload for secret
 * material and finds none* — lives in `payloads.spec.ts` beside this file and in the
 * integration suite. Both are worth having: this shape is what makes the promise true, and
 * those are what keep it true when somebody adds a field.
 *
 * ---------------------------------------------------------------------------
 * **2. `null` is a value everywhere it appears, and it is never a placeholder.**
 *
 * `monthlyCapCents` null is *no cap*, which mockup 07 renders as an em-dash and which V017
 * is explicit is not the same as a cap of zero. `mask` null is *this provider needs no
 * credential* — an Ollama daemon, an unauthenticated OpenAI-compatible endpoint — which V015
 * makes an ordinary state rather than an unfinished row. `lastUsedAt` null is *never used*,
 * and AF.2 ([#235](https://github.com/NobuData/ouroboros/issues/235)) is what will ever fill
 * it in. A client that renders any of these as `0`, `""` or *unknown* is rendering something
 * this API did not say.
 */

import type { ProviderConnectionKind, ProviderConnectionStatus } from "../db/schema";
import type { ConnectionRow } from "./provider-connections.repository";

/**
 * One provider connection, as a client sees it.
 *
 * The card mockup 07 draws, minus the two things another surface already owns: the health
 * detail behind the card foot is Z.3's `/api/v1/routing/providers` strip, and the model chips
 * are AE.4's ([#230](https://github.com/NobuData/ouroboros/issues/230)) discovery. What is
 * here is what the *lifecycle* decides — which is exactly the set of things this API's five
 * writes can change.
 */
export interface ProviderConnectionResource {
  /** `provider_connections.id` — what every other operation in this module addresses. */
  readonly id: string;
  /** Which adapter reaches this provider. */
  readonly kind: ProviderConnectionKind;
  /** The card's heading. Free text, and deliberately not unique per workspace. */
  readonly displayName: string;
  /** Where the provider is, or null for one reached at a fixed public endpoint. */
  readonly baseUrl: string | null;
  /** The card's second line — *api.anthropic.com · primary coding lane* — or null. */
  readonly capabilityNote: string | null;
  /** What the last health check concluded. Z.3's, and read-only here. */
  readonly status: ProviderConnectionStatus;
  /** The card's switch: whether this connection may be used at all. */
  readonly enabled: boolean;
  /** The monthly cap in whole cents, or null for *no cap*. Warning-only until AF.4. */
  readonly monthlyCapCents: number | null;
  /**
   * `••••Xq4A`, or null when this provider needs no credential.
   *
   * The **only** thing this API will ever say about a stored credential outside `reveal`.
   * See `masking.ts` for why it is a suffix, why it is four characters, and why it is
   * computed from bytes rather than from a string.
   */
  readonly mask: string | null;
  /** `"user".id` of whoever connected it — the card's *Added by Ken* — or null. */
  readonly addedBy: string | null;
  /** When the last health check finished, ISO 8601, or null until one has. */
  readonly lastCheckedAt: string | null;
  /** When something last invoked through it, ISO 8601, or null for *never used*. */
  readonly lastUsedAt: string | null;
  /** When the connection was created, ISO 8601. */
  readonly createdAt: string;
  /** When it was last written, ISO 8601. */
  readonly updatedAt: string;
}

/**
 * What `POST /api/v1/providers/{id}/reveal` answers with.
 *
 * The one payload in this API that carries a live credential, and it is shaped to be
 * short-lived rather than merely to be a value:
 *
 *   * {@link expiresAt} is when a client should stop showing it and drop its copy. The
 *     server cannot enforce that — a value handed to a browser is in the browser — so it is
 *     an instruction rather than a guarantee, and it is published because the alternative is
 *     every client inventing its own timeout, most of them being *never*.
 *   * {@link connectionId} is echoed so a page with two reveals in flight cannot paint one
 *     provider's key onto another's row.
 *
 * The handler sets `Cache-Control: no-store` on this answer, which is the half a shape
 * cannot express.
 */
export interface RevealResource {
  /** Which connection this credential belongs to. */
  readonly connectionId: string;
  /** The credential, in the clear. The only place in this API it ever appears. */
  readonly value: string;
  /** When a client should stop displaying it and forget it, ISO 8601. */
  readonly expiresAt: string;
}

/**
 * Build the resource for one connection.
 *
 * @param row - The stored connection, as the repository's own `select` list types it. That
 *   type is the seam: `ConnectionRow` is `CONNECTION_COLUMNS`, which excludes the sealed
 *   column, so a resource cannot be built from a row that carries one. Widening what a
 *   response can hold therefore means widening a `select`, which is a reviewable edit rather
 *   than a field that quietly becomes available here.
 * @param mask - The masked credential from `masking.ts`, or null when the connection stores
 *   none. Passed in rather than derived, because deriving it needs the vault and this file
 *   holds nothing.
 * @returns The resource.
 */
export function connectionResource(
  row: ConnectionRow,
  mask: string | null,
): ProviderConnectionResource {
  return {
    id: row.id,
    kind: row.kind,
    displayName: row.display_name,
    baseUrl: row.base_url,
    capabilityNote: row.capability_note,
    status: row.status,
    enabled: row.enabled,
    monthlyCapCents: row.monthly_cap_cents,
    mask,
    addedBy: row.added_by,
    lastCheckedAt: row.last_checked_at?.toISOString() ?? null,
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
