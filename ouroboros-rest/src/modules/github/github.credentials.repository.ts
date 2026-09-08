/**
 * Every statement this service issues against `github_credentials` (V027,
 * [#101](https://github.com/NobuData/ouroboros/issues/101)).
 *
 * Four, and they are the credential's whole life: read it, write it, remove it, and — for
 * the vault's re-encryption sweep — replace one envelope with another. Nothing else in the
 * service touches the table, which is what makes *"where can a stored token be read"* a
 * question with one answer.
 *
 * **The write is an upsert, and that is what makes "set" and "rotate" the same request.**
 * There is one token per workspace, so replacing one is not a different operation from
 * storing the first — the primary key is the conflict target, and the database arbitrates
 * two administrators pasting at once rather than this code pretending to.
 *
 * What separates the two for the *audit trail* is {@link GithubCredentialsRepository.exists},
 * asked before the write. Two statements rather than one clever one: the `xmax = 0` trick
 * that reports insert-versus-update from a single upsert is an implementation detail of
 * PostgreSQL's tuple visibility, and it is wrong in exactly the concurrent case it looks
 * like it handles. What the honest version costs is that two administrators pasting tokens
 * in the same instant may both be recorded as having *set* one — a wrong word in a trail
 * that still records both writes, both actors and both times, which is a far smaller error
 * than a wrong word that is arrived at by reading catalogue internals.
 *
 * **Clearing deletes the row.** V027's header argues why: `token_encrypted` is `not null`,
 * so *"this workspace has no token"* is the absence of a row rather than a row that has to
 * be inspected. One state, and the honest-pause surface reads it without a special case.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import type { GithubCredentials } from "../db/schema";

@Injectable()
export class GithubCredentialsRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's
   *   lifecycle belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * One workspace's stored credential.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns The row, or `undefined` when the workspace has no token — the ordinary state
   *   for a workspace nobody has configured yet, and not an error.
   */
  async find(organizationId: string): Promise<GithubCredentials | undefined> {
    return this.database.db
      .selectFrom("github_credentials")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();
  }

  /**
   * Does this workspace have a token?
   *
   * Separate from {@link find} so that the two questions the service asks — *is one there*
   * and *what is it* — do not have to be the same query. The write path only needs the
   * former, and answering it with `find` would pull a ciphertext into the process for no
   * reason: the fewer places a sealed value is loaded, the shorter the list of places it
   * could be logged.
   *
   * @param organizationId - The workspace.
   * @returns `true` when a token is stored.
   */
  async exists(organizationId: string): Promise<boolean> {
    const row = await this.database.db
      .selectFrom("github_credentials")
      .select("organization_id")
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();

    return row !== undefined;
  }

  /**
   * Store a workspace's token, replacing whatever was there.
   *
   * @param organizationId - The workspace.
   * @param envelope - The sealed token. The **only** value this table accepts:
   *   `github_credentials_token_sealed` refuses anything that is not one of the vault's
   *   envelopes, so a plaintext reaching here is a `check_violation` rather than a stored
   *   secret.
   * @returns The stored row, trigger stamps included.
   */
  async upsert(organizationId: string, envelope: string): Promise<GithubCredentials> {
    return this.database.db
      .insertInto("github_credentials")
      .values({ organization_id: organizationId, token_encrypted: envelope })
      .onConflict((conflict) =>
        conflict.column("organization_id").doUpdateSet({ token_encrypted: envelope }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Remove a workspace's token.
   *
   * @param organizationId - The workspace.
   * @returns `true` when a row was deleted, `false` when there was nothing to clear.
   *   Clearing a workspace that has no token is not an error — it is the request being
   *   already satisfied — but the audit trail should not claim a removal that did not
   *   happen.
   */
  async remove(organizationId: string): Promise<boolean> {
    const result = await this.database.db
      .deleteFrom("github_credentials")
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();

    return result.numDeletedRows > 0n;
  }

  /**
   * Replace one envelope with another, only if the stored value has not changed.
   *
   * The vault's re-encryption sweep, and nothing else, calls this. The predicate on the old
   * value is what `VaultSecretStore.store` invites — *"a store whose write is conditional on
   * the record not having changed underneath is welcome to make this a no-op"* — and it is
   * the right shape here: the sweep runs detached, an administrator can rotate the token at
   * any moment, and re-sealing the value that write replaced would resurrect a token that
   * was deliberately retired.
   *
   * @param organizationId - The workspace.
   * @param previous - The envelope the sweep read.
   * @param envelope - The re-sealed envelope, on the current key version.
   */
  async reseal(organizationId: string, previous: string, envelope: string): Promise<void> {
    await this.database.db
      .updateTable("github_credentials")
      .set({ token_encrypted: envelope })
      .where("organization_id", "=", organizationId)
      .where("token_encrypted", "=", previous)
      .execute();
  }
}
