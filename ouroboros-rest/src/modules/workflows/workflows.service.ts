/**
 * The rules of the workflow lifecycle — P.3
 * ([#134](https://github.com/NobuData/ouroboros/issues/134)).
 *
 * Seven operations, and four rules that hold across all of them:
 *
 *   * **Absence answers `404`, and absence includes "not yours".** Every method starts by
 *     resolving the workflow through the repository's org-scoped `find`, which cannot
 *     distinguish a workflow that never existed from one in another workspace — so neither can
 *     this service, so neither can a caller. That resolution is also the *tenancy check for
 *     every version statement*: `workflow_versions` carries no `organization_id` by V029's
 *     design, and reaching it with an id this method has not resolved is the one way to read
 *     another workspace's history.
 *   * **A draft write is guarded or it is refused.** `PUT …/draft` requires `If-Match`, and a
 *     header that does not admit the draft's current etag is a `409` rather than an
 *     overwrite — the ticket's *no silent clobber* criterion. The read the check is made
 *     against is taken `for update` inside the same transaction as the write, so two autosaves
 *     a millisecond apart are separated by the database rather than by luck.
 *   * **Publishing is gated first and written second.** `publish.gate.ts` runs both validators
 *     before a transaction is opened — so a refusal cannot have written anything, because
 *     nothing had been opened to write in — and the transaction then re-checks that the draft
 *     is still the one that was validated. What becomes immutable is the document that passed.
 *   * **The rules that matter are V029's, and this file translates them.** The slug's
 *     uniqueness, the one-draft index and the dense numbering are constraints, not `select`s
 *     taken a moment earlier; every one of them is caught here by name and turned into the
 *     `409` the studio can act on.
 */

import { Injectable, Logger } from "@nestjs/common";

import type { Transaction } from "kysely";

import type { Database } from "../db/schema";
import { pageOf, windowOf, type Page, type PageQuery } from "../tenancy/pagination";
import { DatabaseService } from "../db/db.service";
import { draftEtag, ifMatchAdmits } from "./draft.etag";
import { WorkflowPublishGate } from "./publish.gate";
import { slugify } from "./slug";
import { WorkflowStatsService } from "./stats.service";
import type { WorkflowStats } from "./stats.resources";
import type {
  CreateWorkflowBody,
  PublishWorkflowBody,
  SaveDraftBody,
  UpdateWorkflowBody,
} from "./workflows.dto";
import {
  WORKFLOW_CONSTRAINTS,
  definitionInvalid,
  draftAbsent,
  draftConflict,
  draftEtagRequired,
  publishConflict,
  slugRequired,
  slugTaken,
  versionNotFound,
  violates,
  workflowNotFound,
} from "./workflows.errors";
import { WorkflowsRepository } from "./workflows.repository";
import {
  workflowDetail,
  workflowDraft,
  workflowSummary,
  workflowVersion,
  workflowVersionSummary,
  type WorkflowDetail,
  type WorkflowDraft,
  type WorkflowSummary,
  type WorkflowVersionResource,
  type WorkflowVersionSummary,
} from "./workflows.resources";

/**
 * The rail, as one answer.
 *
 * A named array rather than a page, in `ProviderHealthStrip`'s shape and for its reason: the
 * rail is a workspace's whole set of workflows, computed by P.4 in two statements that measure
 * every one of them against the same window. A `limit`/`offset` over that would be a window
 * onto an answer that was already complete, and a percentage share is only meaningful beside
 * the rows it was divided among.
 */
export interface WorkflowRail {
  /** One entry per non-archived workflow, in the rail's order. Empty is the studio's empty state. */
  readonly workflows: readonly WorkflowStats[];
}

/** The document a workflow's canvas opens on when the request named none. */
const BLANK_CANVAS: Record<string, unknown> = {};

@Injectable()
export class WorkflowsService {
  /** Where a publish that the engine did not second is recorded — see {@link publish}. */
  private readonly logger = new Logger(WorkflowsService.name);

  /**
   * @param workflows - The lifecycle's statements, all org-scoped or resolved through one.
   * @param stats - P.4's derivation. The rail's shape is its, and this service does not define
   *   a second one — `workflows.module.ts` says why.
   * @param gate - The two validators publishing is behind.
   * @param database - For the two operations that are only correct as a unit of work.
   */
  constructor(
    private readonly workflows: WorkflowsRepository,
    private readonly stats: WorkflowStatsService,
    private readonly gate: WorkflowPublishGate,
    private readonly database: DatabaseService,
  ) {}

