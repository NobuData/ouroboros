/**
 * `/api/v1/skills` — the skills registry (BF.1,
 * [#410](https://github.com/NobuData/ouroboros/issues/410)).
 *
 * **The workspace is the session's, never the request's** — no `{orgId}` in a path; the tenant
 * guard resolves and membership-checks the active organization, and a session in no workspace is a
 * `400 organization_required` before any handler runs.
 *
 * **Member reads; admin and above write; `required` is an owner's.** The reads carry no `@Roles()`
 * — every member including a `viewer`. The writes carry `@Roles(...ADMINISTRATORS)`. The
 * `required` flag is narrower than any route: `PATCH` is an administrator's, and the service
 * refuses a change to `required` from anybody but an owner with `403 skill_required_owner_only`,
 * because a route-level role cannot see which field was sent.
 *
 * **`stats` is declared before `:slug`, and the order is the route** — Express matches in
 * registration order, so `GET …/stats` below `GET …/:slug` would be read as a skill named
 * `stats`. `skills.controller.spec.ts` holds the order.
 *
 * **`…/code` is the code view's document API** for `skills/<slug>.skill.md` (X.2, #181): the same
 * file shape and `If-Match` guard as `…/workflows/{slug}/code`, so skills edit in the same frame as
 * workflows, and a save there is a draft-save here.
 */

