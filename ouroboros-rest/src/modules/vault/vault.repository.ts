/**
 * Every statement this module issues against `ouroboros.tenant_keys` (V013,
 * [#222](https://github.com/NobuData/ouroboros/issues/222)).
 *
 * Statements only, as everywhere in this codebase — no crypto, no key material, no policy.
 * What makes this repository different from the others is that **two of its methods must be
 * atomic against a concurrent copy of themselves**, and both say so in their own
 * documentation rather than leaving it to the caller:
 *
 *   * {@link VaultRepository.createFirstVersion} races another first write for the same
 *     workspace. It resolves the race with `on conflict do nothing` and a re-read, so the
 *     loser adopts the winner's key rather than failing a request that did nothing wrong.
 *   * {@link VaultRepository.rotate} races another rotation. It resolves it by *not*
 *     resolving it: the partial unique index refuses the second insert, and a rotation that
 *     lost a race did not happen — which is the honest answer, and one the caller can see.
 *
 * The difference is deliberate. Two concurrent first-writes both want the same thing and
 * either outcome satisfies both. Two concurrent rotations want *different* things — two new
 * keys — and silently satisfying one of them would leave the other's caller believing a
 * rotation it asked for had occurred.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { Database, NewTenantKey, TenantKey } from "../db/schema";

/** The first version number a workspace's key is created at. */
export const FIRST_VERSION = 1;

