/**
 * `create-issues`: a roadmap's items become sized Planning drafts, are pushed through the one
 * push path, and what the tracker answered is written back into a new version of the document
 * (CM.5, [#624](https://github.com/NobuData/ouroboros/issues/624)).
 *
 * ```
 * items ─create-issues─▶ drafts (one batch) ─sizer─▶ sized ─AL.3 push─▶ #742…#747
 *                                                                  └─writeback─▶ vN+1 ─▶ PR
 * ```
 *
 * **There is no second push path and no second estimator.** The drafts are an ordinary Planning
 * batch (`BatchesService.compose`, planner `create-roadmap-v1`): the existing orchestrator sizes
 * them, `BatchesService.push` files them, and a milestone or label reaches the tracker only
 * because the draft carries it.
 *
 * **The route is re-entrant, and that is what makes it idempotent.** Each call does as much as
 * can be done now and says where it stopped: `sizing` while the estimator is still working,
 * `partial` when a push stopped short, `filed` when every item has its issue. A document has one
 * batch (`roadmap_docs.batch_id`), a pushed draft is never pushed again (AL.3's key), and a
 * writeback that would change nothing writes no version — so calling it again files nothing
 * twice.
 */

import { Injectable } from "@nestjs/common";

import type { DraftResearchProvenance } from "../../db/schema";
import { BatchesService, type ComposedDraft } from "../../planning/batches.service";
import type { BatchResource } from "../../planning/planning.resources";
import { BriefsService } from "../briefs/briefs.service";
import { noTarget, outputInvalid, versionConflict } from "./pipeline.errors";
import {
  PipelineRepository,
  VersionRaceError,
  type PipelineInvestigation,
  type PipelineStore,
} from "./pipeline.repository";
import type { IssuesResource } from "./pipeline.resources";
import { skillStamp } from "./pipeline.skill-registry";
import { PipelineSkillRunner, type SkillRunning } from "./pipeline.skill-runner";
import { RoadmapService, type LoadedRoadmap } from "./roadmap.service";
import {
  MVP_LABEL,
  canonical,
  itemsOf,
  renderRoadmap,
  sameStructure,
  writeback,
  type ItemFiling,
  type RoadmapStructure,
} from "./roadmap.structure";

/** The planner the pipeline's batch is stored under. */
export const ROADMAP_PLANNER = "create-roadmap-v1";

/** What filing may be told. */
export interface FileRequest {
  /**
   * Push even though the estimator has not sized every draft. Absent or false waits: the call
   * answers `sizing` and files nothing.
   */
  readonly pushUnsized?: boolean;
}

/**
 * A draft's local key.
 *
 * @param ordinal - The item's place in the document, from 1.
 * @returns `RM-1`.
 */
export function draftKey(ordinal: number): string {
  return `RM-${String(ordinal)}`;
}

/**
 * The line a batch is filed under.
 *
 * @param investigation - `RS-124`.
 * @param structure - The version being filed.
 * @returns `RS-124 brief → ROADMAP.md → create-issues: 2 milestones, 6 issues.`
 */
export function batchPrompt(investigation: string, structure: RoadmapStructure): string {
  const milestones = structure.milestones.length;
  const items = itemsOf(structure).length;

  return (
    `${investigation} brief → ROADMAP.md → create-issues: ` +
    `${String(milestones)} milestone${milestones === 1 ? "" : "s"}, ` +
    `${String(items)} issue${items === 1 ? "" : "s"}.`
  );
}

/**
 * The drafts `create-issues` composes: one per item, under the item's milestone, labelled `mvp`
 * when flagged, and saying where it came from.
 *
 * @param investigation - The investigation the roadmap was generated from.
 * @param structure - The version being filed.
 * @param bodies - The skill's description of each item, by item key.
 * @returns The drafts, in reading order.
 * @throws {UpstreamError} `roadmap_output_invalid` when an item has no description.
 */
