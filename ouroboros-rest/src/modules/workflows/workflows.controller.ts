/**
 * `/api/v1/workflows` — the whole workflow lifecycle: the rail, the canvas, the draft, and
 * the **Publish v15** button (P.3, [#134](https://github.com/NobuData/ouroboros/issues/134)).
 *
 * **The workspace is the session's, never the request's** — the sentence every controller in
 * this API opens with, because it is the same property: no `{orgId}` in the path, the tenant
 * guard resolves and membership-checks the active organization, and these handlers read what it
 * established. Sessions are required without anything here saying so (the global guard), and a
 * tenant is required *because* nothing here says otherwise: no `@TenantOptional()`, so a
 * session acting in no workspace is a `400 organization_required` before any handler runs.
 *
 * **Reading is every member's, writing is an administrator's.** The ticket's role policy, and
 * it is spelled the way the roles guard wants it: the three reads carry no `@Roles()`, which is
 * *every member including a `viewer`* — a viewer is a role that exists to be able to look at a
 * workflow — and the four writes carry `@Roles(...ADMINISTRATORS)`. `CONTRIBUTORS` would have
 * been the wrong list: a `member` is somebody who works here, and publishing changes what every
 * future run of this workspace does.
 *
 * **`If-Match` is a header, and it is read here rather than in a DTO.** A precondition is not a
 * field of the body — there is nothing for `class-validator` to say about it, and a DTO that
 * carried it would be a body shape describing a header. The service decides what a missing one
 * means, which is a `400` and not a conflict: forgetting the guard and losing a race are
 * different mistakes and a client fixes them differently.
 */

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";

import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { PageQuery, type Page } from "../tenancy/pagination";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import {
  CreateWorkflowBody,
  PublishWorkflowBody,
  ReadWorkflowQuery,
  SaveDraftBody,
  UpdateWorkflowBody,
  WorkflowParams,
} from "./workflows.dto";
import type {
  WorkflowDetail,
  WorkflowDraft,
  WorkflowSummary,
  WorkflowVersionResource,
  WorkflowVersionSummary,
} from "./workflows.resources";
import { WorkflowsService, type WorkflowRail } from "./workflows.service";

@Controller("workflows")
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  /**
   * `GET /api/v1/workflows` — the rail.
   *
   * P.4's entries, captions and usage shares as they stand right now: there is no stored
   * caption and no stored stage count, so a definition published a second ago is already
   * reflected here.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @returns Every non-archived workflow, in the rail's order.
   */
  @Get()
  list(@CurrentTenant() tenant: Organization): Promise<WorkflowRail> {
    return this.workflows.list(tenant.id);
  }

  /**
   * `POST /api/v1/workflows` — **+ New workflow**, blank or from a template stub.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param body - The title, the slug if one was chosen, and the starting document if any.
   * @returns The workflow and its draft, with `201`. Nothing is published: the canvas opens on
   *   the draft, and the first **Publish** is what makes a version.
   */
  @Roles(...ADMINISTRATORS)
  @Post()
  create(
    @CurrentTenant() tenant: Organization,
    @Body() body: CreateWorkflowBody,
  ): Promise<WorkflowDetail> {
    return this.workflows.create(tenant.id, body);
  }

  /**
   * `GET /api/v1/workflows/{id}` — one workflow, its draft, and one version.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The workflow's id, validated as a uuid by the pipe.
   * @param query - `version` to read a historical definition instead of the one in force.
   * @returns The detail.
   */
  @Get(":id")
  read(
    @CurrentTenant() tenant: Organization,
    @Param() params: WorkflowParams,
    @Query() query: ReadWorkflowQuery,
  ): Promise<WorkflowDetail> {
    return this.workflows.read(tenant.id, params.id, query.version);
  }

  /**
   * `PATCH /api/v1/workflows/{id}` — rename, pause, resume or archive.
   *
   * Pausing is what flips the rail to the mockup's err-dot state; the caption that reads
   * `5 stages · paused` follows from the same column with no second write.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The workflow's id.
   * @param body - The title and/or the status.
   * @returns The workflow after the change.
   */
  @Roles(...ADMINISTRATORS)
  @Patch(":id")
  update(
    @CurrentTenant() tenant: Organization,
    @Param() params: WorkflowParams,
    @Body() body: UpdateWorkflowBody,
  ): Promise<WorkflowSummary> {
    return this.workflows.update(tenant.id, params.id, body);
  }

  /**
   * `PUT /api/v1/workflows/{id}/draft` — autosave, guarded.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The workflow's id.
   * @param ifMatch - The `If-Match` header, verbatim — the etag of the draft this write is
   *   based on. Required; see this file's header on why it is read here.
   * @param body - The whole document, as the canvas holds it.
   * @returns The draft slot after the write, carrying the etag for the next save.
   */
  @Roles(...ADMINISTRATORS)
  @Put(":id/draft")
  saveDraft(
    @CurrentTenant() tenant: Organization,
    @Param() params: WorkflowParams,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: SaveDraftBody,
  ): Promise<WorkflowDraft> {
    return this.workflows.saveDraft(tenant.id, params.id, ifMatch, body);
  }

  /**
   * `POST /api/v1/workflows/{id}/publish` — the two-validator gate, then the next version.
   *
   * `200` rather than `201`: publishing creates a version, and the version is not a resource
   * with a URL of its own — it is read back through `GET …/{id}?version=15`, which is the same
   * resource this workflow already had. A `201` would owe a `Location` that names nothing new.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The workflow's id.
   * @param principal - The session, for `workflow_versions.published_by`.
   * @param body - The change note, when the publisher wrote one.
   * @returns The version that is now in force.
   */
  @Roles(...ADMINISTRATORS)
  @Post(":id/publish")
  @HttpCode(HttpStatus.OK)
  publish(
    @CurrentTenant() tenant: Organization,
    @Param() params: WorkflowParams,
    @Session() principal: Principal,
    @Body() body: PublishWorkflowBody,
  ): Promise<WorkflowVersionResource> {
    return this.workflows.publish(tenant.id, params.id, body, principal.user.id);
  }

  /**
   * `GET /api/v1/workflows/{id}/versions` — the history, newest first.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The workflow's id.
   * @param query - `limit` and `offset`.
   * @returns The page. The documents are deliberately absent — one is read by number through
   *   `GET …/{id}?version=`.
   */
  @Get(":id/versions")
  versions(
    @CurrentTenant() tenant: Organization,
    @Param() params: WorkflowParams,
    @Query() query: PageQuery,
  ): Promise<Page<WorkflowVersionSummary>> {
    return this.workflows.versions(tenant.id, params.id, query);
  }
}
