/**
 * The vault's view of `service_tokens.hint_sealed` (V091,
 * [#485](https://github.com/NobuData/ouroboros/issues/485)), so a key rotation reseals it.
 *
 * Registered with the migration that created the column, per `vault.rotation.ts`'s rule. What is
 * sealed is the masked hint, not the token — the token is stored hash-only and is not the vault's
 * to hold — but a sealed column the sweep did not know about would still be ciphertext left on a
 * retired key.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import { envelopePrefix } from "../github/github.secrets";
import type { VaultSecretRecord, VaultSecretStore } from "../vault/vault.rotation";

/** The store's name, as the rotation sweep reports it. */
export const SERVICE_TOKEN_HINT_STORE = "service_tokens";

@Injectable()
export class ServiceTokenHintStore implements VaultSecretStore {
  readonly name = SERVICE_TOKEN_HINT_STORE;

  /**
   * @param database - The pool owner.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Every hint of a workspace not yet sealed on `version`.
   *
   * @param organizationId - The workspace.
   * @param version - The key version the sweep is moving to.
   * @returns The records, keyed by token id — what the envelope's AAD binds.
   */
  async pending(organizationId: string, version: number): Promise<readonly VaultSecretRecord[]> {
    const rows = await this.database.db
      .selectFrom("service_tokens")
      .select(["id", "hint_sealed"])
      .where("organization_id", "=", organizationId)
      .where("hint_sealed", "not like", `${envelopePrefix(version)}%`)
      .execute();

    return rows.map((row) => ({ recordId: row.id, secret: row.hint_sealed, sealed: true }));
  }

  /**
   * Store a resealed hint, only if nobody changed it meanwhile.
   *
   * @param record - The record as {@link pending} reported it.
   * @param envelope - The new envelope.
   */
  async store(record: VaultSecretRecord, envelope: string): Promise<void> {
    await this.database.db
      .updateTable("service_tokens")
      .set({ hint_sealed: envelope })
      .where("id", "=", record.recordId)
      .where("hint_sealed", "=", record.secret)
      .execute();
  }
}
