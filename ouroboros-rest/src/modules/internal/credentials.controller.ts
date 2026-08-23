/**
 * `POST /internal/credentials/lease` — the one route that hands a worker anything at all.
 *
 * Thin on purpose. The policy is `lease.ts`'s, the shape is `lease.resources.ts`'s, the
 * authentication is `internal.guard.ts`'s, and what is left here is the wiring plus three
 * decorators that each say something:
 *
 *   * **`@InternalOnly()`** — the guard's trigger, and what tells `route.table.fixture.ts`
 *     which of the three refusals to expect from this route. See `internal.decorators.ts`
 *     for why that third category has to exist.
 *   * **`@AllowAnonymous()`** — *no session*, which is not the same as *no authentication*.
 *     The caller is a worker process; it holds no cookie and could not be given one, exactly
 *     as a container platform's probe cannot. Without this the global session guard would
 *     refuse the request before the internal guard ever ran, and the answer would be `401
 *     Sign in to continue` — advice a worker cannot take.
 *   * **`VERSION_NEUTRAL`** — this path sits outside `/api/v1`; `internal.paths.ts` is where
 *     that decision is argued.
 *
 * It answers `200` rather than `201`. A lease is not a resource that now exists at a URL —
 * nothing stores it, and there is nothing to `GET` afterwards (see `lease.ts` on why a lease
 * is not a bearer token). `201 Created` would be a promise about a thing this service does
 * not keep.
 */

import { Body, Controller, HttpCode, HttpStatus, Post, VERSION_NEUTRAL } from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

import { InternalOnly } from "./internal.decorators";
import { CREDENTIALS_PATH, LEASE_ROUTE } from "./internal.paths";
import { LeaseService } from "./lease";
import { LeaseRequestDto } from "./lease.dto";
import { leaseResource, type LeaseResource } from "./lease.resources";

@InternalOnly()
@AllowAnonymous()
@Controller({ path: CREDENTIALS_PATH, version: VERSION_NEUTRAL })
export class CredentialsController {
  /**
   * @param leases - Where the policy is. Injected so a suite can drive the route against a
   *   service that grants, and one that refuses, without a database.
   */
  constructor(private readonly leases: LeaseService) {}

  /**
   * Tell a worker how to reach a local provider, for one run.
   *
   * @param request - The provider kind and the run. Validated by the global pipe, which also
   *   refuses a body carrying anything else — see `lease.dto.ts`.
   * @returns The lease. It carries an address and no secret, which is the whole of what this
   *   surface promises.
   * @throws {ForbiddenError} `403 provider_not_leasable` for a cloud provider kind — the
   *   policy, applied before anything is looked up.
   * @throws {NotFoundError} `404 local_provider_not_configured` or `404 run_not_found`.
   */
  @Post(LEASE_ROUTE)
  @HttpCode(HttpStatus.OK)
  async lease(@Body() request: LeaseRequestDto): Promise<LeaseResource> {
    return leaseResource(await this.leases.grant(request));
  }
}
