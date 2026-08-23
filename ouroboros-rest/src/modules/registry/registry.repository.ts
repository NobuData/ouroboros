/**
 * Every statement this module issues against V015's two tables — three of them, all reads,
 * all scoped to one workspace.
 *
 * ## Resolution is one query, and the indexes it uses exist for other reasons
 *
 * *Alias → provider + model* is the hot read: every route hop, every simulation and every
 * swap menu goes through it. {@link RegistryRepository.resolveAlias} is one statement with
 * one join, and it is two index lookups and no scan — `model_aliases_organization_alias_key`
 * finds the alias and `provider_connections_organization_id_key` finds its connection. Both
 * of those indexes exist because a *rule* needed them (uniqueness per workspace, and the
 * composite foreign key's target), which is the arrangement worth having: the fast path is
 * the one the constraints already paid for. `ouroboros-db/tests/constraints.sql` asserts the
 * plan under `EXPLAIN`, which is where an assertion about a plan belongs.
 *
 * ## Org scoping is not optional and is not the client's
 *
 * Every method takes `organizationId` first and every statement carries it — the same rule
 * `dashboard.repository.ts` and `pricing.repository.ts` state, and sharper here for the
 * reason V015 makes the alias's foreign key composite: an alias resolved out of the wrong
 * workspace resolves onto *that* workspace's provider, and therefore onto its credential.
 * The value comes from the tenant context, never from anything a caller wrote.
 *
 * The join is written `c.organization_id = a.organization_id` rather than on the connection
 * id alone. Given the composite foreign key the two are equivalent, and writing it out is
 * what makes the workspace predicate visible in the statement instead of being a consequence
 * of a constraint the reader has to go and look up.
 *
 * ## Nothing here selects the credential
 *
 * `credentials_encrypted` appears in exactly one file in this module — `registry.secrets.ts`,
 * the vault's re-encryption store, which has to read a ciphertext to re-seal it — and in no
 * statement below. `registry.repository.spec.ts` compiles every one of these and asserts the
 * SQL does not name the column, which makes it a property of the statements rather than of
 * anybody's care.
 *
 * ## There are no writes
 *
 * Decision **M2**: creating, editing and deleting connections and aliases is mockup 07's and
 * mockup 21's surface. This module reads. The one statement in it that writes lives in the
 * re-encryption store and rewrites a value the row already held.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import type { AliasResolutionRow } from "./resolution";

@Injectable()
export class RegistryRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's
   *   lifecycle belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * What one alias resolves to in this workspace.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param alias - The name to resolve, as the caller supplied it. Not folded here: V015
   *   stores aliases lower-case and constrains them to that shape, so a caller that sent
   *   `Coder-Max` asked for something this workspace does not have — and answering it with
   *   `coder-max`'s model would be this layer guessing at what somebody meant.
   * @returns The joined row, or `undefined` when there is no such alias. Absence is the
   *   ordinary answer for a name a caller supplied, not an exceptional one; turning it into
   *   a 404 is {@link RegistryService}'s job, one layer up, where the alias is known to have
   *   come from a request.
   */
  async resolveAlias(
    organizationId: string,
    alias: string,
  ): Promise<AliasResolutionRow | undefined> {
    return this.database.db
      .selectFrom("model_aliases as a")
      .innerJoin("provider_connections as c", (join) =>
        join
          .onRef("c.organization_id", "=", "a.organization_id")
          .onRef("c.id", "=", "a.provider_connection_id"),
      )
      .select([
        "a.alias",
        "a.model_id",
        "a.params",
        "c.id as connection_id",
        "c.kind",
        "c.display_name",
        "c.base_url",
        "c.status",
      ])
      .where("a.organization_id", "=", organizationId)
      .where("a.alias", "=", alias)
      .executeTakeFirst();
  }

  /**
   * Every alias in this workspace, resolved.
   *
   * The read Z.2 ([#195](https://github.com/NobuData/ouroboros/issues/195)) serves to the
   * inspector's swap menu, which needs the resolution beside each name — the menu renders
   * `coder-max` *and* `claude-fable-5 · Anthropic`, so a list of names alone would send it
   * back for one lookup per row.
   *
   * Unpaged, deliberately. A workspace's registry is the handful of aliases its routes name
   * — mockup 06 draws six — and a page over a list that short would cost a client a second
   * request to discover there was nothing more. If a workspace ever has enough aliases for
   * that to be wrong, the surface that discovers it is the one that should add the window.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns Every alias, ordered by name. Alphabetical rather than by creation, because the
   *   menu is something a person scans for a name they already know.
   */
  async listAliases(organizationId: string): Promise<AliasResolutionRow[]> {
    return this.database.db
      .selectFrom("model_aliases as a")
      .innerJoin("provider_connections as c", (join) =>
        join
          .onRef("c.organization_id", "=", "a.organization_id")
          .onRef("c.id", "=", "a.provider_connection_id"),
      )
      .select([
        "a.alias",
        "a.model_id",
        "a.params",
        "c.id as connection_id",
        "c.kind",
        "c.display_name",
        "c.base_url",
        "c.status",
      ])
      .where("a.organization_id", "=", organizationId)
      .orderBy("a.alias")
      .execute();
  }

  /**
   * Which aliases resolve on one connection.
   *
   * The read behind the designed refusal — see `registry.errors.ts`. V015's
   * `model_aliases_provider_fk` is what *blocks* removing a connection aliases depend on;
   * this is what lets the refusal say which ones, which is the difference between a message
   * somebody can act on and a message they can only be annoyed by.
   *
   * It is an index scan rather than a filter: `model_aliases_provider_idx` exists for the
   * foreign key's referencing side and this read is its second job.
   *
   * @param organizationId - The workspace, from the tenant context. Carried even though the
   *   connection id is globally unique — a caller that could ask this question about another
   *   workspace's connection could enumerate one workspace's registry from another.
   * @param connectionId - The connection.
   * @returns The alias names, ordered, so a message built from them is stable between calls.
   *   Empty means nothing depends on it, which is what makes a removal safe to offer.
   */
  async aliasesForConnection(organizationId: string, connectionId: string): Promise<string[]> {
    const rows = await this.database.db
      .selectFrom("model_aliases")
      .select("alias")
      .where("organization_id", "=", organizationId)
      .where("provider_connection_id", "=", connectionId)
      .orderBy("alias")
      .execute();

    return rows.map((row) => row.alias);
  }
}
