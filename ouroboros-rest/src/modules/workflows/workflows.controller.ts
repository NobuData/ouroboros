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
 * it is spelled the way the roles guard wants it: the reads carry no `@Roles()`, which is
 * *every member including a `viewer`* — a viewer is a role that exists to be able to look at a
 * workflow — and the writes carry `@Roles(...ADMINISTRATORS)`, the code view's save among them
 * (U.3, [#167](https://github.com/NobuData/ouroboros/issues/167)). `CONTRIBUTORS` would have
 * been the wrong list: a `member` is somebody who works here, and publishing changes what every
 * future run of this workspace does. The one write with no `@Roles()` is `PUT …/code-config`,
 * which refuses everybody with the same `405`.
 *
 * **`catalog`, `code-symbols`, `code-tree` and `code-config` are declared before `:id`, and the
 * order is the route.** Express matches in registration order and Nest registers handlers in
 * declaration order, so a `GET …/catalog` declared below `GET …/:id` would be answered by the
 * detail — as a `422` for an id that is not a uuid. `workflows.controller.spec.ts` holds the order.
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
  Res,
} from "@nestjs/common";

import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { PageQuery, type Page } from "../tenancy/pagination";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import type { StageCatalog } from "./catalog.resources";
import { WorkflowCatalogService } from "./catalog.service";
import {
  CONFIG_FILE_PATH,
  type WorkflowCode,
  type WorkflowCodeChecks,
  type WorkflowCodeConfig,
  type WorkflowCodeTree,
  type WorkflowCodeValidation,
} from "./code.resources";
import { WorkflowCodeService } from "./code.service";
import type { CodeSymbolTable } from "./code.symbols";
import type { WorkflowDryRunResource } from "./dry-run.resources";
import { WorkflowDryRunService } from "./dry-run.service";
import {
  CreateWorkflowBody,
  DryRunWorkflowBody,
  PublishWorkflowBody,
  ReadWorkflowQuery,
  SaveDraftBody,
  SaveWorkflowCodeBody,
  UpdateWorkflowBody,
  WorkflowParams,
  WorkflowSlugParams,
} from "./workflows.dto";
import { codeReadOnly } from "./workflows.errors";
import type {
  WorkflowDetail,
  WorkflowDraft,
  WorkflowSummary,
  WorkflowVersionResource,
  WorkflowVersionSummary,
} from "./workflows.resources";
import { WorkflowsService, type WorkflowRail } from "./workflows.service";

/** The one thing the `405` handler does to a response: set its `Allow` header. */
export interface HeaderTarget {
  /** Express's `response.setHeader`, narrowed to the call made. */
  setHeader(name: string, value: string): unknown;
}

@Controller("workflows")
export class WorkflowsController {
  /**
   * @param workflows - The lifecycle's rules.
   * @param stages - The stage catalog (R.3).
   * @param code - The code view (U.3).
   * @param dryRuns - The studio's dry run (S.6).
   */
  constructor(
    private readonly workflows: WorkflowsService,
    private readonly stages: WorkflowCatalogService,
    private readonly code: WorkflowCodeService,
    private readonly dryRuns: WorkflowDryRunService,
  ) {}

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
   * `GET /api/v1/workflows/catalog` — the stage catalog (R.3,
   * [#145](https://github.com/NobuData/ouroboros/issues/145)).
   *
   * What **Add stage ▾** and the inspector render from: every node type the published DSL
   * schema declares, with its glyph, treatment class, config schema and defaults, and the
   * workspace's skill and task-route suggestions. Every member may read it — a viewer's
   * inspector draws the same forms, read-only.
   *
   * Declared above `read` on purpose; see this file's header.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @returns The catalog.
   */
  @Get("catalog")
  catalog(@CurrentTenant() tenant: Organization): Promise<StageCatalog> {
    return this.stages.catalog(tenant.id);
  }

  /**
   * `GET /api/v1/workflows/code-symbols` — the code editor's symbol table (W.1,
   * [#177](https://github.com/NobuData/ouroboros/issues/177)).
   *
   * What mockup 05's completions and hover cards read: the grammar's scopes and symbols, each
   * type, value and doc read from the published schema, and the workspace's task-route and skill
   * suggestions. Every member may read it, for the reason the catalog gives.
   *
   * Declared above `read` on purpose; see this file's header.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @returns The table.
   */
  @Get("code-symbols")
  codeSymbols(@CurrentTenant() tenant: Organization): Promise<CodeSymbolTable> {
    return this.stages.codeSymbols(tenant.id);
  }

  /**
   * `GET /api/v1/workflows/code-tree` — the code view's explorer (U.3,
   * [#167](https://github.com/NobuData/ouroboros/issues/167)).
   *
   * Decision **C6**: a `workflows/<slug>.loop.ts` per workflow on the rail, in the rail's order,
   * and `ouroboros.config.ts` — and nothing that does not exist. Every member may read it.
   *
   * Declared above `read` on purpose; see this file's header.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @returns The files.
   */
  @Get("code-tree")
  codeTree(@CurrentTenant() tenant: Organization): Promise<WorkflowCodeTree> {
    return this.code.tree(tenant.id);
  }

  /**
   * `GET /api/v1/workflows/code-config` — `ouroboros.config.ts`, read-only.
   *
   * The workspace's workflow configuration as a file: its workflows, their statuses and the
   * version of each in force, printed from the rail's statement. Every member may read it.
   *
   * Declared above `read` on purpose; see this file's header.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @returns The file, with `readOnly: true`.
   */
  @Get("code-config")
  codeConfig(@CurrentTenant() tenant: Organization): Promise<WorkflowCodeConfig> {
    return this.code.config(tenant);
  }

  /**
   * `PUT /api/v1/workflows/code-config` — always `405`.
   *
   * The file is a projection printed on every read, so a save has nothing to change. An explicit
   * `405` rather than the router's `404` is what lets the editor say *read-only* instead of
   * *missing*. No `@Roles()`: the refusal is the file's, whoever asks.
   *
   * @param response - The response, for the `Allow` header RFC 9110 requires of a `405`.
   * @returns Never.
   * @throws {MethodNotAllowedError} `workflow_code_read_only`, always.
   */
  @Put("code-config")
  saveCodeConfig(@Res({ passthrough: true }) response: HeaderTarget): never {
    response.setHeader("Allow", "GET");

    throw codeReadOnly(CONFIG_FILE_PATH);
  }

  /**
   * `GET /api/v1/workflows/{slug}/code` — one workflow as a file.
   *
   * The draft's text, or a published version's with `?version=` (read-only), with the draft's
   * etag either way — the token the canvas holds too.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The workflow's slug, validated against the slug pattern by the pipe.
   * @param query - `version` to read a published version instead of the draft.
   * @returns The file.
   */
  @Get(":slug/code")
  readCode(
    @CurrentTenant() tenant: Organization,
    @Param() params: WorkflowSlugParams,
    @Query() query: ReadWorkflowQuery,
  ): Promise<WorkflowCode> {
    return this.code.read(tenant.id, params.slug, query.version);
  }

  /**
   * `PUT /api/v1/workflows/{slug}/code` — save a file into the shared draft, guarded.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The workflow's slug.
   * @param ifMatch - The `If-Match` header, verbatim — the draft etag this file was edited from.
   *   Required; see this file's header on why it is read here.
   * @param body - The whole file.
   * @returns The file as it reads from the stored draft, with the draft's new etag.
   */
  @Roles(...ADMINISTRATORS)
  @Put(":slug/code")
  saveCode(
    @CurrentTenant() tenant: Organization,
    @Param() params: WorkflowSlugParams,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: SaveWorkflowCodeBody,
  ): Promise<WorkflowCode> {
    return this.code.save(tenant.id, params.slug, ifMatch, body.text);
  }

  /**
   * `GET /api/v1/workflows/{slug}/code/checks` — mockup 05's Loop Checks panel (W.2,
   * [#178](https://github.com/NobuData/ouroboros/issues/178)).
   *
   * The rows for the file `GET …/code` serves — the draft's, or a published version's with
   * `?version=` — derived from its diagnostics. Every member may read it, as they may the file.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The workflow's slug.
   * @param query - `version` to check a published version instead of the draft.
   * @returns The rows, with the file's path, version and the draft's etag.
   */
  @Get(":slug/code/checks")
  readCodeChecks(
    @CurrentTenant() tenant: Organization,
    @Param() params: WorkflowSlugParams,
    @Query() query: ReadWorkflowQuery,
  ): Promise<WorkflowCodeChecks> {
    return this.code.checks(tenant.id, params.slug, query.version);
  }

  /**
   * `POST /api/v1/workflows/{slug}/code/validate` — mockup 05's **Validate** (V.6,
   * [#174](https://github.com/NobuData/ouroboros/issues/174)).
   *
   * The file `GET …/code` serves, through the publish gate — zod, the registry, then the engine —
   * with nothing written and no version created. No `@Roles()`: it writes nothing, so it is every
   * member's, as a dry run is. `200` rather than `201`, because nothing is created.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The workflow's slug.
   * @returns The file with every finding on its lines, the Loop Checks rows, and the findings.
   */
  @Post(":slug/code/validate")
  @HttpCode(HttpStatus.OK)
  validateCode(
    @CurrentTenant() tenant: Organization,
    @Param() params: WorkflowSlugParams,
  ): Promise<WorkflowCodeValidation> {
    return this.code.validate(tenant.id, params.slug);
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
   * `POST /api/v1/workflows/{id}/dry-run` — the engine's walk of this workflow for one issue
   * (S.6, [#152](https://github.com/NobuData/ouroboros/issues/152)).
   *
   * No `@Roles()`: it writes nothing, so it is every member's, like the reads. `200` rather than
   * `201`, because nothing is created — a simulation is not recorded.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The workflow's id.
   * @param body - The issue to walk it for.
   * @returns The walk, the ticket it tested, and any findings.
   */
  @Post(":id/dry-run")
  @HttpCode(HttpStatus.OK)
  dryRun(
    @CurrentTenant() tenant: Organization,
    @Param() params: WorkflowParams,
    @Body() body: DryRunWorkflowBody,
  ): Promise<WorkflowDryRunResource> {
    return this.dryRuns.dryRun(tenant.id, params.id, body);
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