import {
  Body,
  Controller,
  Delete,
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
import type { ActiveMembership } from "../tenancy/tenant.context";
import { CurrentMember, CurrentTenant } from "../tenancy/tenant.decorators";
import {
  CreateSkillBody,
  MoveSkillScopeBody,
  PublishSkillBody,
  ReadSkillQuery,
  SaveSkillDocumentBody,
  ScopeTargetBody,
  SkillSlugParams,
  SkillStatsQuery,
  UpdateSkillBody,
} from "./skills.dto";
import type {
  SkillCode,
  SkillDetail,
  SkillDraft,
  SkillList,
  SkillScopePreview,
  SkillStats,
  SkillSummary,
  SkillVersionResource,
  SkillVersionSummary,
} from "./skills.resources";
import { SkillsService } from "./skills.service";

@Controller("skills")
export class SkillsController {
  /** @param skills - The registry's rules. */
  constructor(private readonly skills: SkillsService) {}

  /**
   * `GET /api/v1/skills` — mockup 14's skills card.
   *
   * @param tenant - The workspace.
   * @returns Every skill, and the active count.
   */
  @Get()
  list(@CurrentTenant() tenant: Organization): Promise<SkillList> {
    return this.skills.list(tenant.id);
  }

  /**
   * `POST /api/v1/skills` — **+ New skill**: the skill and its first draft, nothing published.
   *
   * @param tenant - The workspace.
   * @param body - The document, and optionally its slug and scope.
   * @returns The skill, `201`.
   */
  @Roles(...ADMINISTRATORS)
  @Post()
  create(
    @CurrentTenant() tenant: Organization,
    @Body() body: CreateSkillBody,
  ): Promise<SkillDetail> {
    return this.skills.create(tenant.id, body);
  }

  /**
   * `GET /api/v1/skills/stats` — the Used-by column, counted over a stated window.
   *
   * Declared above `:slug`; see this file's header.
   *
   * @param tenant - The workspace.
   * @param query - `days`, 1–365, default 30.
   * @returns The window and each skill's figures.
   */
  @Get("stats")
  stats(
    @CurrentTenant() tenant: Organization,
    @Query() query: SkillStatsQuery,
  ): Promise<SkillStats> {
    return this.skills.stats(tenant.id, query.days);
  }

  /**
   * `GET /api/v1/skills/{slug}` — one skill, a version, its draft slot.
   *
   * @param tenant - The workspace.
   * @param params - The slug.
   * @param query - `version`, for a published version other than the one in force.
   * @returns The detail.
   */
  @Get(":slug")
  read(
    @CurrentTenant() tenant: Organization,
    @Param() params: SkillSlugParams,
    @Query() query: ReadSkillQuery,
  ): Promise<SkillDetail> {
    return this.skills.read(tenant.id, params.slug, query.version);
  }

  /**
   * `PATCH /api/v1/skills/{slug}` — the switch, the lock and the draft flag.
   *
   * @param tenant - The workspace.
   * @param member - The caller's membership — `required` is an owner's.
   * @param params - The slug.
   * @param body - What to change.
   * @returns The skill after the change.
   */
  @Roles(...ADMINISTRATORS)
  @Patch(":slug")
  update(
    @CurrentTenant() tenant: Organization,
    @CurrentMember() member: ActiveMembership,
    @Param() params: SkillSlugParams,
    @Body() body: UpdateSkillBody,
  ): Promise<SkillSummary> {
    return this.skills.update(tenant.id, params.slug, body, member.roles);
  }

  /**
   * `DELETE /api/v1/skills/{slug}` — guarded: refused while a published workflow references it.
   *
   * @param tenant - The workspace.
   * @param params - The slug.
   * @returns Nothing, `204`.
   */
  @Roles(...ADMINISTRATORS)
  @Delete(":slug")
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@CurrentTenant() tenant: Organization, @Param() params: SkillSlugParams): Promise<void> {
    return this.skills.delete(tenant.id, params.slug);
  }

  /**
   * `PUT /api/v1/skills/{slug}/draft` — draft-save, guarded by `If-Match`.
   *
   * @param tenant - The workspace.
   * @param params - The slug.
   * @param ifMatch - The draft etag the document was edited from.
   * @param body - The whole document.
   * @returns The draft after the write.
   */
  @Roles(...ADMINISTRATORS)
  @Put(":slug/draft")
  saveDraft(
    @CurrentTenant() tenant: Organization,
    @Param() params: SkillSlugParams,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: SaveSkillDocumentBody,
  ): Promise<SkillDraft> {
    return this.skills.saveDraft(tenant.id, params.slug, ifMatch, body.text);
  }

  /**
   * `POST /api/v1/skills/{slug}/publish` — the draft becomes the next immutable version. `200`: a
   * version is read back through `GET …/{slug}?version=`, not a resource of its own.
   *
   * @param tenant - The workspace.
   * @param params - The slug.
   * @param principal - The session, for `published_by`.
   * @param body - The change note.
   * @returns The version now in force.
   */
  @Roles(...ADMINISTRATORS)
  @Post(":slug/publish")
  @HttpCode(HttpStatus.OK)
  publish(
    @CurrentTenant() tenant: Organization,
    @Param() params: SkillSlugParams,
    @Session() principal: Principal,
    @Body() body: PublishSkillBody,
  ): Promise<SkillVersionResource> {
    return this.skills.publish(tenant.id, params.slug, body, principal.user.id);
  }

  /**
   * `GET /api/v1/skills/{slug}/versions` — the history, newest first.
   *
   * @param tenant - The workspace.
   * @param params - The slug.
   * @param query - `limit` and `offset`.
   * @returns The page, without documents.
   */
  @Get(":slug/versions")
  versions(
    @CurrentTenant() tenant: Organization,
    @Param() params: SkillSlugParams,
    @Query() query: PageQuery,
  ): Promise<Page<SkillVersionSummary>> {
    return this.skills.versions(tenant.id, params.slug, query);
  }

  /**
   * `POST /api/v1/skills/{slug}/scope/preview` — what a scope move would do. Writes nothing, so
   * every member may ask; `200`.
   *
   * @param tenant - The workspace.
   * @param params - The slug.
   * @param body - The destination.
   * @returns The preview and its token.
   */
  @Post(":slug/scope/preview")
  @HttpCode(HttpStatus.OK)
  previewScope(
    @CurrentTenant() tenant: Organization,
    @Param() params: SkillSlugParams,
    @Body() body: ScopeTargetBody,
  ): Promise<SkillScopePreview> {
    return this.skills.previewScope(tenant.id, params.slug, body);
  }

  /**
   * `POST /api/v1/skills/{slug}/scope` — commit a previewed move. `200`.
   *
   * @param tenant - The workspace.
   * @param params - The slug.
   * @param body - The destination, the preview token, and `resolve` for clashes.
   * @returns The skill in its new scope.
   */
  @Roles(...ADMINISTRATORS)
  @Post(":slug/scope")
  @HttpCode(HttpStatus.OK)
  moveScope(
    @CurrentTenant() tenant: Organization,
    @Param() params: SkillSlugParams,
    @Body() body: MoveSkillScopeBody,
  ): Promise<SkillSummary> {
    return this.skills.moveScope(tenant.id, params.slug, body);
  }

  /**
   * `GET /api/v1/skills/{slug}/code` — `skills/<slug>.skill.md` for the code view.
   *
   * @param tenant - The workspace.
   * @param params - The slug.
   * @param query - `version` for a published version, read-only.
   * @returns The file.
   */
  @Get(":slug/code")
  readCode(
    @CurrentTenant() tenant: Organization,
    @Param() params: SkillSlugParams,
    @Query() query: ReadSkillQuery,
  ): Promise<SkillCode> {
    return this.skills.readCode(tenant.id, params.slug, query.version);
  }

  /**
   * `PUT /api/v1/skills/{slug}/code` — save the file into the draft, guarded by `If-Match`.
   *
   * @param tenant - The workspace.
   * @param params - The slug.
   * @param ifMatch - The draft etag the file was edited from.
   * @param body - The whole file.
   * @returns The file as stored, with the new etag.
   */
  @Roles(...ADMINISTRATORS)
  @Put(":slug/code")
  saveCode(
    @CurrentTenant() tenant: Organization,
    @Param() params: SkillSlugParams,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: SaveSkillDocumentBody,
  ): Promise<SkillCode> {
    return this.skills.saveCode(tenant.id, params.slug, ifMatch, body.text);
  }
}
