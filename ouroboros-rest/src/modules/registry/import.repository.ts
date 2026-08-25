/**
 * The two statements bulk import adds, and nothing else
 * ([#587](https://github.com/NobuData/ouroboros/issues/587)).
 *
 * **Two, because everything else it needs already exists.** The discovered models are
 * `AliasesRepository.modelOptions` — the same rows the inspector's select is drawn from, which
 * is the point: a wizard listing models the inspector does not would mean two answers to *what
 * has this connection got*. The connection, the insert and the revision record are that
 * repository's as well, so an imported alias is written by the same statement a typed one is
 * and cannot end up shaped differently. What is left is the pair below — *which of these models
 * already has an alias*, and *what names are spoken for in this workspace* — and neither
 * belongs in CH.1's file, which is documented as the alias lifecycle's statements.
 *
 * **The workspace is a parameter of both**, as it is of every statement in this service. The
 * second reads names across the whole workspace rather than the connection, deliberately:
 * V015's uniqueness is per workspace, so a suggestion checked only against this connection's
 * aliases would collide with one bound elsewhere and the wizard would offer a name the create
 * refuses.
 *
 * **Neither is a write.** The transaction import commits is opened by the service and its
 * statements are CH.1's; there is nothing here to run inside one.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import type { ImportAliasRow } from "./import.rows";

@Injectable()
export class ImportRepository {
  /**
   * @param database - The pool. Reads only — see this file's header.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The aliases bound to one connection, with the model each names.
   *
   * An index scan rather than a filter: `model_aliases_provider_idx` exists for V015's foreign
   * key and this read is its second job — the same one `RegistryRepository.aliasesForConnection`
   * makes of it, which answers names alone and cannot say which model each is for.
   *
   * @param organizationId - The workspace, from the tenant context. Carried even though the
   *   connection id is globally unique: a caller who could ask this about another workspace's
   *   connection could enumerate its registry from outside it.
   * @param connectionId - The connection.
   * @returns One row per alias, **ordered by name**, so a model named by two aliases is marked
   *   with the same one on every read.
   */
  async aliasesOn(organizationId: string, connectionId: string): Promise<ImportAliasRow[]> {
    return this.database.db
      .selectFrom("model_aliases")
      .select(["id", "alias", "model_id"])
      .where("organization_id", "=", organizationId)
      .where("provider_connection_id", "=", connectionId)
      .orderBy("alias")
      .execute();
  }

  /**
   * Every alias name in the workspace — what a suggestion must not collide with.
   *
   * Unbound aliases included, and that is the whole reason this is not scoped to the
   * connection: `gpt5-experiments` occupies its name whether or not anything is on the other
   * end of it, and V015's unique key does not care either.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns The names, ordered, so a set built from them is built from a stable list.
   */
  async aliasNames(organizationId: string): Promise<string[]> {
    const rows = await this.database.db
      .selectFrom("model_aliases")
      .select("alias")
      .where("organization_id", "=", organizationId)
      .orderBy("alias")
      .execute();

    return rows.map((row) => row.alias);
  }
}
