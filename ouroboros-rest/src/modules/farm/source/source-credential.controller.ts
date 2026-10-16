/**
 * `POST /api/v1/farm/jobs/:id/source-credential` — the runner's one call for its checkout
 * credential (AG.7, [#991](https://github.com/NobuData/ouroboros/issues/991)).
 *
 * **No session**, for the artifact upload's reason (`../artifacts/upload.controller.ts`): the
 * caller is a runner, and what authenticates it is the single-use ticket its `job.offer`
 * carried, as `Authorization: Bearer ouro_src_…`. The route is reached through the farm
 * gateway, which allow-lists it beside the artifact upload.
 */

import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import { Controller, HttpCode, HttpStatus, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";

import { TenantOptional } from "../../tenancy/tenant.decorators";
import { sourceCredentialRefused } from "./source-credential.errors";
import {
  SourceCredentialService,
  type SourceCredentialResource,
} from "./source-credential.service";

/** A build job's uuid, as V040 mints it. */
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

@Controller("farm/jobs")
export class SourceCredentialController {
  /** @param credentials - The redemption. */
  constructor(private readonly credentials: SourceCredentialService) {}

  /**
   * Redeem a ticket for a job's checkout credential.
   *
   * @param id - The build job's uuid. Anything else is the same refusal as a wrong ticket: a
   *   caller learns nothing from the shape of the path either.
   * @param http - The request, for its `Authorization`.
   * @returns The credential, once.
   */
  @Post(":id/source-credential")
  @HttpCode(HttpStatus.OK)
  @AllowAnonymous()
  @TenantOptional()
  async redeem(@Param("id") id: string, @Req() http: Request): Promise<SourceCredentialResource> {
    if (!JOB_ID.test(id)) throw sourceCredentialRefused();

    return this.credentials.redeem(id, http.headers.authorization);
  }
}