export function composeDrafts(
  investigation: PipelineInvestigation,
  structure: RoadmapStructure,
  bodies: ReadonlyMap<string, string>,
): ComposedDraft[] {
  return itemsOf(structure).map(({ milestone, item }, index) => {
    const body = bodies.get(item.key);

    if (body === undefined) throw outputInvalid([`item "${item.key}" has no description`]);

    const research: DraftResearchProvenance = {
      investigation_id: investigation.id,
      origin: "roadmap",
      capability: null,
      severity: null,
      item_key: item.key,
      effort: item.effort,
      sources: [],
    };

    return {
      localKey: draftKey(index + 1),
      title: item.title,
      body:
        `${body.trim()}\n\n---\n` +
        `_From the ${investigation.displayId} roadmap · ${milestone.name}` +
        `${item.mvp ? " · MVP" : ""}_`,
      milestone: { name: milestone.name, dueOn: milestone.target_date },
      labels: item.mvp ? [MVP_LABEL] : [],
      research,
    };
  });
}

/**
 * What each item became, read off the batch.
 *
 * @param batch - The document's batch.
 * @returns Filings by item key — a draft, and its ticket once pushed.
 */
export function filingsOf(batch: Pick<BatchResource, "drafts">): Map<string, ItemFiling> {
  const filings = new Map<string, ItemFiling>();

  for (const draft of batch.drafts) {
    const key = draft.research?.origin === "roadmap" ? draft.research.itemKey : null;

    if (key === null) continue;

    filings.set(key, {
      draftId: draft.id,
      ticket:
        draft.pushedTicketId === null || draft.pushedTicket === null
          ? null
          : { id: draft.pushedTicketId, key: draft.pushedTicket.externalKey },
    });
  }

  return filings;
}

@Injectable()
export class RoadmapIssuesService {
  /** The collaborators, behind their seams. */
  private readonly store: PipelineStore;
  private readonly skills: SkillRunning;

  /**
   * @param repository - The document, its batch link and the tracker's mirror.
   * @param roadmap - Loads the document and answers the card.
   * @param briefs - The brief the descriptions cite.
   * @param runner - Runs `create-issues`.
   * @param batches - Planning: compose, read, push.
   */
  constructor(
    repository: PipelineRepository,
    private readonly roadmap: RoadmapService,
    private readonly briefs: BriefsService,
    runner: PipelineSkillRunner,
    private readonly batches: BatchesService,
  ) {
    this.store = repository;
    this.skills = runner;
  }

  /**
   * File a roadmap's items, as far as can be done now.
   *
   * @param organizationId - The workspace.
   * @param userId - Who asked.
   * @param investigationId - The investigation.
   * @param request - Whether to push drafts the estimator has not sized.
   * @returns Where it stopped, and the card.
   * @throws {NotFoundError} `investigation_not_found`, `roadmap_not_found`, `brief_not_found`.
   * @throws {ConflictError} `roadmap_target_missing`, `roadmap_version_conflict`,
   *   `roadmap_no_researcher`, `roadmap_skill_unpublished`, and every refusal a push makes.
   * @throws {UpstreamError} `roadmap_skill_failed`, `roadmap_output_invalid`, `engine_unavailable`.
   */
  async file(
    organizationId: string,
    userId: string,
    investigationId: string,
    request: FileRequest = {},
  ): Promise<IssuesResource> {
    let loaded = await this.roadmap.load(organizationId, investigationId);
    let batch = await this.batch(organizationId, userId, loaded);
    const unsized = batch.drafts.filter(
      (draft) => draft.selected && draft.estimate === null,
    ).length;

    if (batch.status === "drafting" && unsized > 0 && request.pushUnsized !== true) {
      return this.answer("sizing", loaded, batch, false, unsized);
    }

    if (batch.status === "pushing") {
      await this.batches.resume(organizationId, batch.id);
    } else if (batch.status === "drafting" || batch.status === "sized") {
      await this.batches.push(organizationId, batch.id);
    }

    batch = await this.batches.read(organizationId, batch.id);

    const wrote = await this.writeBack(organizationId, loaded, batch);

    if (wrote) loaded = await this.roadmap.load(organizationId, investigationId);

    const filed = itemsOf(loaded.version.structure).every(({ item }) => item.ticket_id !== null);

    if (filed) await this.store.markIssuesFiled(investigationId);

    return this.answer(filed ? "filed" : "partial", loaded, batch, wrote, 0);
  }