  /**
   * Every workflow on this workspace's rail, with P.4's captions and usage shares.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param now - The request instant, from which the 30-day usage window is measured. Passed
   *   through rather than read twice, so every number in one answer is measured from one
   *   instant.
   * @returns The rail. Archived workflows are absent by P.4's own statement, which is what
   *   `archived` means.
   */
  async list(organizationId: string, now: Date = new Date()): Promise<WorkflowRail> {
    return { workflows: await this.stats.forWorkspace(organizationId, now) };
  }

  /**
   * Create a workflow, and the draft its canvas opens on.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param body - The title, the slug if the caller chose one, and the template stub if it
   *   created from one.
   * @returns The workflow with its draft, and no version — **+ New workflow** publishes
   *   nothing, which is the state `current_version: null` describes.
   * @throws {InvalidRequestError} `workflow_slug_required` when no slug was sent and the title
   *   yields none.
   * @throws {ConflictError} `workflow_slug_taken` when the slug already names a workflow here.
   */
  async create(organizationId: string, body: CreateWorkflowBody): Promise<WorkflowDetail> {
    const slug = body.slug ?? slugify(body.name);

    if (slug === undefined) throw slugRequired(body.name);

    try {
      const { workflow, draft } = await this.workflows.create(organizationId, {
        slug,
        name: body.name,
        definition: body.definition ?? BLANK_CANVAS,
      });

      return workflowDetail(workflow, draft, undefined);
    } catch (error) {
      // The unique index is the thing that is actually true. A `select` first would leave a
      // window two creates could both pass through, and the loser would get a `500` carrying
      // PostgreSQL's own text — `constraints.ts` makes the same argument at length.
      if (violates(error, WORKFLOW_CONSTRAINTS.slugUnique)) throw slugTaken(slug);

      throw error;
    }
  }

  /**
   * One workflow, its draft slot, and one of its versions.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param id - The workflow.
   * @param version - A historical version to read instead of the one in force. Omitted, the
   *   detail carries `workflows.current_version` — the `v14` chip — or `null` for a workflow
   *   that has only ever had a draft.
   * @returns The detail. The draft slot is carried whichever version was asked for, so the
   *   studio has one shape to read and a person browsing history still knows there is
   *   unpublished work.
   * @throws {NotFoundError} `workflow_not_found` — absent, or another workspace's,
   *   indistinguishably. `workflow_version_not_found` when `?version=` names no version of a
   *   workflow this caller *can* see, which discloses nothing they were not already shown.
   */
  async read(organizationId: string, id: string, version?: number): Promise<WorkflowDetail> {
    const workflow = await this.require(organizationId, id);

    const [draft, row] = await Promise.all([
      this.workflows.draftOf(workflow.id),
      this.versionToShow(workflow.id, version ?? workflow.current_version),
    ]);

    if (version !== undefined && row === undefined) throw versionNotFound(id, version);

    return workflowDetail(workflow, draft, row);
  }

  /**
   * Rename a workflow, pause it, or archive it.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param id - The workflow.
   * @param body - What to change. A body with neither field changes nothing and answers with
   *   the workflow as it stands — see `workflows.dto.ts` on why that is not an error.
   * @returns The workflow after the change. `status: "paused"` is what flips the rail to the
   *   mockup's err-dot state, and the caption P.4 composes follows from the same column with no
   *   second write.
   * @throws {NotFoundError} `workflow_not_found`.
   */
  async update(
    organizationId: string,
    id: string,
    body: UpdateWorkflowBody,
  ): Promise<WorkflowSummary> {
    if (body.name === undefined && body.status === undefined) {
      return workflowSummary(await this.require(organizationId, id));
    }

    const row = await this.workflows.rename(organizationId, id, body);

    if (row === undefined) throw workflowNotFound(id);

    return workflowSummary(row);
  }

