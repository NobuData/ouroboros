/**
 * `InvestigationLifecycleService` — start, cancel, list and open an investigation, and the
 * workspace's rule for who may start one (CM.6,
 * [#625](https://github.com/NobuData/ouroboros/issues/625)).
 *
 * **Start is estimate → create → dispatch, and a refused start leaves nothing queued.** The
 * estimate (CM.3, #622) validates the kind and the tools and names the researcher; no
 * researcher means nothing could run, so the start is refused before a row exists. The row is
 * then created `queued` with that estimate on it and handed to the engine through
 * `InvestigationDispatchService` (CM.1, #620). If the dispatch is refused — the engine is
 * down, no enabled tool has an adapter — the new row is cancelled and the refusal is answered
 * as it was raised: an investigation nothing will ever run must not sit in `queued`.
 *
 * **Who may start is the workspace's setting**: `member` (owner, admin, member — the default)
 * or `admin`. A viewer never may. **Who may cancel is fixed**: the person who started it, or an
 * owner or admin.
 *
 * **Cancel keeps what was gathered.** A queued investigation is cancelled at once; a running
 * one is asked to stop and its worker ends it between two operations, so the ledger, the
 * checkpoint and the actuals are kept either way.
 */

import { Injectable, Logger } from "@nestjs/common";

import type { OrganizationRole, ResearchStartRole } from "../../db/schema";
import { describeForLog } from "../../errors/failure";
import { type Page, type PageWindow, pageOf } from "../../tenancy/pagination";
import { ADMINISTRATORS, CONTRIBUTORS } from "../../tenancy/roles.guard";
import { forbidden } from "../../tenancy/tenancy.errors";
import { ResearchEstimateService } from "../estimate.service";
import { InvestigationDispatchService } from "../loop/investigation-dispatch.service";
import { investigationNotFound, kindNotFound } from "../research.errors";
import { cancelForbidden, researcherUnrouted } from "./lifecycle.errors";
import {
  type InvestigationFilter,
  LifecycleRepository,
  type LifecycleStore,
} from "./lifecycle.repository";
import {
  ACTIVE_STATUSES,
  type CancelledInvestigationResource,
  type InvestigationDetailResource,
  type InvestigationListResource,
  type InvestigationProgressResource,
  type InvestigationResource,
  type ResearchSettingsResource,
  type StartedInvestigationResource,
  type Viewer,
  investigationDetailResource,
  investigationResource,
  mayCancel,
  progressResource,
  quarterResource,
} from "./lifecycle.resources";
import { type Quarter, parseQuarter, quarterOf } from "./quarter";

/** Who is reading: a person, or a service account (no user). */
export interface Reader {
  readonly userId: string | null;
  readonly roles: readonly OrganizationRole[];
}

/** A person making a change. */
export interface Caller extends Reader {
  readonly userId: string;
}

/** What the composer sends. */
export interface StartRequest {
  readonly question: string;
  readonly kind: string;
  readonly depth: StartedInvestigationResource["investigation"]["depth"];
  readonly tools?: readonly string[];
}

/** What a list may be asked for. */
export interface ListRequest {
  readonly kind?: string;
  /** A status, or `active`. */
  readonly status?: string;
  /** `current` or `2026-Q4`. */
  readonly quarter?: string;
}

/** The roles each starter setting admits. */
export const START_ROLE_HOLDERS: Readonly<Record<ResearchStartRole, readonly OrganizationRole[]>> =
  { member: CONTRIBUTORS, admin: ADMINISTRATORS };

/**
 * Whether a caller holds any of some roles.
 *
 * @param caller - The caller.
 * @param roles - The roles, any of which is enough.
 * @returns True when they hold one.
 */
function holds(caller: Reader, roles: readonly OrganizationRole[]): boolean {
  return caller.roles.some((role) => roles.includes(role));
}

/**
 * A caller as a viewer of investigations.
 *
 * @param caller - The caller.
 * @returns Their id and whether they administer the workspace.
 */
function viewerOf(caller: Reader): Viewer {
  return { userId: caller.userId, administrator: holds(caller, ADMINISTRATORS) };
}

