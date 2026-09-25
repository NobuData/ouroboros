/**
 * `POST /api/v1/farm/jobs/:id/artifacts` — the job-scoped artifact upload (AT.2,
 * [#330](https://github.com/NobuData/ouroboros/issues/330), decision **T4**).
 *
 * ```
 * POST /farm/jobs/:id/artifacts   @AllowAnonymous   authenticated by the job's single-use upload token
 *   Authorization: Bearer ouro_upl_…
 *   Content-Type: multipart/form-data
 *     manifest   the agent's account of every collected file
 *     file × n   each sent file, its manifest name as the part's filename
 * ```
 *
 * **Why here and not under `/internal`.** The issue drew this route as `/internal/jobs/:id/artifacts`,
 * but `/internal/*` is the engine's surface: behind the shared secret, and never exposed — the
 * hosting guide requires a farm host to refuse it. A runner is somebody else's machine, outside
 * the network, and already reaches this deployment at `/api/v1/farm/*` (its WebSocket, its
 * registration). So the upload sits beside them, and like the registration routes it is
 * `@AllowAnonymous()` in the precise sense `registration.controller.ts` gives that word: no
 * session, and a credential named in the handler — here, the token its offer carried.
 *
 * **It is not the control WebSocket**, deliberately: a large rig capture on the socket that carries
 * heartbeats degrades exactly the channel that decides whether a runner looks alive.
 *
 * **It names no workspace.** The workspace is the job's, found through the token's ledger; there is
 * no tenant header, and nothing a caller could put in one would change which rows are written.
 */

import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import { Controller, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";

import { TenantOptional } from "../../tenancy/tenant.decorators";
import { uploadRefused } from "./upload.errors";
import { ArtifactUploadService, type UploadReceipt } from "./upload.service";

/** A build job's uuid, as V040 mints it. */
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

@Controller("farm/jobs")
export class ArtifactUploadController {
  /**
   * @param uploads - The upload service.
   */
  constructor(private readonly uploads: ArtifactUploadService) {}

  /**
   * Accept a job's artifacts.
   *
   * @param id - The build job's uuid. Anything else is the same refusal as a wrong token: a
   *   caller learns nothing from the shape of the path either.
   * @param http - The request: its `Authorization`, its `Content-Type`, and its body, streamed.
   * @returns The receipt — every file stored, truncated or skipped, the job warnings, and the
   *   parsed attempt's counts.
   */
  @Post(":id/artifacts")
  @AllowAnonymous()
  @TenantOptional()
  async upload(@Param("id") id: string, @Req() http: Request): Promise<UploadReceipt> {
    if (!JOB_ID.test(id)) {
      http.resume();
      throw uploadRefused();
    }

    return this.uploads.accept({
      jobId: id,
      authorization: http.headers.authorization,
      contentType: http.headers["content-type"],
      body: http,
    });
  }
}
