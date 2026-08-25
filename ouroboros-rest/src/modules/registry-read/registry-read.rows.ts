/**
 * The rows the composed registry read selects
 * ([#588](https://github.com/NobuData/ouroboros/issues/588)) — in a file of their own so the
 * pure derivation (`alias.health.ts`) and the mappers (`registry-read.resources.ts`) can name
 * them without importing the repository, exactly as `registry/aliases.rows.ts` does for CH.1.
 * `.dependency-cruiser.cjs` refuses the cycle that would otherwise be.
 *
 * The database's column names, per `db/schema.ts`'s rule for anything mirroring a row.
 */

import type { ProviderConnectionKind, ProviderConnectionStatus } from "../db/schema";

/**
 * One provider connection, as the registry's health cell and its provider cell need it.
 *
 * Seven columns and not the row: no `credentials_encrypted` — which
 * {@link "./registry-read.repository".RegistryReadRepository.sealedCredentials} selects alone
 * and nothing else here can see — no cap, no `added_by`, no timestamps. What a `select` cannot
 * see it cannot leak, which is the argument `provider-health/provider-health.repository.ts`
 * makes for the same table.
 */
export interface RegistryConnectionRow {
  id: string;
  kind: ProviderConnectionKind;
  display_name: string;
  /** AD.2's switch. Not health: an operator's decision that this connection may not be used. */
  enabled: boolean;
  /** Z.3's last conclusion, or `unknown` when no sweep has reached it. */
  status: ProviderConnectionStatus;
  /** When that sweep finished, or null. */
  last_checked_at: Date | null;
  /** What it measured — `{ detail: "elevated latency" }`. Read through Z.3's own reader. */
  health: Record<string, unknown>;
}

/**
 * One membership fact from AC.6's catalog — *this connection lists this model*.
 *
 * Two columns, because that is the whole question: the `model_missing` state turns on whether
 * the pair is present, and a row's display name, size and metadata belong to the surfaces that
 * draw a catalog rather than to the one that checks a set.
 */
export interface DiscoveredModelRow {
  provider_connection_id: string;
  model_id: string;
}
