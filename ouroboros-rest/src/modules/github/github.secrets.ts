/**
 * `github_credentials.token_encrypted`, seen from the vault's re-encryption sweep.
 *
 * The second store registered under `VAULT_SECRET_STORES`, and the one K.3
 * ([#101](https://github.com/NobuData/ouroboros/issues/101)) owes it. `vault.module.ts`,
 * `vault.rotation.ts` and `docs/SECURITY_MODEL.md` § 2.5 have each named this ticket as
 * bringing one; this is it.
 *
 * ---------------------------------------------------------------------------
 * **Why the sweep has to know, restated because it is the reason this file is not optional.**
 *
 * `VaultRotation.rotate` retires a key version once the sweep reports nothing left on it. A
 * sealed column the sweep cannot see is therefore not an inert gap — it is a rotation that
 * reports success while leaving ciphertext on a key nobody knows is still in use, and the
 * first person to find out is whoever tries to decommission that key and discovers a
 * workspace whose GitHub token can no longer be opened. `registry.secrets.ts` makes the same
 * argument at greater length; the rule it draws out of it is that a store is registered
 * **with the migration that creates its column**, and V027 is that migration.
 *
 * ---------------------------------------------------------------------------
 * **This store never adopts, and V027 is what guarantees it.**
 *
 * `VaultSecretRecord.sealed` exists so a column that predates the vault can be sealed for
 * the first time. It is always `true` here, because `github_credentials_token_sealed`
 * refuses any value that is not one of the vault's envelopes — so a row holding a plaintext
 * token cannot exist, whatever wrote the table. Stated rather than assumed: *"always true"*
 * in a security path deserves to name who is guaranteeing it.
 *
 * ---------------------------------------------------------------------------
 * **The record id is the workspace id**, which is this table's primary key and therefore the
 * value V027 binds the envelope's additional authenticated data to. It must go on being that
 * value; a workspace id does not change.
 *
 * ---------------------------------------------------------------------------
 * **Registered from `vault.module.ts`'s own `providers`, not by importing a module.**
 * `RegistryModule` can export its store because it does not import `VaultModule`; this
 * module *does* — the credential service encrypts — so exporting the store the same way
 * would close a cycle. The class needs nothing but `DatabaseService`, which `VaultModule`
 * already has, so naming the class there is both sufficient and the smaller change.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import { ENVELOPE_FORMAT, ENVELOPE_MAGIC } from "../vault/envelope";
import type { VaultSecretRecord, VaultSecretStore } from "../vault/vault.rotation";

/**
 * How this store names itself in the sweep's report and its logs.
 *
 * The table, because that is what an operator reading *"1 record failed in
 * github_credentials"* needs in order to go and look.
 */
export const GITHUB_CREDENTIAL_STORE = "github_credentials";

/**
 * The envelope prefix for one key version — `ouro.v1.3.`.
 *
 * Built from `envelope.ts`'s own constants rather than from a literal, so a change to the
 * framing breaks this at compile time instead of making every row look out of date — which
 * would be a sweep that re-seals the whole table on every rotation and reports success.
 *
 * @param version - The key version.
 * @returns The prefix every value sealed on that version starts with.
 */
export function envelopePrefix(version: number): string {
  return `${ENVELOPE_MAGIC}.${ENVELOPE_FORMAT}.${version}.`;
}

@Injectable()
export class GithubCredentialStore implements VaultSecretStore {
  readonly name = GITHUB_CREDENTIAL_STORE;

  /**
   * @param database - The typed connection. This class and
   *   `github.credentials.repository.ts` are the only readers of `token_encrypted`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * This workspace's credential, if it is not sealed on `version`.
   *
   * At most one row, because there is at most one GitHub token per workspace — so the
   * *"never load everything into memory"* concern the interface is written around is
   * satisfied by the schema here rather than by this query being careful.
   *
   * @param organizationId - The workspace.
   * @param version - The key version everything should end up on.
   * @returns The record needing work, or nothing — the expected steady state.
   */
  async pending(organizationId: string, version: number): Promise<readonly VaultSecretRecord[]> {
    const rows = await this.database.db
      .selectFrom("github_credentials")
      .select(["organization_id", "token_encrypted"])
      .where("organization_id", "=", organizationId)
      // A prefix predicate, which is a comparison rather than a function call per row: the
      // key version is the third field of the envelope, so *which key sealed this* is a
      // property of the value and needs no second column to fall out of step with it.
      .where("token_encrypted", "not like", `${envelopePrefix(version)}%`)
      .execute();

    return rows.map((row) => ({
      // The primary key, and what V027 binds the envelope to.
      recordId: row.organization_id,
      secret: row.token_encrypted,
      // Never `false` — see this file's header. The column cannot hold an unsealed token.
      sealed: true,
    }));
  }

  /**
   * Replace the workspace's envelope with the re-sealed one.
   *
   * Conditional on the row still holding what {@link pending} saw, for the reason
   * `github.credentials.repository.ts` gives on the same statement: the sweep runs detached,
   * an administrator can rotate the token at any moment, and re-sealing the value that write
   * replaced would resurrect a token somebody deliberately retired. The row is found again on
   * the next sweep, on whatever version its new value carries.
   *
   * @param record - The record, as {@link pending} reported it.
   * @param envelope - The new envelope, on the current key version.
   */
  async store(record: VaultSecretRecord, envelope: string): Promise<void> {
    await this.database.db
      .updateTable("github_credentials")
      .set({ token_encrypted: envelope })
      .where("organization_id", "=", record.recordId)
      .where("token_encrypted", "=", record.secret)
      .execute();
  }
}
