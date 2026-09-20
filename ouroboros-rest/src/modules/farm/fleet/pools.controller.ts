/**
 * `/api/v1/farm/pools` — the POOLS card and its configuration sheet.
 *
 * AH.6 ([#254](https://github.com/NobuData/ouroboros/issues/254)), for AI.4
 * ([#259](https://github.com/NobuData/ouroboros/issues/259)).
 *
 * **The workspace is the session's, never the request's.**
 *
 * **The read is every member's and the three writes are `@Roles(...ADMINISTRATORS)`** — the
 * issue's role gate, and the same split `fleet.controller.ts` makes. A pool decides what a
 * build runs under, including the environment it may carry onto a machine this product does
 * not administer, so changing one is administering the workspace.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../../auth/principal";
import type { Organization } from "../../db/schema";
import { ADMINISTRATORS, Roles } from "../../tenancy/roles.guard";
import { CurrentTenant } from "../../tenancy/tenant.decorators";
import { CreatePoolDto, UpdatePoolDto } from "./fleet.dto";
import type { PoolResource } from "./fleet.resources";
import { PoolsService } from "./pools.service";

@Controller("farm/pools")
export class FarmPoolsController {
  /** @param pools - The CRUD. */
  constructor(private readonly pools: PoolsService) {}

  /**
   * The workspace's pools, with their runner counts.
   *
   * @param tenant - The workspace.
   * @returns The pools, by name.
   */
  @Get()
  list(@CurrentTenant() tenant: Organization): Promise<PoolResource[]> {
    return this.pools.list(tenant.id);
  }

  /**
   * Create a pool.
   *
   * @param tenant - The workspace.
   * @param principal - Who created it.
   * @param request - The pool.
   * @returns The pool, `201`.
   */
  @Post()
  @Roles(...ADMINISTRATORS)
  create(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() request: CreatePoolDto,
  ): Promise<PoolResource> {
    return this.pools.create(tenant, principal.user.id, request);
  }

  /**
   * Change a pool — its configuration, and the card's enabled switch.
   *
   * `PATCH`, so a field the body does not name is left alone. `autoscalePref` is stored and
   * **inert** (decision **B9**): it round-trips unchanged and nothing acts on it until AJ.1
   * ([#263](https://github.com/NobuData/ouroboros/issues/263)).
   *
   * @param tenant - The workspace.
   * @param principal - Who changed it.
   * @param id - The pool.
   * @param request - The fields to change.
   * @returns The pool as it now stands.
   */
  @Patch(":id")
  @Roles(...ADMINISTRATORS)
  update(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() request: UpdatePoolDto,
  ): Promise<PoolResource> {
    return this.pools.update(tenant, principal.user.id, id, request);
  }

  /**
   * Delete a pool — only one nothing points at.
   *
   * A real `DELETE`, unlike a runner's: nothing references an empty pool, so the row goes.
   * While anything does, this answers `409` naming the counts and suggesting the thing the
   * caller usually meant — disable it.
   *
   * @param tenant - The workspace.
   * @param principal - Who deleted it.
   * @param id - The pool.
   * @returns Nothing, `204`. There is no resource left to describe.
   */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(...ADMINISTRATORS)
  remove(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.pools.remove(tenant, principal.user.id, id);
  }
}
