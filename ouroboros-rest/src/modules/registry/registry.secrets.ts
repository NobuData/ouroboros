/**
 * `provider_connections.credentials_encrypted`, seen from the vault's re-encryption sweep.
 *
 * The store `vault.module.ts` has been waiting for. Its header names Q.1 (#138), K.3 (#101)
 * and **Y.1 ([#189](https://github.com/NobuData/ouroboros/issues/189))** as the three
 * tickets that each bring theirs, and `VAULT_SECRET_STORES` has been bound to an empty array
 * until now because no table in this schema held a sealed value. V015's column is the first,
 * and this is what makes the sweep know about it.
 *
 * ---------------------------------------------------------------------------
 * **Why this lands with the column rather than with the first thing that writes one.**
 *
 * Nothing stores a provider credential yet — AD.2
 * ([#223](https://github.com/NobuData/ouroboros/issues/223)) owns that lifecycle. It would
 * be reasonable to think a store for rows that do not exist is premature, and the opposite
 * is true: a *rotation* is what makes an old key version retirable, and
 * `VaultRotation.rotate` retires the old version once the sweep reports nothing left on it.
 * A sealed column the sweep cannot see is therefore not an inert gap — it is a rotation that
 * reports success while leaving ciphertext on a key nobody knows is still in use, and the
 * first person to discover it is whoever tries to decommission that key. Registering the
 * column in the same change that creates it is what keeps that window from existing at all.
 *
 * ---------------------------------------------------------------------------
 * **This store never adopts, and that is V015's doing rather than an assumption.**
 *
 * `VaultSecretRecord.sealed` exists because a column may hold a value that predates the
 * vault, and `false` tells the sweep to seal it for the first time. It is always `true`
 * here, because `provider_connections_credentials_sealed` refuses any value that is not one
 * of this service's envelopes — so a row holding an unsealed secret cannot exist, whatever
 * writes the table. The reason is written down rather than left as a constant, because
 * "always true" in a security path is exactly the kind of claim that deserves to say who is
 * guaranteeing it.
 *
 * ---------------------------------------------------------------------------
 * **The version filter reads the envelope rather than a column.** The key version is the
 * third field of `ouro.v1.<version>.<nonce>.<ciphertext>` — see `vault/envelope.ts` — so
 * *which key sealed this row* is a property of the value and needs no second column to fall
 * out of step with it. `pending` is therefore a prefix predicate, which is a range scan
 * rather than a function call per row.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import { ENVELOPE_FORMAT, ENVELOPE_MAGIC } from "../vault/envelope";
import type { VaultSecretRecord, VaultSecretStore } from "../vault/vault.rotation";

/**
 * How this store names itself in the sweep's report and its logs.
 *
 * The table, because that is what an operator reading *"3 records failed in
 * provider_connections"* needs in order to go and look.
 */
export const PROVIDER_CREDENTIAL_STORE = "provider_connections";

/**
 * The envelope prefix for one key version — `ouro.v1.3.`.
 *
 * Built from `envelope.ts`'s own constants rather than from a literal, so a change to the
 * framing breaks this at compile time instead of silently making every row look
 * out-of-date — which would be a sweep that re-seals the whole table on every rotation and
 * reports success.
 *
 * @param version - The key version.
 * @returns The prefix every value sealed on that version starts with.
 */
export function envelopePrefix(version: number): string {
  return `${ENVELOPE_MAGIC}.${ENVELOPE_FORMAT}.${version}.`;
}

@Injectable()
export class ProviderCredentialStore implements VaultSecretStore {
  readonly name = PROVIDER_CREDENTIAL_STORE;

  /**
   * @param database - The typed connection. The only place in this module that reads or
   *   writes `credentials_encrypted`; see `registry.repository.ts`'s header.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * This workspace's connections whose credential is not sealed on `version`.
   *
   * @param organizationId - The workspace.
   * @param version - The key version everything should end up on.
   * @returns One record per connection needing work. Empty is the expected steady state, and
   *   is the answer for every workspace today because nothing writes a credential yet.
   */
  async pending(organizationId: string, version: number): Promise<readonly VaultSecretRecord[]> {
    const rows = await this.database.db
      .selectFrom("provider_connections")
      .select(["id", "credentials_encrypted"])
      .where("organization_id", "=", organizationId)
      // `is not null` is required rather than implied: `not like` against a null is null,
      // not true, so a connection with no credential would be excluded either way — but
      // saying so is what makes "a local provider has nothing to re-seal" visible here
      // instead of being a consequence of three-valued logic.
      .where("credentials_encrypted", "is not", null)
      .where("credentials_encrypted", "not like", `${envelopePrefix(version)}%`)
      .execute();

    return rows.map((row) => ({
      // The primary key, which is what the envelope's additional data is bound to. It must
      // go on being this value: a record id that changes makes the row permanently
      // unreadable, which is why V015 gives the table a surrogate key that nothing edits.
      recordId: row.id,
      // Non-null by the predicate above; the compiler cannot see that, and `?? ""` would
      // hand the sweep a value that is not an envelope. An empty string is what this
      // expression can never produce and what the sweep would fail loudly on if it did.
      secret: row.credentials_encrypted ?? "",
      // Never `false` — see this file's header. The column cannot hold an unsealed value.
      sealed: true,
    }));
  }

  /**
   * Replace one connection's envelope with the re-sealed one.
   *
   * **Conditional on the row still holding what `pending` saw.** `VaultSecretStore` invites
   * exactly this — *"a store whose write is conditional on the record not having changed
   * underneath is welcome to make this a no-op"* — and it is the right shape here: the sweep
   * runs detached, AD.2's credential lifecycle can rewrite a connection's key at any moment,
   * and re-sealing the value that write replaced would resurrect a superseded credential.
   * The row is found again on the next sweep, on whatever version its new value carries.
   *
   * @param record - The record, as {@link pending} reported it.
   * @param envelope - The new envelope, on the current key version.
   */
  async store(record: VaultSecretRecord, envelope: string): Promise<void> {
    await this.database.db
      .updateTable("provider_connections")
      .set({ credentials_encrypted: envelope })
      .where("id", "=", record.recordId)
      .where("credentials_encrypted", "=", record.secret)
      .execute();
  }
}
