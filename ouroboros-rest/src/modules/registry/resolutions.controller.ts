/**
 * `GET /api/v1/registry/resolutions/latest?alias=` — the latest stored resolution through an
 * alias ([#589](https://github.com/NobuData/ouroboros/issues/589), decision **R9**).
 *
 * Mockup 21's *RESOLUTION CHAIN* card and its caption — *every hop is inspectable in the run
 * console transcript* — read this; see `resolutions.resources.ts` for the shape and its consumers.
 *
 * **The workspace is the session's, never the request's** — the sentence every controller under
 * `/api/v1` opens with. A snapshot filed under another workspace is simply not found, so the
 * answer is `snapshot: null` rather than a refusal.
 *
 * **Any member may read it.** No `@Roles()`, per the roles guard's rule that a bare route is any of
 * the four: a transcript of what routing did is reading.
 *
 * **Nothing here writes.** Snapshots are append-only in the database and written by the executor
 * (AF.2, #235) through `routing/snapshot.ts`; there is no route that creates one, and a route that
 * did would let a client fabricate a run's history.
 */

import { Controller, Get, Query } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { LatestResolutionQuery } from "./resolutions.dto";
import type { LatestResolutionResource } from "./resolutions.resources";
import { ResolutionSnapshotsService } from "./resolutions.service";

@Controller("registry/resolutions")
export class ResolutionSnapshotsController {
  constructor(private readonly snapshots: ResolutionSnapshotsService) {}

  /**
   * `GET /api/v1/registry/resolutions/latest?alias=coder-max`.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param query - The alias.
   * @returns The alias and its most recent snapshot, or `snapshot: null` when none names it.
   */
  @Get("latest")
  latest(
    @CurrentTenant() tenant: Organization,
    @Query() query: LatestResolutionQuery,
  ): Promise<LatestResolutionResource> {
    return this.snapshots.latest(tenant.id, query.alias);
  }
}
