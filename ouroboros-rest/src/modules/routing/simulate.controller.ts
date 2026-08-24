/**
 * `POST /api/v1/routing/simulate` — mockup 06's **Simulate routing**
 * ([#197](https://github.com/NobuData/ouroboros/issues/197)).
 *
 * ---------------------------------------------------------------------------
 * **This class has one dependency, and that is the whole ticket.**
 *
 * The outward requirement is *"not a simplified preview — the actual function, so that what
 * the panel shows is what execution will do"*. The only way to keep a claim like that is to
 * leave nothing here that could make it false: this controller injects
 * {@link ResolutionService} and nothing else, calls one method on it, and returns what came
 * back. There is no repository to read a chain a second way, no mapper to reshape a
 * resolution into a panel's convenience, and no branch that could make a simulated answer
 * differ from an executed one — because there is no second answer for the two to drift apart
 * into. `simulate.controller.spec.ts` asserts the dependency list rather than trusting this
 * paragraph, which is the ticket's *"verified structurally, not by comment"*.
 *
 * The `Resolution` is served **unchanged** for the same reason. It is already the published,
 * versioned shape — camelCase, `resolutionVersion: "r1"`, a `code` and an `explanation` on
 * every decision — and `resolution.ts` says in as many words that the simulate endpoint serves
 * it as it is. A resource mapper between the two would be a second description of one contract.
 *
 * ---------------------------------------------------------------------------
 * **A separate controller from `routing.controller.ts`, on the same path prefix.**
 *
 * `routing.module.ts` keeps the engine and the editor as two services over four shared tables,
 * and the two controllers follow that seam: the editor's routes are Z.2's writes and its two
 * reads, and this is Z.1's function exposed. Z.3 already serves
 * `GET /api/v1/routing/providers` from its own controller under this prefix, so the
 * arrangement is the module's convention rather than an exception made here.
 *
 * ---------------------------------------------------------------------------
 * **Simulating is reading, so every member may.** No `@Roles()`, per the roles guard's rule
 * that a bare route is any of the four — a viewer looking at which model would answer a piece
 * of work has changed nothing, and the endpoint writes nothing at all. What it must not do is
 * cross a workspace, and it cannot: the tenant guard establishes the organization from the
 * session or `X-Ouro-Tenant` and membership-checks it, `@CurrentTenant()` reads what the guard
 * established, and there is no `{orgId}` in the path and no `organizationId` in the body for a
 * client to name another one with.
 *
 * Sessions are required without anything here saying so — the global guard — and a tenant is
 * required *because* nothing here says otherwise: no `@TenantOptional()`, so a session acting
 * in no workspace is a `400 organization_required` before this handler runs.
 */

import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import type { Resolution } from "./resolution";
import { ResolutionService } from "./resolution.service";
import { SimulateRoutingDto } from "./simulate.dto";

@Controller("routing")
export class SimulateController {
  /**
   * @param resolution - Z.1's engine. The one dependency, and deliberately the only one — see
   *   this file's header.
   */
  constructor(private readonly resolution: ResolutionService) {}

  /**
   * `POST /api/v1/routing/simulate` — resolve a task kind against a context, and say why.
   *
   * `200` rather than `201`, and a `POST` rather than a `GET`. Nothing is created — this is a
   * read, and it is idempotent — but a context is a nested document with an array in it, and a
   * query string is a poor way to send one: `?ctx[labels][]=security` is a shape every client
   * library spells differently, and a body is the shape they all agree on. The verb is the
   * envelope, not the intent, which is why the status says so.
   *
   * @param tenant - The workspace, established by the tenant guard. Never a path or a body.
   * @param body - The task kind, and what is known about the work.
   * @returns The resolution: the chain with every hop kept or dropped and a reason for each,
   *   the rules that matched and what they did, any votes, the floor's decision and the cost
   *   cap. An `outcome` of `fail_run` is a **successful** answer carrying a reason — a `200`,
   *   because the caller asked about a route that exists and is entitled to know what it did.
   * @throws NotFoundError `route_not_found` when this workspace has no route for that kind —
   *   the one failure that is not an answer, because there is no chain to explain.
   */
  @Post("simulate")
  @HttpCode(HttpStatus.OK)
  simulate(
    @CurrentTenant() tenant: Organization,
    @Body() body: SimulateRoutingDto,
  ): Promise<Resolution> {
    // `{}` rather than `undefined` so the absent context is the same argument the service's
    // own default is: a resolution asked with nothing known is a legitimate question, and it
    // means *no escalation rule fires*.
    return this.resolution.resolve(tenant.id, body.taskKind, body.ctx ?? {});
  }
}
