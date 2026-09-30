/**
 * `/api/v1/knowledge/context` — the manifest preview and the injection record (BF.5,
 * [#414](https://github.com/NobuData/ouroboros/issues/414)).
 *
 * **The preview is `assemble`, served.** It calls the same method with the same arguments and
 * returns its answer untouched, so what the UI's what-would-inject surface (#421) shows is exactly
 * what a consumer would receive. It records nothing. A `POST` answering `200` because the overrides
 * are a body, but open to every member, `viewer` included — it writes nothing.
 *
 * **Recording is `CONTRIBUTORS`'.** An injection record is a usage number; a `viewer` who could
 * post one could inflate `used 48×`. In-process consumers (the estimator) call the service
 * directly and never reach this route.
 */

import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { CONTRIBUTORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { PreviewContextBody, RecordInjectionBody } from "./context-assembly.dto";
import type { ContextManifest, InjectionResource } from "./context-assembly.resources";
import { ContextAssemblyService } from "./context-assembly.service";

@Controller("knowledge/context")
export class ContextAssemblyController {
  /** @param assembly - The one resolution. */
  constructor(private readonly assembly: ContextAssemblyService) {}

  /**
   * `POST /api/v1/knowledge/context/preview` — for this scope and consumer, exactly what would go
   * in, and what would not and why. Records nothing.
   *
   * @param tenant - The workspace.
   * @param body - Consumer, scope, overrides, budget.
   * @returns The manifest `assemble` produces for the same arguments.
   */
  @Post("preview")
  @HttpCode(HttpStatus.OK)
  preview(
    @CurrentTenant() tenant: Organization,
    @Body() body: PreviewContextBody,
  ): Promise<ContextManifest> {
    return this.assembly.assemble(
      tenant.id,
      { repo: body.repo ?? null, workflow: body.workflow ?? null },
      body.consumer,
      { overrides: body.overrides, budgetTokens: body.budgetTokens },
    );
  }

  /**
   * `POST /api/v1/knowledge/context/injections` — record what a consumer actually injected.
   *
   * @param tenant - The workspace.
   * @param body - The consumer, its reference, the ids and the manifest's hash.
   * @returns The stored record.
   */
  @Roles(...CONTRIBUTORS)
  @Post("injections")
  @HttpCode(HttpStatus.CREATED)
  record(
    @CurrentTenant() tenant: Organization,
    @Body() body: RecordInjectionBody,
  ): Promise<InjectionResource> {
    return this.assembly.record(tenant.id, body);
  }
}
