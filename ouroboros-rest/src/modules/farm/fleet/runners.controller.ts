/**
 * `/api/v1/farm/runners` — mockup 08's `⋯` menu.
 *
 * AH.6 ([#254](https://github.com/NobuData/ouroboros/issues/254)), for AI.5
 * ([#260](https://github.com/NobuData/ouroboros/issues/260)).
 *
 * **The workspace is the session's, never the request's.** A runner of another workspace is a
 * `404`, whoever asks — `fleet.repository.ts` puts `organization_id` on every statement.
 *
 * ---------------------------------------------------------------------------
 * **All three are `@Roles(...ADMINISTRATORS)`.** Draining a machine withdraws capacity a
 * workspace is paying for and retiring one takes it out of the fleet, which is administering
 * the farm rather than using it. Submitting a build is `member` and above — `jobs.controller.ts`
 * draws that line, and this is the other side of it.
 *
 * ---------------------------------------------------------------------------
 * **Drain is a `POST` to a sub-resource and remove is a `DELETE`, and the asymmetry is real.**
 * A drain changes what a machine will accept and nothing is removed, which is the same reason
 * `POST /farm/jobs/:id/cancel` is not a `DELETE`. A removal *is* a retirement — the row
 * survives, because its builds reference it, but the machine leaves the fleet and every count
 * of it. `DELETE` is what a caller means by that, and V040 keeping the row is an
 * implementation of *removed*, not a contradiction of it.
 */

import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../../auth/principal";
import type { Organization } from "../../db/schema";
import { ADMINISTRATORS, Roles } from "../../tenancy/roles.guard";
import { CurrentTenant } from "../../tenancy/tenant.decorators";
import type { RunnerResource } from "./fleet.resources";
import { RunnersService, type LifecycleResult } from "./runners.service";

@Controller("farm/runners")
export class FarmRunnersController {
  /** @param runners - The lifecycle actions. */
  constructor(private readonly runners: RunnersService) {}

  /**
   * Withdraw a runner from dispatch — it declines new offers and finishes what it is running.
   *
   * @param tenant - The workspace.
   * @param principal - Who decided.
   * @param id - The runner.
   * @returns The runner, and whether the frame reached a live session. **The pill does not
   *   change here**: `status` is what the agent's own heartbeat reports, and it will read
   *   `draining` on the next one. `desiredState` is what this request wrote.
   */
  @Post(":id/drain")
  @HttpCode(HttpStatus.OK)
  @Roles(...ADMINISTRATORS)
  drain(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<LifecycleResult> {
    return this.runners.drain(tenant, principal.user.id, id);
  }

  /**
   * Return a drained runner to dispatch.
   *
   * @param tenant - The workspace.
   * @param principal - Who decided.
   * @param id - The runner.
   * @returns The runner, and whether the frame reached a live session.
   */
  @Post(":id/undrain")
  @HttpCode(HttpStatus.OK)
  @Roles(...ADMINISTRATORS)
  undrain(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<LifecycleResult> {
    return this.runners.undrain(tenant, principal.user.id, id);
  }

  /**
   * Retire a runner — **guarded to machines that are offline or drained**.
   *
   * @param tenant - The workspace.
   * @param principal - Who decided.
   * @param id - The runner.
   * @returns The runner, `removed` — a body rather than a `204`, so a client can see the
   *   state it is now in without a second request.
   */
  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @Roles(...ADMINISTRATORS)
  remove(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<RunnerResource> {
    return this.runners.remove(tenant, principal.user.id, id);
  }
}