  /**
   * Save the draft, if it is still the draft the writer read.
   *
   * The whole of the ticket's concurrency criterion lives in these twenty lines, and the order
   * is the argument for them: the transaction opens, the draft is read **`for update`**, the
   * etag is compared against what that locked read found, and only then is anything written.
   * A second autosave arriving mid-flight blocks on the lock, re-reads the row the first one
   * committed, and finds an etag its `If-Match` does not admit — so it is told, rather than
   * winning.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param id - The workflow.
   * @param ifMatch - The `If-Match` header, verbatim. `undefined` when the request carried
   *   none, which is refused rather than tolerated.
   * @param body - The whole document, as the canvas holds it.
   * @returns The draft slot after the write, carrying the etag for the next save.
   * @throws {NotFoundError} `workflow_not_found`.
   * @throws {BadRequestError} `workflow_draft_etag_required` when there is no `If-Match`.
   * @throws {ConflictError} `workflow_draft_conflict` when the draft moved — including when
   *   another request created one between this one's read and its insert.
   */
  async saveDraft(
    organizationId: string,
    id: string,
    ifMatch: string | undefined,
    body: SaveDraftBody,
  ): Promise<WorkflowDraft> {
    const workflow = await this.require(organizationId, id);

    if (ifMatch === undefined) throw draftEtagRequired();

    return this.database.transaction(async (trx) => {
      const existing = await this.workflows.draftOf(workflow.id, trx, true);
      const current = draftEtag(existing);

      if (!ifMatchAdmits(ifMatch, current)) throw draftConflict(ifMatch, current);

      if (existing === undefined) {
        return workflowDraft(await this.insertFirstDraft(workflow.id, body.definition, trx));
      }

      const written = await this.workflows.writeDraft(existing.id, body.definition, trx);

      // The locked read found a draft and the keyed update found none, which means the row
      // stopped being a draft between them. Under the lock that cannot happen; the check is
      // here because an `update` that silently matched nothing would otherwise answer `200`
      // with the row it did not write.
      if (written === undefined) throw draftConflict(ifMatch, current);

      return workflowDraft(written);
    });
  }

  /**
   * Publish the draft as the next immutable version.
   *
   * ```
   * read the draft ─▶ gate: zod, then the engine ─┬─ findings ─▶ 422, and nothing is opened
   *                                               └─ green ───▶ transaction:
   *                                                             lock the workflow
   *                                                             the draft is still the one validated?
   *                                                             insert v+1 · point current_version at it
   * ```
   *
   * **The gate runs outside the transaction, deliberately.** It makes a network call with a
   * five-second deadline, and holding a pooled connection across that would put the engine's
   * latency into this service's connection budget. What replaces the transaction's protection
   * is the re-check inside it: the draft's etag is compared against the one the validated
   * document came from, so the document that becomes immutable is the document that passed.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param id - The workflow.
   * @param body - The change note, when the publisher wrote one.
   * @param publishedBy - Who pressed Publish — `"user"."id"`, from the session.
   * @param now - The publish instant. Passed in so one request has one clock.
   * @returns The version as it was stored. `workflows.current_version` now names it.
   * @throws {NotFoundError} `workflow_not_found`.
   * @throws {ConflictError} `workflow_draft_absent` when there is nothing to publish, and
   *   `workflow_draft_conflict` when the draft changed while the gate was running.
   * @throws {InvalidRequestError} `workflow_definition_invalid` with node-anchored findings —
   *   and nothing written, because nothing had been opened.
   * @throws {UpstreamError} `engine_unavailable` when the engine publishes the validate route
   *   and could not answer.
   */
  async publish(
    organizationId: string,
    id: string,
    body: PublishWorkflowBody,
    publishedBy: string,
    now: Date = new Date(),
  ): Promise<WorkflowVersionResource> {
    const workflow = await this.require(organizationId, id);
    const draft = await this.workflows.draftOf(workflow.id);

    if (draft === undefined) throw draftAbsent(id);

    const validated = draftEtag(draft);
    const verdict = await this.gate.check(draft.definition);

    if (verdict.findings.length > 0) throw definitionInvalid(verdict.findings);

    if (!verdict.engineConsulted) {
      // The one line per publish an operator reads at the default level, and the reason
      // `publish.gate.ts` logs the mechanism at `debug` instead: this is the caller, so this is
      // what knows *which* workflow went out un-seconded.
      this.logger.warn(
        `Workflow ${workflow.slug} was published on the DSL validator's verdict alone: ` +
          "ouroboros-engine did not second it. See publish.gate.ts (#144).",
      );
    }

    return this.database.transaction(async (trx) => {
      // Locked for the numbering, not for the tenancy — `require` above already answered that.
      // Re-resolving under the lock is what makes "this workflow was deleted while the engine
      // was thinking" a 404 rather than a foreign-key failure.
      const locked = await this.workflows.lock(organizationId, id, trx);

      if (locked === undefined) throw workflowNotFound(id);

      const current = await this.workflows.draftOf(workflow.id, trx, true);

      if (current === undefined) throw draftAbsent(id);

      // The document that passed the gate is the document that becomes immutable. A draft that
      // moved while the engine was being asked is a `409`, not a version of something nobody
      // validated.
      if (draftEtag(current) !== validated) throw draftConflict(validated, draftEtag(current));

      try {
        const version = await this.workflows.publish(
          workflow.id,
          {
            definition: current.definition,
            changeNote: body.changeNote ?? null,
            publishedBy,
            publishedAt: now,
          },
          trx,
        );

        return workflowVersion(version);
      } catch (error) {
        // Both rules refuse the same race from different sides — the trigger checks the number
        // is next, the unique key checks nobody else took it — and both mean *somebody
        // published while you were publishing*. V029 is explicit that this is a retry the
        // writer must see rather than one this service should make on their behalf: their
        // definition may no longer be the one they meant to publish on top of.
        if (
          violates(error, WORKFLOW_CONSTRAINTS.versionUnique) ||
          violates(error, WORKFLOW_CONSTRAINTS.versionDense)
        ) {
          throw publishConflict(id);
        }

        throw error;
      }
    });
  }

