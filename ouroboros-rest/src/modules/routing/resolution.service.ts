/**
 * `ResolutionService.resolve(taskKind, ctx)` — the load, and then the pure function.
 *
 * Z.1 ([#194](https://github.com/NobuData/ouroboros/issues/194)), decision **M6**. This class
 * is deliberately thin, and the thinness is the design: everything that *decides* anything is
 * in `resolve.ts`, which touches no database and no clock, and everything here is the reading
 * that turns four tables and a health snapshot into that function's argument.
 *
 * The split is what makes **Simulate routing** (Z.4,
 * [#197](https://github.com/NobuData/ouroboros/issues/197)) honest. The simulator does not
 * re-implement routing and does not mock it — it calls this method, which calls that
 * function, which is the same code an execution bridge (WF-T.6,
 * [#160](https://github.com/NobuData/ouroboros/issues/160)) will call. There is no second
 * answer to *which model runs this* for the two to drift apart into.
 *
 * ---------------------------------------------------------------------------
 * **Health arrives from `ProviderHealthService.snapshots`, which is Z.3's exported contract.**
 *
 * Not from a check performed here, and not from `provider_connections.status` selected
 * alongside the chain — see `routing.repository.ts`. Z.3
 * ([#196](https://github.com/NobuData/ouroboros/issues/196)) is passive-first by design and
 * says so in its controller: a resolution that probed a provider would put an outbound
 * request on the path of every routing decision and would still be reading a number that was
 * true a moment ago.
 *
 * ---------------------------------------------------------------------------
 * **The four reads that follow the route are issued together.** They are independent — the
 * hops, the workspace's aliases, its rules and its health are four unrelated questions — and
 * a `Promise.all` is what keeps a resolution one round trip deep instead of four. The route
 * itself cannot join them, because whether it exists is what decides the `404`.
 */

import { Injectable, Optional } from "@nestjs/common";

import {
  type PolicyVerdict,
  type SpendGuardValue,
  effectivePerRunCap,
} from "../policies/policy-resolution";
import { PolicyResolutionService } from "../policies/policy-resolution.service";
import { ProviderHealthService } from "../provider-health/provider-health.service";
import type { ResolutionContext } from "./context";
import type { Resolution } from "./resolution";
import { resolve } from "./resolve";
import { routeNotFound } from "./routing.errors";
import { RoutingRepository } from "./routing.repository";
import { toAliasSpec, toChainHop, toRouteSpec, toRuleSpec } from "./routing.rows";

@Injectable()
export class ResolutionService {
  /**
   * @param routes - The four reads. Injected, never constructed.
   * @param health - Z.3's service, for its snapshots and for nothing else. This module never
   *   asks it to check anything: `sweep()` belongs to a timer, and a resolution that
   *   triggered one would make routing latency depend on a provider's.
   */
  constructor(
    private readonly routes: RoutingRepository,
    private readonly health: ProviderHealthService,
    @Optional() private readonly policies?: PolicyResolutionService,
  ) {}

  /**
   * Resolve a task kind to an ordered concrete chain, with explanations.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param taskKind - The kind of work — `implement`, `review`, `commit-msg`. A
   *   `task_kinds.name`, and the row of mockup 06's matrix being asked about.
   * @param context - What is known about the work: its effort, its labels, its diff kind, its
   *   repository. Defaults to `{}`, which is a legitimate question — it means *no escalation
   *   rule fires*, not *every rule fires*. See `context.ts`.
   * @returns The resolution. `outcome: "fail_run"` is a **successful** answer carrying a
   *   reason, not an error: the caller asked about a route that exists and is entitled to
   *   know what it did.
   * @throws NotFoundError `route_not_found` when this workspace has no route for that kind —
   *   the one failure that is not an answer, because there is no chain to explain.
   */
  async resolve(
    organizationId: string,
    taskKind: string,
    context: ResolutionContext = {},
  ): Promise<Resolution> {
    const route = await this.routes.route(organizationId, taskKind);

    if (route === undefined) {
      throw routeNotFound(taskKind);
    }

    const [hops, aliases, rules, health] = await Promise.all([
      this.routes.hops(organizationId, route.route_id),
      this.routes.aliases(organizationId),
      this.routes.rules(organizationId),
      this.health.snapshots(organizationId),
    ]);

    const resolution = resolve({
      route: toRouteSpec(route, taskKind),
      hops: hops.map(toChainHop),
      aliases: aliases.map(toAliasSpec),
      rules: rules.map(toRuleSpec),
      health,
      context,
    });

    return this.policies === undefined
      ? resolution
      : withSpendGuard(resolution, await this.policies.resolve(organizationId, "spend_guard"));
  }
}

/**
 * A resolution under the org policy's `spend_guard` (BQ.2, #481): the cap that travels to the
 * executor becomes the **stricter** of the route's and the guard's per-run cap, and the resolution
 * says which one it is — so the executor's `cost_cap_exceeded` names the limit that stopped the run.
 * Neither layer can loosen the other; a guard that is off leaves the route's cap alone.
 *
 * @param resolution - The resolution, with the route's own cap.
 * @param guard - `spend_guard`'s verdict.
 * @returns The resolution with the effective cap and its source.
 */
export function withSpendGuard(
  resolution: Resolution,
  guard: PolicyVerdict<SpendGuardValue>,
): Resolution {
  const cap = effectivePerRunCap(resolution.maxCostCents, guard);

  return {
    ...resolution,
    maxCostCents: cap.capCents,
    costCap: {
      limit: cap.limit,
      ruleId: cap.limit === "spend_guard" ? "spend_guard" : null,
      policyVersion: cap.version,
    },
  };
}
