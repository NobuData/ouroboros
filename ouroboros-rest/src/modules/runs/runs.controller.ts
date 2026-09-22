/**
 * `/api/v1/runs` — the paged listings behind mockup 02's *Open run console →* and
 * *All issues →* links, and the detail a card links to
 * ([#71](https://github.com/NobuData/ouroboros/issues/71)).
 *
 * **The workspace is the session's, never the request's** — the same sentence the dashboard
 * controller opens with, because it is the same property: no `{orgId}` in the path, the
 * tenant guard resolves and membership-checks the active organization, and this handler
 * reads what it established. The listings are the aggregate's slices without their card
 * limits; the shapes are identical because the mapper is.
 *
 * Sessions are required without anything here saying so — the global guard — and a tenant
 * is required *because* nothing here says otherwise: no `@TenantOptional()`, so a session
 * acting in no workspace is a `400 organization_required` before any handler runs.
 *
 * **The Run Console's three reads** ([#304](https://github.com/NobuData/ouroboros/issues/304),
 * AP.2) live here too — the page payload, the transcript's tail and the raw JSONL export — and
 * like the listings they are **member-readable**: no `@Roles`, so every role a workspace has may
 * read a run, as it may read the dashboard that links to it. Each sets `Cache-Control: private,
 * no-cache` — one workspace's run, never held by a shared cache — in the handler rather than by
 * `@Header()`, so a refusal does not go out carrying it; the tail adds the polling contract's
 * `X-Ouro-Poll-After` (`docs/ARCHITECTURE.md` § 5.4), as the build log does.
 */

import { Readable } from "node:stream";

import { Controller, Get, Param, Query, Res, StreamableFile } from "@nestjs/common";

import type { Organization } from "../db/schema";
import type { RunSummary } from "../dashboard/resources";
import { POLL_AFTER } from "../dashboard/dashboard.controller";
import type { HeaderResponse } from "../farm/logs/logs.controller";
import type { Page } from "../tenancy/pagination";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { RUN_EXPORT_MEDIA_TYPE } from "./console.policy";
import type { RunConsoleResource, RunEventsPage } from "./console.resources";
import { ConsoleService } from "./console.service";
import { ListRunsQuery, RunEventsQuery, RunParams } from "./runs.dto";
import { RunsService } from "./runs.service";

/** Every console read's caching rule: one workspace's run, revalidated before any reuse. */
const PRIVATE_NO_CACHE = "private, no-cache";

@Controller("runs")
export class RunsController {
  /**
   * @param runs - The listings.
   * @param console - The console's reads.
   */
  constructor(
    private readonly runs: RunsService,
    private readonly console: ConsoleService,
  ) {}

  /**
   * One page of the workspace's runs — active in lifecycle order, terminal newest first.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param query - Family (required), repository filter and window (optional).
   * @returns The page, per the #31 convention.
   */
  @Get()
  list(
    @CurrentTenant() tenant: Organization,
    @Query() query: ListRunsQuery,
  ): Promise<Page<RunSummary>> {
    return this.runs.list(tenant.id, query);
  }

  /**
   * The Run Console page — the run row, the head, the stepper and the three cards.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The run's id, validated as a uuid by the pipe.
   * @param response - For the caching header, set once there is a page.
   * @returns The snapshot.
   */
  @Get(":id")
  async read(
    @CurrentTenant() tenant: Organization,
    @Param() params: RunParams,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<RunConsoleResource> {
    const page = await this.console.read(tenant, params.id);

    response.setHeader("Cache-Control", PRIVATE_NO_CACHE);

    return page;
  }

  /**
   * The transcript past a cursor — the tail the console polls.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The run's id.
   * @param query - `?after=` and `?limit=`.
   * @param response - For the polling contract's headers.
   * @returns The page.
   */
  @Get(":id/events")
  async events(
    @CurrentTenant() tenant: Organization,
    @Param() params: RunParams,
    @Query() query: RunEventsQuery,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<RunEventsPage> {
    const page = await this.console.events(tenant.id, params.id, query);

    response.setHeader("Cache-Control", PRIVATE_NO_CACHE);
    response.setHeader(POLL_AFTER, String(page.pollAfter));

    return page;
  }

  /**
   * The transcript as JSONL — mockup 10's **Raw JSONL ↗**, streamed.
   *
   * `inline` rather than `attachment`: the button opens the file in a new tab for a person to
   * read, and the `filename` is what a *Save as* offers.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The run's id.
   * @param response - For the caching header.
   * @returns The file, streamed a batch at a time.
   */
  @Get(":id/transcript.jsonl")
  async transcript(
    @CurrentTenant() tenant: Organization,
    @Param() params: RunParams,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<StreamableFile> {
    const file = await this.console.exportTranscript(tenant.id, params.id);

    response.setHeader("Cache-Control", PRIVATE_NO_CACHE);

    return new StreamableFile(Readable.from(file.chunks), {
      type: RUN_EXPORT_MEDIA_TYPE,
      disposition: `inline; filename="${file.filename}"`,
    });
  }
}
