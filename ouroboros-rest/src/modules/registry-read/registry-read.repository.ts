/**
 * The three statements the composed registry read issues on its own
 * ([#588](https://github.com/NobuData/ouroboros/issues/588)), and nothing that decides.
 *
 * The other three subsystems are asked through the services that own them —
 * `AliasesService.list` for the rows and their references (CG.3), `PricingService.resolveMany`
 * for the money — because CH.5's whole point is that five subsystems produce **one** payload
 * and a sixth reading of any of them is a sixth chance for a cell to disagree with the page it
 * came from.
 *
 * **The workspace is a parameter of every statement**, into the `where` or into the join, so a
 * row from another workspace cannot be returned through this class whatever id a caller holds.
 * `provider_models` carries no `organization_id` of its own — V017's argument is that its
 * tenancy is the foreign key — so its read enters through a join onto `provider_connections`
 * with the predicate on it, written as the join rather than as a filter so the predicate is
 * visible in the statement.
 *
 * **Each statement is one round trip whatever the registry holds.** There is no per-alias read
 * here and there is nowhere for one to be added: every method below takes a workspace and
 * answers a set. That is the ticket's *the eight-row page costs a bounded, constant number of
 * queries*, made structural rather than measured — and it is measured anyway, in
 * `registry-read.integration-spec.ts`, at the driver.
 *
 * ---------------------------------------------------------------------------
 * **`credentials_encrypted` is selected in one method and never with anything else.**
 *
 * {@link RegistryReadRepository.sealedCredentials} names the column, selects the id beside it
 * and nothing more; {@link RegistryReadRepository.connections} — the read that feeds the health
 * cell and the provider cell — cannot see it. That is the same shape
 * `provider-health/provider-health.repository.ts` keeps, and `registry-read.repository.spec.ts`
 * compiles the other statements and asserts none of them names the column.
 *
 * The suffix is masked from the plaintext because there is no column holding one; see
 * `provider-connections/masking.ts`, whose header argues why the bullets are made server-side,
 * and `registry-read.service.ts`, which is where the buffer is opened and erased.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import type { DiscoveredModelRow, RegistryConnectionRow } from "./registry-read.rows";

/** The columns the connection read selects — named once, so the health cell and the provider cell share one shape. */
const CONNECTION_COLUMNS = [
  "id",
  "kind",
  "display_name",
  "enabled",
  "status",
  "last_checked_at",
  "health",
] as const;

@Injectable()
export class RegistryReadRepository {
  /**
   * @param database - The pool. Nothing here writes, so no transaction is ever opened.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Every connection in the workspace, with what Z.3 last concluded about each.
   *
   * Read for the whole page rather than per alias: eight aliases may share three connections,
   * and asking once per row would be the N+1 the ticket exists to refuse. Unpaged, for the
   * reason the alias list is — a workspace configures a handful of providers.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns The rows, ordered by display name so a caller building a map does so
   *   deterministically. Empty for a workspace that has configured none, which is the state
   *   every alias in it reads as `no_key`.
   */
  async connections(organizationId: string): Promise<RegistryConnectionRow[]> {
    return this.database.db
      .selectFrom("provider_connections")
      .select(CONNECTION_COLUMNS)
      .where("organization_id", "=", organizationId)
      .orderBy("display_name")
      .execute();
  }

  /**
   * Every (connection, model) pair AC.6's discovery has reported in the workspace.
   *
   * The `model_missing` state is a set membership test, and this is the set — read once for the
   * page rather than asked once per alias through `provider_model_discovered()`. The two
   * answers agree by construction: that function is `exists` over these same rows.
   *
   * @param organizationId - The workspace, carried on the join onto `provider_connections`
   *   because `provider_models` has no workspace column of its own (V017).
   * @returns The pairs, unordered by design — the caller builds a set. Empty when discovery has
   *   reported nothing anywhere in the workspace, which is the state in which no alias may be
   *   called `model_missing`.
   */
  async discoveredModels(organizationId: string): Promise<DiscoveredModelRow[]> {
    return this.database.db
      .selectFrom("provider_models as m")
      .innerJoin("provider_connections as c", "c.id", "m.provider_connection_id")
      .select(["m.provider_connection_id", "m.model_id"])
      .where("c.organization_id", "=", organizationId)
      .execute();
  }

  /**
   * The sealed credential of every connection in the workspace.
   *
   * The only statement in this module that names `credentials_encrypted`, and it selects
   * nothing beside the id it has to be keyed by — so what this method can leak is bounded by
   * what it can see. It exists because mockup 21's inspector draws
   * *Anthropic — key sk-ant-…Xq4A* on its provider line, and there is no stored suffix to read:
   * the mask is computed from the plaintext, which is `registry-read.service.ts`'s work and the
   * only place in this module a plaintext exists.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns Envelope by connection id. A connection that stores none is present with `null`
   *   rather than absent, so a caller can tell *no credential* from *not in this workspace*
   *   without a second read — the same three-way answer
   *   `provider-connections.repository.ts`'s `envelopesFor` gives.
   */
  async sealedCredentials(organizationId: string): Promise<Map<string, string | null>> {
    const rows = await this.database.db
      .selectFrom("provider_connections")
      .select(["id", "credentials_encrypted"])
      .where("organization_id", "=", organizationId)
      .execute();

    return new Map(rows.map((row) => [row.id, row.credentials_encrypted]));
  }
}