@Injectable()
export class InvestigationLifecycleService {
  private readonly logger = new Logger(InvestigationLifecycleService.name);
  private readonly store: LifecycleStore;

  /**
   * @param repository - Investigations, read as rows of the card.
   * @param estimates - CM.3's estimator — the estimate check.
   * @param dispatch - CM.1's dispatch and cancel.
   */
  constructor(
    repository: LifecycleRepository,
    private readonly estimates: ResearchEstimateService,
    private readonly dispatch: InvestigationDispatchService,
  ) {
    this.store = repository;
  }

  /**
   * Start an investigation.
   *
   * @param organizationId - The workspace.
   * @param caller - Who is starting it.
   * @param request - The composer's payload.
   * @returns The investigation, dispatched, and the estimate stored on it.
   * @throws {ForbiddenError} `forbidden` when the caller's role is below the workspace's
   *   starter role.
   * @throws {NotFoundError} `investigation_kind_not_found`.
   * @throws {InvalidRequestError} `research_tool_unknown`, `research_tools_required`.
   * @throws {ConflictError} `investigation_researcher_unavailable` (nothing was created) and
   *   `investigation_tools_unavailable` (the new investigation was cancelled).
   * @throws {UpstreamError} `engine_unavailable` — the new investigation was cancelled.
   */
  async start(
    organizationId: string,
    caller: Caller,
    request: StartRequest,
  ): Promise<StartedInvestigationResource> {
    const required = START_ROLE_HOLDERS[await this.store.startRole(organizationId)];
    if (!holds(caller, required)) throw forbidden(caller.roles.join(","), required);

    const estimate = await this.estimates.estimate(organizationId, {
      kind: request.kind,
      depth: request.depth,
      ...(request.tools === undefined ? {} : { tools: request.tools }),
    });
    if (estimate.researcher === null) throw researcherUnrouted(request.kind);

    const id = await this.store.create(organizationId, {
      kind: request.kind,
      question: request.question,
      depth: request.depth,
      tools: estimate.tools,
      estimate: { sources: estimate.sources, cost_cents: estimate.costCents },
      calibrationVersion: estimate.calibrationVersion,
      userId: caller.userId,
    });
    // The kind was there for the estimate a moment ago; it was removed in between.
    if (id === undefined) throw kindNotFound(request.kind);

    try {
      await this.dispatch.dispatch(organizationId, id);
    } catch (error) {
      await this.discard(organizationId, id);
      throw error;
    }

    return { investigation: await this.detail(organizationId, caller, id), estimate };
  }

  /**
   * Cancel an investigation.
   *
   * @param organizationId - The workspace.
   * @param caller - Who is asking.
   * @param investigationId - The investigation.
   * @returns Whether it is cancelled already or stopping, and the investigation as it stands.
   * @throws {NotFoundError} `investigation_not_found`.
   * @throws {ForbiddenError} `investigation_cancel_forbidden` unless the caller started it or
   *   is an owner or admin.
   * @throws {ConflictError} `investigation_not_cancellable` once it has finished.
   */
  async cancel(
    organizationId: string,
    caller: Caller,
    investigationId: string,
  ): Promise<CancelledInvestigationResource> {
    const record = await this.store.find(organizationId, investigationId);
    if (record === undefined) throw investigationNotFound(investigationId);
    if (!mayCancel(record, viewerOf(caller))) throw cancelForbidden(record.displayId);

    const cancel = await this.dispatch.requestCancel(
      organizationId,
      investigationId,
      caller.userId,
    );

    return {
      state: cancel.state,
      investigation: await this.detail(organizationId, caller, investigationId),
    };
  }

