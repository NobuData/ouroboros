/**
 * Every statement resolution issues — four reads, and not one write.
 *
 * Z.1 ([#194](https://github.com/NobuData/ouroboros/issues/194)). Decision **M2** again: V016's
 * and V018's write surfaces are Z.2's ([#195](https://github.com/NobuData/ouroboros/issues/195)),
 * and this module resolves routes and creates none. There is no `insert`, `update` or `delete`
 * in this file, and `routing.repository.spec.ts` compiles every statement and asserts it.
 *
 * ## Four statements rather than one join
 *
 * A single query could fetch the route, its hops and its aliases together, and it would make
 * *the workspace has no route for this kind* indistinguishable from *the route has no hops* —
 * both arrive as an empty result set. The first is a `404` and the second is impossible
 * (V016's `route_chain_intact()` refuses a route with no hops), so collapsing them would mean
 * answering a `404` for a state that cannot occur while hiding the one that can. The route is
 * therefore read first and its absence is the only thing that decides the error.
 *
 * ## The alias list is this module's, not the registry's
 *
 * `registry/registry.repository.ts` already lists a workspace's aliases, and this file
 * deliberately does not call it. Two differences, and each of them is load-bearing:
 *
 *   * that statement **inner-joins** the connection, so an unbound alias is not in its answer.
 *     A chain that lost a hop that way would arrive shorter than the operator configured it,
 *     which is the silence this ticket exists to remove; and
 *   * that statement selects `provider_connections.status`, and a resolution must have exactly
 *     one opinion about whether a provider is usable — Z.3's snapshot. A status arriving
 *     through a second door is a value that can disagree with the one the chain was walked
 *     against.
 *
 * `routing.repository.spec.ts` asserts the absence of `status` over every statement here,
 * because it is the kind of column somebody adds while debugging and does not remove.
 *
 * ## Every statement carries the workspace
 *
 * Including the ones whose id is globally unique, for the reason `registry.repository.ts`
 * gives: a lookup that *could* cross a workspace boundary is one that eventually does.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import type { AliasRow, ChainHopRow, EscalationRuleRow, RouteRow } from "./routing.rows";

/**
 * The connection columns every alias read here selects, in one place.
 *
 * A shared list rather than two literals, because the two statements below must agree about
 * what an alias resolution *is* — and specifically must agree about the column that is not in
 * it. See this file's header.
 */
const CONNECTION_COLUMNS = [
  "c.id as connection_id",
  "c.kind",
  "c.display_name",
  "c.base_url",
] as const;

@Injectable()
export class RoutingRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's lifecycle
   *   belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The route this workspace uses for a task kind.
   *
   * Joined through `task_kinds` on the kind's **name**, because that is what a caller has:
   * `resolve("implement", …)` names the row of the matrix, not a uuid. V016 makes the name
   * unique per workspace and the route unique per kind, so this returns at most one row by
   * construction rather than by a `limit`.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param taskKind - The kind's name, as the caller supplied it. Not folded: V016 stores
   *   names lower-case and constrains them to that shape, so a caller that sent `Implement`
   *   asked for something this workspace does not have.
   * @returns The route, or `undefined` when this workspace has no route for that kind.
   *   Absence is the ordinary answer for a name a caller supplied; turning it into a `404` is
   *   {@link ResolutionService}'s job, one layer up.
   */
  async route(organizationId: string, taskKind: string): Promise<RouteRow | undefined> {
    return this.database.db
      .selectFrom("routes as r")
      .innerJoin("task_kinds as k", (join) =>
        join
          .onRef("k.organization_id", "=", "r.organization_id")
          .onRef("k.id", "=", "r.task_kind_id"),
      )
      .select([
        "r.id as route_id",
        "r.tag",
        "r.allow_local_fallback",
        "r.floor_hop_index",
        "r.max_cost_cents_per_run",
      ])
      .where("r.organization_id", "=", organizationId)
      .where("k.name", "=", taskKind)
      .executeTakeFirst();
  }

  /**
   * One route's chain, in order, with each hop's alias resolved as far as it goes.
   *
   * **`leftJoin` on the connection** — see this file's header. Ordered by `position`, which
   * V016 keeps dense from 1, so the array index and the stored position agree and the floor
   * has something to count.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param routeId - The route, from {@link RoutingRepository.route}.
   * @returns The hops, primary first. Never empty for a route that exists — V016's
   *   `route_chain_intact()` refuses an empty chain — which is why the caller reads the route
   *   separately rather than inferring its absence from this.
   */
  async hops(organizationId: string, routeId: string): Promise<ChainHopRow[]> {
    return this.database.db
      .selectFrom("route_hops as h")
      .innerJoin("model_aliases as a", (join) =>
        join
          .onRef("a.organization_id", "=", "h.organization_id")
          .onRef("a.id", "=", "h.model_alias_id"),
      )
      .leftJoin("provider_connections as c", (join) =>
        join
          .onRef("c.organization_id", "=", "a.organization_id")
          .onRef("c.id", "=", "a.provider_connection_id"),
      )
      .select(["h.position", "h.note", "a.alias", "a.model_id", "a.params", ...CONNECTION_COLUMNS])
      .where("h.organization_id", "=", organizationId)
      .where("h.route_id", "=", routeId)
      .orderBy("h.position")
      .execute();
  }

  /**
   * Every alias in the workspace, resolved as far as it goes.
   *
   * Read in full because an escalation rule may name an alias **no chain contains** — the
   * mockup's `second-opinion` is in no route at all — so the hops alone cannot satisfy a
   * `use_alias` or an `add_vote`.
   *
   * Unpaged, for the reason `registry.repository.ts`'s list is: a workspace's registry is the
   * handful of aliases its routes name, and a page over a list that short would cost a second
   * round trip to discover there was nothing more. Ordered by name so the input to a pure
   * function is stable, which is half of what makes its output deterministic.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns Every alias, ordered by name, unbound ones included.
   */
  async aliases(organizationId: string): Promise<AliasRow[]> {
    return this.database.db
      .selectFrom("model_aliases as a")
      .leftJoin("provider_connections as c", (join) =>
        join
          .onRef("c.organization_id", "=", "a.organization_id")
          .onRef("c.id", "=", "a.provider_connection_id"),
      )
      .select(["a.alias", "a.model_id", "a.params", ...CONNECTION_COLUMNS])
      .where("a.organization_id", "=", organizationId)
      .orderBy("a.alias")
      .execute();
  }

  /**
   * The workspace's **enabled** escalation rules, in evaluation order.
   *
   * `where enabled` is in the statement rather than in the resolver, and V018 argues the
   * distinction: *the rules this workspace has* and *the rules that currently fire* are
   * different questions, the card asks both, and this is the second one. A resolver that
   * filtered in memory would be a resolver that could be given a disabled rule.
   *
   * `display` is selected rather than recomposed — decision **M5**. It is a generated column,
   * so the sentence in a resolution's explanation panel and the sentence on the rules card
   * come from the same expression evaluated once by PostgreSQL.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns The rules, `sort_order` ascending. Empty for a workspace with none, which is a
   *   workspace whose routes are exactly what its chains say.
   */
  async rules(organizationId: string): Promise<EscalationRuleRow[]> {
    return this.database.db
      .selectFrom("escalation_rules")
      .select(["id", "sort_order", "display", "when", "then"])
      .where("organization_id", "=", organizationId)
      .where("enabled", "=", true)
      .orderBy("sort_order")
      .execute();
  }
}