  /**
   * One page of a workflow's version history, newest first.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param id - The workflow.
   * @param query - `limit` and `offset`.
   * @returns The page, without the documents — see `workflows.resources.ts` on why a history
   *   does not carry them. `isCurrent` marks the version in force, which is not necessarily the
   *   newest.
   * @throws {NotFoundError} `workflow_not_found`.
   */
  async versions(
    organizationId: string,
    id: string,
    query: PageQuery,
  ): Promise<Page<WorkflowVersionSummary>> {
    const workflow = await this.require(organizationId, id);
    const window = windowOf(query);

    const [rows, total] = await Promise.all([
      this.workflows.versions(workflow.id, window),
      this.workflows.countVersions(workflow.id),
    ]);

    return pageOf(
      rows.map((row) => workflowVersionSummary(row, workflow.current_version)),
      total,
      window,
    );
  }

  /**
   * The workflow, or the `404` that covers both ways it can be missing.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param id - The workflow.
   * @returns The row.
   * @throws {NotFoundError} `workflow_not_found`.
   */
  private async require(organizationId: string, id: string) {
    const workflow = await this.workflows.find(organizationId, id);

    if (workflow === undefined) throw workflowNotFound(id);

    return workflow;
  }

  /**
   * The version a detail should carry, if there is one.
   *
   * @param workflowId - A workflow already resolved through {@link require}.
   * @param version - The number asked for, or `workflows.current_version`, or `null` for a
   *   workflow that has published nothing.
   * @returns The row, or `undefined`. The caller decides whether `undefined` is a `404` — it is
   *   when the number came from the request, and it is the ordinary unpublished state when it
   *   came from the pointer.
   */
  private async versionToShow(workflowId: string, version: number | null) {
    return version === null ? undefined : this.workflows.versionAt(workflowId, version);
  }

  /**
   * Write the first draft a workflow has had, turning the index's refusal into a conflict.
   *
   * @param workflowId - A workflow already resolved through {@link require}.
   * @param definition - The document to store.
   * @param trx - The transaction the caller's guard was checked in.
   * @returns The draft as it was stored.
   * @throws {ConflictError} `workflow_draft_conflict` when another request created the draft
   *   first. `workflow_versions_one_draft_idx` is where the two meet — V029: *"where two
   *   concurrent start-editing requests collide instead of producing two drafts nobody can
   *   choose between"* — and both writers are told the same thing: reload, then save again.
   */
  private async insertFirstDraft(
    workflowId: string,
    definition: Record<string, unknown>,
    trx: Transaction<Database>,
  ) {
    try {
      return await this.workflows.insertDraft(workflowId, definition, trx);
    } catch (error) {
      if (violates(error, WORKFLOW_CONSTRAINTS.oneDraft)) {
        throw draftConflict(draftEtag(undefined));
      }

      throw error;
    }
  }
}