  /**
   * The investigations card, History and the library: one page of rows under the two counts.
   *
   * @param organizationId - The workspace.
   * @param request - The filters; every one given must hold.
   * @param window - The page.
   * @param now - The clock, for the quarter.
   * @returns The rows, newest first, with `active` and `thisQuarter` counted over the whole
   *   workspace whatever the filters.
   */
  async list(
    organizationId: string,
    request: ListRequest,
    window: PageWindow,
    now: Date = new Date(),
  ): Promise<InvestigationListResource> {
    const current = quarterOf(now);
    const filter = filterOf(request, now);

    const [{ records, total }, counts] = await Promise.all([
      this.store.list(organizationId, filter, window),
      this.store.counts(organizationId, current),
    ]);
    const page: Page<InvestigationResource> = pageOf(
      records.map(investigationResource),
      total,
      window,
    );

    return { ...page, counts, quarter: quarterResource(current) };
  }

  /**
   * One investigation, opened.
   *
   * @param organizationId - The workspace.
   * @param caller - Who is asking, for `mayCancel`.
   * @param investigationId - The investigation.
   * @returns Its row, estimate, actuals, progress, brief reference, deliverables, ledger
   *   summary and links.
   * @throws {NotFoundError} `investigation_not_found`.
   */
  async detail(
    organizationId: string,
    caller: Reader,
    investigationId: string,
  ): Promise<InvestigationDetailResource> {
    const [record, byTool] = await Promise.all([
      this.store.find(organizationId, investigationId),
      this.store.ledgerByTool(investigationId),
    ]);
    if (record === undefined) throw investigationNotFound(investigationId);

    return investigationDetailResource(record, byTool, viewerOf(caller));
  }

  /**
   * One reading of an investigation's progress — what the stream polls.
   *
   * @param organizationId - The workspace.
   * @param investigationId - The investigation.
   * @returns The reading.
   * @throws {NotFoundError} `investigation_not_found`.
   */
  async progress(
    organizationId: string,
    investigationId: string,
  ): Promise<InvestigationProgressResource> {
    const record = await this.store.find(organizationId, investigationId);
    if (record === undefined) throw investigationNotFound(investigationId);

    return progressResource(record);
  }

  /**
   * Who may start an investigation in a workspace.
   *
   * @param organizationId - The workspace.
   * @returns The setting; `member` for a workspace that never chose.
   */
  async settings(organizationId: string): Promise<ResearchSettingsResource> {
    return { startRole: await this.store.startRole(organizationId) };
  }

  /**
   * Change who may start an investigation.
   *
   * @param organizationId - The workspace.
   * @param userId - Who is changing it.
   * @param patch - The change; a patch carrying nothing changes nothing.
   * @returns The setting as it now stands.
   */
  async updateSettings(
    organizationId: string,
    userId: string,
    patch: { readonly startRole?: ResearchStartRole },
  ): Promise<ResearchSettingsResource> {
    if (patch.startRole === undefined) return this.settings(organizationId);

    return { startRole: await this.store.saveStartRole(organizationId, patch.startRole, userId) };
  }

  /**
   * Cancel an investigation whose dispatch was refused. A failure here is logged and not
   * raised: the dispatch's own refusal is what the caller must be told.
   *
   * @param organizationId - The workspace.
   * @param investigationId - The investigation just created.
   */
  private async discard(organizationId: string, investigationId: string): Promise<void> {
    try {
      await this.store.discard(organizationId, investigationId);
    } catch (error) {
      this.logger.error(
        `Investigation ${investigationId} could not be dispatched and was left queued.`,
        describeForLog(error),
      );
    }
  }
}

/**
 * A list request as the repository's filter.
 *
 * @param request - The query.
 * @param now - The clock, for `quarter=current`.
 * @returns The filter. An unreadable quarter cannot arrive here — the DTO refuses it — and
 *   would be ignored rather than matching nothing.
 */
export function filterOf(request: ListRequest, now: Date): InvestigationFilter {
  const quarter: Quarter | undefined =
    request.quarter === undefined ? undefined : parseQuarter(request.quarter, now);

  return {
    ...(request.kind === undefined ? {} : { kind: request.kind }),
    ...(request.status === undefined
      ? {}
      : {
          statuses:
            request.status === "active"
              ? ACTIVE_STATUSES
              : [request.status as InvestigationResource["status"]],
        }),
    ...(quarter === undefined ? {} : { quarter }),
  };
}
