/**
 * `chat_connections.bot_token_sealed`, as the vault's rotation sees it (BZ.1,
 * [#535](https://github.com/NobuData/ouroboros/issues/535)).
 *
 * A table with a sealed column registers a store (`vault/vault.module.ts`), so a key rotation
 * re-seals it. The column's CHECK admits only the vault's envelope, so every record here is
 * `sealed: true`; a revoked connection holds no token and is skipped.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import { envelopePrefix } from "../registry/registry.secrets";
import type { VaultSecretRecord, VaultSecretStore } from "../vault/vault.rotation";

/** The store's name in the rotation's report. */
export const CHAT_CONNECTION_TOKEN_STORE = "chat_connections";

@Injectable()
export class ChatConnectionTokenStore implements VaultSecretStore {
  readonly name = CHAT_CONNECTION_TOKEN_STORE;

  /** @param database - The typed connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * This workspace's connections whose bot token is not sealed on `version`.
   *
   * @param organizationId - The workspace.
   * @param version - The key version everything should end up on.
   * @returns One record per connection needing work — usually none.
   */
  async pending(organizationId: string, version: number): Promise<readonly VaultSecretRecord[]> {
    const rows = await this.database.db
      .selectFrom("chat_connections")
      .select(["id", "bot_token_sealed"])
      .where("organization_id", "=", organizationId)
      .where("bot_token_sealed", "is not", null)
      .where("bot_token_sealed", "not like", `${envelopePrefix(version)}%`)
      .execute();

    return rows.map((row) => ({
      // The envelope is bound to the connection's id, which never changes.
      recordId: row.id,
      secret: row.bot_token_sealed ?? "",
      sealed: true,
    }));
  }

  /**
   * Replace one connection's envelope with the re-sealed one — only if it still holds what
   * `pending` saw, so a re-install or a revocation in between is not overwritten.
   *
   * @param record - The record, as {@link pending} reported it.
   * @param envelope - The new envelope.
   */
  async store(record: VaultSecretRecord, envelope: string): Promise<void> {
    await this.database.db
      .updateTable("chat_connections")
      .set({ bot_token_sealed: envelope })
      .where("id", "=", record.recordId)
      .where("bot_token_sealed", "=", record.secret)
      .execute();
  }
}