  /**
   * The document's batch — composed now, from the skill's descriptions, when it has none.
   *
   * @param organizationId - The workspace.
   * @param userId - Who asked.
   * @param loaded - The document.
   * @returns The batch.
   */
  private async batch(
    organizationId: string,
    userId: string,
    loaded: LoadedRoadmap,
  ): Promise<BatchResource> {
    const { investigation, doc, version } = loaded;

    if (doc.batchId !== null) return this.batches.read(organizationId, doc.batchId);
    if (doc.targetSourceId === null) throw noTarget();

    const brief = await this.briefs.export(organizationId, investigation.id);
    const items = itemsOf(version.structure);
    const { result } = await this.skills.run(organizationId, {
      slug: "create-issues",
      output: "issue_bodies",
      run: doc.id,
      input: {
        investigation: investigation.displayId,
        roadmap: {
          title: doc.title,
          milestones: version.structure.milestones.map((milestone) => ({
            key: milestone.key,
            name: milestone.name,
            target_date: milestone.target_date,
          })),
        },
        items: items.map(({ milestone, item }) => ({
          key: item.key,
          title: item.title,
          milestone: milestone.name,
          mvp: item.mvp,
          effort: item.effort,
        })),
        brief: brief.markdown,
      },
    });
    const bodies = new Map((result.issues ?? []).map((issue) => [issue.key, issue.body]));
    const batch = await this.batches.compose(organizationId, userId, {
      prompt: batchPrompt(investigation.displayId, version.structure),
      planner: ROADMAP_PLANNER,
      targetSourceId: doc.targetSourceId,
      drafts: composeDrafts(investigation, version.structure, bodies),
    });

    await this.store.setBatch(doc.id, batch.id);

    return batch;
  }

  /**
   * Write what the batch now knows into the next version — unless that would change nothing.
   *
   * @param organizationId - The workspace.
   * @param loaded - The document, on its current version.
   * @param batch - The batch, freshly read.
   * @returns Whether a version was written.
   */
  private async writeBack(
    organizationId: string,
    loaded: LoadedRoadmap,
    batch: BatchResource,
  ): Promise<boolean> {
    const { doc, version } = loaded;
    const filings = filingsOf(batch);
    const ticketIds = [...filings.values()].flatMap((filing) =>
      filing.ticket === null ? [] : [filing.ticket.id],
    );
    const tickets = await this.store.issues(organizationId, ticketIds);
    const next = canonical(
      writeback(version.structure, filings, new Map(tickets.map((ticket) => [ticket.id, ticket]))),
    );

    if (sameStructure(next, version.structure)) return false;

    const skill = await this.skills.current(organizationId, "create-issues");

    try {
      await this.store.addVersion(
        doc,
        doc.title,
        {
          structure: next,
          markdown: renderRoadmap(doc.title, next),
          generatedBy: `${skillStamp(skill)} · writeback`,
          path: version.projection.path,
        },
        null,
      );
    } catch (error) {
      if (error instanceof VersionRaceError) throw versionConflict(doc.id);
      throw error;
    }

    return true;
  }

  /**
   * The route's answer.
   *
   * @param stage - Where the call stopped.
   * @param loaded - The document, on its current version.
   * @param batch - Its batch.
   * @param wroteVersion - Whether this call wrote a version — then it is projected too.
   * @param unsized - Selected drafts still waiting for the estimator.
   * @returns The resource.
   */
  private async answer(
    stage: IssuesResource["stage"],
    loaded: LoadedRoadmap,
    batch: BatchResource,
    wroteVersion: boolean,
    unsized: number,
  ): Promise<IssuesResource> {
    const drafted = new Set(filingsOf(batch).keys());

    return {
      stage,
      batchId: batch.id,
      wroteVersion,
      unsized,
      undrafted: itemsOf(loaded.version.structure)
        .map(({ item }) => item.key)
        .filter((key) => !drafted.has(key)),
      roadmap: wroteVersion
        ? await this.roadmap.projected(loaded)
        : await this.roadmap.resource(loaded),
    };
  }
}
