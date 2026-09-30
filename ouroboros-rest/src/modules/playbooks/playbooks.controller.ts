/**
 * `/api/v1/knowledge/playbooks` — mockup 14's playbooks card (BF.6,
 * [#415](https://github.com/NobuData/ouroboros/issues/415)).
 *
 * **Reads are every member's; recipes are administrators'; launching is a contributor's.** A
 * playbook changes which skills a run is injected with, so writing one takes the gate writing a
 * skill takes (`ADMINISTRATORS`). A launch is a queue write, and takes that route's gate
 * (`CONTRIBUTORS`) — the same people who may press *Queue for loop*.
 *
 * The literal segments (`counts`, `from-run`) are declared before `:id`, which is a uuid.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";

import type { Organization } from "../db/schema";
import { ADMINISTRATORS, CONTRIBUTORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import {
  CreatePlaybookBody,
  CreatePlaybookFromRunBody,
  LaunchPlaybookBody,
  PlaybookContextQuery,
  PlaybookIdParams,
  PlaybookIssuesQuery,
  RunIdParams,
  UpdatePlaybookBody,
} from "./playbooks.dto";
import type {
  PlaybookContextResource,
  PlaybookCounts,
  PlaybookDraftResource,
  PlaybookIssueList,
  PlaybookLaunchReceipt,
  PlaybookList,
  PlaybookResource,
} from "./playbooks.resources";
import { PlaybooksService } from "./playbooks.service";

@Controller("knowledge/playbooks")
export class PlaybooksController {
  /** @param playbooks - The recipes. */
  constructor(private readonly playbooks: PlaybooksService) {}

  /**
   * `GET /api/v1/knowledge/playbooks` — the card.
   *
   * @param tenant - The workspace.
   * @returns Every recipe by name, each with `runCount`.
   */
  @Get()
  list(@CurrentTenant() tenant: Organization): Promise<PlaybookList> {
    return this.playbooks.list(tenant.id);
  }

  /**
   * `GET /api/v1/knowledge/playbooks/counts` — every recipe's launches, counted from runs.
   *
   * @param tenant - The workspace.
   * @returns The counts.
   */
  @Get("counts")
  counts(@CurrentTenant() tenant: Organization): Promise<PlaybookCounts> {
    return this.playbooks.counts(tenant.id);
  }

  /**
   * `GET /api/v1/knowledge/playbooks/from-run/{runId}` — what a recipe learned from the run would
   * hold. Writes nothing.
   *
   * @param tenant - The workspace.
   * @param params - The run.
   * @returns The draft.
   */
  @Get("from-run/:runId")
  draftFromRun(
    @CurrentTenant() tenant: Organization,
    @Param() params: RunIdParams,
  ): Promise<PlaybookDraftResource> {
    return this.playbooks.draftFromRun(tenant.id, params.runId);
  }

  /**
   * `POST /api/v1/knowledge/playbooks/from-run` — **+ New playbook from a past run…**.
   *
   * @param tenant - The workspace.
   * @param body - The run and the name.
   * @returns The playbook.
   */
  @Roles(...ADMINISTRATORS)
  @Post("from-run")
  createFromRun(
    @CurrentTenant() tenant: Organization,
    @Body() body: CreatePlaybookFromRunBody,
  ): Promise<PlaybookResource> {
    return this.playbooks.createFromRun(tenant.id, body);
  }

  /**
   * `POST /api/v1/knowledge/playbooks` — a hand-authored recipe.
   *
   * @param tenant - The workspace.
   * @param body - The recipe.
   * @returns The playbook.
   */
  @Roles(...ADMINISTRATORS)
  @Post()
  create(
    @CurrentTenant() tenant: Organization,
    @Body() body: CreatePlaybookBody,
  ): Promise<PlaybookResource> {
    return this.playbooks.create(tenant.id, body);
  }

  /**
   * `GET /api/v1/knowledge/playbooks/{id}`.
   *
   * @param tenant - The workspace.
   * @param params - The playbook.
   * @returns It.
   */
  @Get(":id")
  read(
    @CurrentTenant() tenant: Organization,
    @Param() params: PlaybookIdParams,
  ): Promise<PlaybookResource> {
    return this.playbooks.read(tenant.id, params.id);
  }

  /**
   * `PATCH /api/v1/knowledge/playbooks/{id}`.
   *
   * @param tenant - The workspace.
   * @param params - The playbook.
   * @param body - The change.
   * @returns The playbook after it.
   */
  @Roles(...ADMINISTRATORS)
  @Patch(":id")
  update(
    @CurrentTenant() tenant: Organization,
    @Param() params: PlaybookIdParams,
    @Body() body: UpdatePlaybookBody,
  ): Promise<PlaybookResource> {
    return this.playbooks.update(tenant.id, params.id, body);
  }

  /**
   * `DELETE /api/v1/knowledge/playbooks/{id}` — `204`.
   *
   * @param tenant - The workspace.
   * @param params - The playbook.
   */
  @Roles(...ADMINISTRATORS)
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@CurrentTenant() tenant: Organization, @Param() params: PlaybookIdParams): Promise<void> {
    return this.playbooks.delete(tenant.id, params.id);
  }

  /**
   * `GET /api/v1/knowledge/playbooks/{id}/issues` — *Run on issue… ▾*'s list, filtered.
   *
   * @param tenant - The workspace.
   * @param params - The playbook.
   * @param query - A title or number match, and a page size.
   * @returns The candidates.
   */
  @Get(":id/issues")
  issues(
    @CurrentTenant() tenant: Organization,
    @Param() params: PlaybookIdParams,
    @Query() query: PlaybookIssuesQuery,
  ): Promise<PlaybookIssueList> {
    return this.playbooks.issues(tenant.id, params.id, query);
  }

  /**
   * `GET /api/v1/knowledge/playbooks/{id}/context` — the context a launch would attach.
   *
   * @param tenant - The workspace.
   * @param params - The playbook.
   * @param query - The repository.
   * @returns The manifest and preset.
   */
  @Get(":id/context")
  context(
    @CurrentTenant() tenant: Organization,
    @Param() params: PlaybookIdParams,
    @Query() query: PlaybookContextQuery,
  ): Promise<PlaybookContextResource> {
    return this.playbooks.context(tenant.id, params.id, query.repo);
  }

  /**
   * `POST /api/v1/knowledge/playbooks/{id}/launch` — **Run on issue… ▾**. `201`: a queue row was
   * created.
   *
   * @param tenant - The workspace.
   * @param params - The playbook.
   * @param body - The issue.
   * @returns The receipt.
   */
  @Roles(...CONTRIBUTORS)
  @Post(":id/launch")
  launch(
    @CurrentTenant() tenant: Organization,
    @Param() params: PlaybookIdParams,
    @Body() body: LaunchPlaybookBody,
  ): Promise<PlaybookLaunchReceipt> {
    return this.playbooks.launch(tenant.id, params.id, body.issueId);
  }
}