@Injectable()
export class VaultRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's
   *   lifecycle belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The version new writes should be sealed under.
   *
   * @param organizationId - The workspace.
   * @returns Its one active key row, or `undefined` when the workspace has never stored a
   *   secret. Absence is an ordinary state, not an error: keys are created lazily, because a
   *   key generated for a workspace that never stores anything is key material with no
   *   purpose that every backup would then carry.
   */
  async activeKey(organizationId: string): Promise<TenantKey | undefined> {
    return this.database.db
      .selectFrom("tenant_keys")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("status", "=", "active")
      .executeTakeFirst();
  }

  /**
   * One specific version of a workspace's key — what a decrypt looks up.
   *
   * A primary-key lookup, because the pair is exactly what the ciphertext's envelope
   * carries. Retired versions are returned like any other: retirement stops new writes, it
   * does not stop reads, and refusing one here would make a rotation destroy data that the
   * sweep had not reached yet.
   *
   * @param organizationId - The workspace.
   * @param version - The version named in the envelope.
   * @returns The row, or `undefined` if this deployment does not have that key.
   */
  async keyAt(organizationId: string, version: number): Promise<TenantKey | undefined> {
    return this.database.db
      .selectFrom("tenant_keys")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("version", "=", version)
      .executeTakeFirst();
  }

  /**
   * Every version of one workspace's key, oldest first.
   *
   * Read by the re-wrap: custody moves for all of a workspace's keys or for none of them,
   * because a half-converted workspace is one whose older ciphertext is readable only by the
   * backend the operator is decommissioning.
   *
   * @param organizationId - The workspace.
   * @returns Its rows, ascending by version. Empty for a workspace with no key.
   */
  async allKeys(organizationId: string): Promise<TenantKey[]> {
    return this.database.db
      .selectFrom("tenant_keys")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .orderBy("version", "asc")
      .execute();
  }

  /**
   * Create a workspace's very first key version, tolerating a concurrent creation.
   *
   * Two requests storing a workspace's first secret at the same moment both find no active
   * key and both try to create version 1. `on conflict do nothing` plus a re-read is what
   * makes that a non-event: whichever insert lands is the workspace's key, and the other
   * request adopts it. The alternative — letting the second insert fail — would turn a
   * perfectly ordinary double-click into a 500.
   *
   * The conflict is caught by the primary key rather than by the partial unique index; both
   * would fire, and naming neither is deliberate, because `do nothing` here means "somebody
   * else got there first" for either reason.
   *
   * @param key - The row to insert. `version` must be {@link FIRST_VERSION}; a later version
   *   belongs to {@link rotate}, which has to retire its predecessor in the same breath.
   * @returns The workspace's active key — this call's insert, or the one that beat it.
   * @throws If the re-read finds nothing, which would mean the row was deleted between the
   *   two statements. That is a workspace deleted mid-request; the caller's own error
   *   handling is right for it and inventing a key would not be.
   */
  async createFirstVersion(key: NewTenantKey): Promise<TenantKey> {
    await this.database.db
      .insertInto("tenant_keys")
      .values(key)
      .onConflict((conflict) => conflict.doNothing())
      .execute();

    const active = await this.activeKey(key.organization_id);

    if (active === undefined) {
      throw new Error(
        `vault: workspace ${key.organization_id} has no active key immediately after creating one`,
      );
    }

    return active;
  }

  /**
   * Retire the active version and make its successor active, atomically.
   *
   * One transaction, and the order inside it matters: the retirement must be visible to the
   * insert, because `tenant_keys_one_active_idx` would otherwise refuse the new row against
   * the old one. A second rotation running concurrently is refused by that same index — see
   * this file's header for why that is the wanted outcome rather than a race to paper over.
   *
   * `for update` on the read is what makes the version number correct rather than merely
   * unique: two rotations that both read version 3 would both compute 4, and one of them
   * would be refused by the primary key with a message about a duplicate row rather than
   * about a lost rotation.
   *
   * @param organizationId - The workspace.
   * @param seal - How to seal the new version's key, given the version number this decides.
   *   A callback rather than a prepared row, because the version is only known inside the
   *   transaction and the sealed material is bound to it by the wrapper's AAD.
   * @returns The new active row.
   * @throws If the workspace has no active key. Rotating a workspace that has never stored a
   *   secret is a caller mistake, not a first-key creation: there is nothing to re-encrypt,
   *   and creating a key here would leave a version 1 that had never sealed anything.
   */
  async rotate(
    organizationId: string,
    seal: (version: number) => Promise<Pick<NewTenantKey, "sealed_dek" | "wrapper">>,
  ): Promise<TenantKey> {
    return this.database.transaction(async (trx: Transaction<Database>) => {
      const current = await trx
        .selectFrom("tenant_keys")
        .selectAll()
        .where("organization_id", "=", organizationId)
        .where("status", "=", "active")
        .forUpdate()
        .executeTakeFirst();

      if (current === undefined) {
        throw new Error(
          `vault: workspace ${organizationId} has no active key to rotate — it has never stored a secret`,
        );
      }

      const version = current.version + 1;
      const sealed = await seal(version);

      // Retire first: the partial unique index counts active rows, and the insert below is
      // one. `rotated_at` is set here rather than defaulted, because the CHECK binds it to
      // the status and the two have to move together.
      await trx
        .updateTable("tenant_keys")
        .set({ status: "retired", rotated_at: sql<Date>`now()` })
        .where("organization_id", "=", organizationId)
        .where("version", "=", current.version)
        .execute();

      return trx
        .insertInto("tenant_keys")
        .values({ organization_id: organizationId, version, ...sealed })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  /**
   * Replace one row's sealed key material — the whole of a re-wrap, at the database.
   *
   * **This is the statement that makes AF.3 cheap.** It touches `sealed_dek` and `wrapper`
   * and nothing else: not `version`, not `status`, and no data ciphertext anywhere in the
   * schema. `updated_at` moves by trigger, which is what says when custody changed.
   *
   * @param organizationId - The workspace.
   * @param version - Which version's seal to replace.
   * @param sealed - The re-sealed material and the wrapper that produced it.
   * @returns The updated row.
   * @throws If the row does not exist, which would mean the key was deleted mid-re-wrap.
   */
  async replaceSeal(
    organizationId: string,
    version: number,
    sealed: Pick<NewTenantKey, "sealed_dek" | "wrapper">,
  ): Promise<TenantKey> {
    return this.database.db
      .updateTable("tenant_keys")
      .set(sealed)
      .where("organization_id", "=", organizationId)
      .where("version", "=", version)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Every workspace in the installation, oldest first.
   *
   * Read by the one-time migration job, which has to visit workspaces that have *no* key
   * yet — those are precisely the ones holding secrets sealed by something other than this
   * service. Iterating `tenant_keys` instead would skip exactly the rows the migration
   * exists for.
   *
   * A read of a BetterAuth-owned table, which is allowed: `LIBRARY_OWNED_TABLES` is a rule
   * about writes.
   *
   * @returns Workspace ids, ascending by creation time so a long job's progress is
   *   reproducible across restarts.
   */
  async organizationIds(): Promise<string[]> {
    const rows = await this.database.db
      .selectFrom("organization")
      .select("id")
      .orderBy("createdAt", "asc")
      .orderBy("id", "asc")
      .execute();

    return rows.map((row) => row.id);
  }
}
