/**
 * The registry as the rest of the service asks it questions — resolution, the alias list,
 * and the one read a designed refusal is built from.
 *
 * Y.1 ([#189](https://github.com/NobuData/ouroboros/issues/189)), decision **M2**: this is
 * the *minimal internal accessor* the ticket asks for and deliberately not a management API.
 * There is no `create`, no `update` and no `delete` here, because mockup 07 owns provider
 * CRUD and mockup 21 owns alias CRUD, and a surface written here first would be the thing
 * those roadmaps had to negotiate with rather than the thing they wrote.
 *
 * ---------------------------------------------------------------------------
 * **Why there is a service at all, over a repository that already answers these.**
 *
 * Three things, and each is a decision that should be made once rather than at each of the
 * four call sites Y.2, Z.1, Z.2 and the engine estimator will bring:
 *
 *   * **Absence becomes a refusal.** The repository answers `undefined` for an alias that is
 *     not there, which is the honest shape for a lookup. A *caller* asking for a name that
 *     does not exist is a `404` with a code and a message, and choosing that once here is
 *     what stops four callers inventing four answers to it.
 *   * **Rows become resolutions.** The database's vocabulary stops here; `resolution.ts` is
 *     the crossing point and this is the only thing that calls it.
 *   * **The refusal 07 needs is constructible.** {@link RegistryService.dependentAliases} is
 *     the read behind `provider_connection_in_use`, and it lives beside the resolution it
 *     shares a table with rather than in a module that does not exist yet.
 *
 * ---------------------------------------------------------------------------
 * **What this service never returns.** A credential, in any form. `resolution.ts`'s header
 * argues why the resolved shape has no room for one and how that is checked; the note worth
 * repeating here is that nothing in this file decrypts anything — it does not hold a
 * `VaultService` and it does not import one. The credential path is AD.2's (#223) and runs
 * inside the invocation proxy, not through a resolution.
 */

import { Injectable } from "@nestjs/common";

import { RegistryRepository } from "./registry.repository";
import { aliasNotFound } from "./registry.errors";
import { toResolvedAlias, type ResolvedAlias } from "./resolution";

@Injectable()
export class RegistryService {
  /**
   * @param registry - The statements. Injected so a unit suite can answer them without a
   *   database, and so the module's import list is the answer to "who can reach V015's
   *   tables".
   */
  constructor(private readonly registry: RegistryRepository) {}

  /**
   * Resolve one alias to a model on a connection.
   *
   * The contract decision **M1** rests on: a caller names `coder-max` and is told
   * `claude-fable-5` on the Anthropic connection, and the caller never has to know either.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param alias - The name to resolve, exactly as it was supplied. Not folded — V015 stores
   *   aliases lower-case, so `Coder-Max` is a name this workspace does not have, and
   *   resolving it to `coder-max` would be this layer deciding what somebody meant.
   * @returns The resolution — the model, its parameters, and enough about the connection to
   *   reach it.
   * @throws {NotFoundError} `model_alias_not_found` when no alias by that name exists in
   *   this workspace. Not `undefined`: every caller of this method got the name from a
   *   request, a route or a DSL expression, and every one of them would otherwise have to
   *   invent the same refusal.
   */
  async resolve(organizationId: string, alias: string): Promise<ResolvedAlias> {
    const row = await this.registry.resolveAlias(organizationId, alias);

    if (row === undefined) {
      throw aliasNotFound(alias);
    }

    return toResolvedAlias(row);
  }

  /**
   * Every alias in this workspace, resolved.
   *
   * What Z.2 ([#195](https://github.com/NobuData/ouroboros/issues/195)) serves to the
   * inspector's swap menu, which renders each name beside what it resolves to.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns The resolutions, ordered by alias. Empty for a workspace whose registry has not
   *   been filled in, which is an ordinary state and not an error — a swap menu with nothing
   *   in it is what a new workspace should see.
   */
  async list(organizationId: string): Promise<ResolvedAlias[]> {
    const rows = await this.registry.listAliases(organizationId);

    return rows.map(toResolvedAlias);
  }

  /**
   * Which aliases would block removing one connection.
   *
   * The pre-flight behind `provider_connection_in_use` — see `registry.errors.ts` for why
   * naming them is the difference between a refusal somebody can act on and one they can
   * only be annoyed by. V015's `on delete restrict` is what actually enforces the rule; this
   * is what lets the surface enforcing it explain itself.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param connectionId - The connection somebody is about to remove.
   * @returns The alias names, ordered. Empty means the removal is safe to offer — as far as
   *   this instant knows, which is why `isProviderConnectionInUse` exists for the race an
   *   empty answer cannot close.
   */
  async dependentAliases(organizationId: string, connectionId: string): Promise<string[]> {
    return this.registry.aliasesForConnection(organizationId, connectionId);
  }
}
