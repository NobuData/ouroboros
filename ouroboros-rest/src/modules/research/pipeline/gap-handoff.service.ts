/**
 * **Draft epic from gaps →** — a brief's HIGH and MED gaps become a Planning draft batch (CM.5,
 * [#624](https://github.com/NobuData/ouroboros/issues/624)).
 *
 * ```
 * gaps(HIGH×2, MED×1) ─▶ batch{EPIC Docking parity, DOCK-1…5} ─▶ Planning: review · size · push
 * ```
 *
 * The proposal is the brief's own (`BriefsService.proposed`, #621): an epic and the ticket stubs
 * the gap analysis wrote for the matrix rows whose **stored** severity is `high` or `med`. Each
 * stub becomes one draft that says which gap it closes and cites the ledger records behind it —
 * in its body, where a reviewer reads it, and in `research_provenance`, where it stays after an
 * edit.
 *
 * **Nothing is filed.** The epic is stored `proposed` and the drafts as an ordinary batch
 * (planner `research-gaps-v1`); a person reviews, sizes and pushes it in Planning. The effort the
 * brief proposed travels as a seed (`research.effort`) — the estimate in force is the sizer's,
 * which starts on the drafts at once like any other batch's.
 *
 * **Asking twice drafts once.** An investigation whose gaps already have a live batch is
 * answered with that batch.
 *
 * **A refused draft leaves no epic.** The epic is stored first, because the batch names it; if
 * the batch is then refused the epic is removed again.
 */

import { Injectable } from "@nestjs/common";

import type { DraftResearchProvenance } from "../../db/schema";
import { BatchesService, type ComposedDraft } from "../../planning/batches.service";
import { EpicsService } from "../../planning/epics.service";
import type { BatchResource } from "../../planning/planning.resources";
import type { LedgerSourceResource } from "../briefs/brief.resources";
import { BriefsService } from "../briefs/briefs.service";
import type { GapProposals, ProposedTicket } from "../briefs/gap-proposals";
import { nothingProposed, sourceNotFound, targetRequired } from "./pipeline.errors";
import { PipelineRepository, type PipelineStore } from "./pipeline.repository";
import { planningHref, type DraftEpicResource } from "./pipeline.resources";

/** The planner a gaps batch is stored under. */
export const GAPS_PLANNER = "research-gaps-v1";

/** The most characters of an epic's name Planning stores. */
const MAX_EPIC_NAME = 200;

/**
 * One gap's draft body: what it closes, and the sources it rests on.
 *
 * ```
 * Closes the **Wind-compensated docking** gap (HIGH) found by RS-127.
 *
 * Proposed effort: M — a seed from the brief; the estimate is the sizer's.
 *
 * **Sources**
 * - [07] Skylink firmware 6.2 release notes — `skylink.example.com/releases/6.2`
 * ```
 *
 * @param investigation - `RS-127`.
 * @param ticket - The stub.
 * @param ledger - The investigation's ledger, by record id.
 * @returns The Markdown.
 */
export function gapDraftBody(
  investigation: string,
  ticket: ProposedTicket,
  ledger: ReadonlyMap<string, LedgerSourceResource>,
): string {
  const cited = ticket.sources.flatMap((id) => {
    const source = ledger.get(id);

    return source === undefined ? [] : [source];
  });
  const lines = [
    `Closes the **${ticket.capability}** gap (${ticket.severity.toUpperCase()}) found by ${investigation}.`,
  ];

  if (ticket.effort !== null) {
    lines.push(
      "",
      `Proposed effort: ${ticket.effort.toUpperCase()} — a seed from the brief; the estimate is the sizer's.`,
    );
  }

  if (cited.length > 0) {
    lines.push(
      "",
      "**Sources**",
      ...cited.map((source) => `- ${source.label} ${source.title} — \`${source.locatorLabel}\``),
    );
  }

  return lines.join("\n");
}

/**
 * The drafts of a proposal.
 *
 * @param investigationId - The investigation.
 * @param investigation - `RS-127`.
 * @param proposals - The brief's proposal.
 * @param ledger - The investigation's ledger.
 * @returns One draft per stub, keyed as the brief keyed it.
 */
export function gapDrafts(
  investigationId: string,
  investigation: string,
  proposals: GapProposals,
  ledger: readonly LedgerSourceResource[],
): ComposedDraft[] {
  const byId = new Map(ledger.map((source) => [source.sourceId, source]));

  return proposals.tickets.map((ticket) => {
    const research: DraftResearchProvenance = {
      investigation_id: investigationId,
      origin: "gap",
      capability: ticket.capability,
      severity: ticket.severity,
      item_key: null,
      effort: ticket.effort,
      // Only records the ledger still holds: V125 refuses a citation of anything else.
      sources: [...new Set(ticket.sources.filter((id) => byId.has(id)))],
    };

    return {
      localKey: ticket.key,
      title: ticket.title,
      body: gapDraftBody(investigation, ticket, byId),
      research,
    };
  });
}

/**
 * What the hand-off answers for a batch.
 *
 * @param created - Whether this call drafted it.
 * @param epic - The epic's id and name.
 * @param batch - The batch.
 * @returns The resource.
 */
export function draftEpicResource(
  created: boolean,
  epic: DraftEpicResource["epic"],
  batch: BatchResource,
): DraftEpicResource {
  return {
    created,
    epic,
    batch: {
      id: batch.id,
      status: batch.status,
      drafts: batch.drafts.map((draft) => ({
        id: draft.id,
        localKey: draft.localKey,
        title: draft.title,
        capability: draft.research?.capability ?? null,
        severity: draft.research?.severity ?? null,
        effort: draft.research?.effort ?? null,
        sources: draft.research?.sources.length ?? 0,
      })),
    },
    href: planningHref(batch.id),
  };
}

@Injectable()
export class GapHandoffService {
  /** The store, behind its seam. */
  private readonly store: PipelineStore;

  /**
   * @param repository - The workspace's sources, and the batch an investigation already has.
   * @param briefs - The brief's proposal and ledger.
   * @param epics - Planning's epics.
   * @param batches - Planning's batches.
   */
  constructor(
    repository: PipelineRepository,
    private readonly briefs: BriefsService,
    private readonly epics: EpicsService,
    private readonly batches: BatchesService,
  ) {
    this.store = repository;
  }

  /**
   * Draft an epic and one ticket per gap from an investigation's brief.
   *
   * @param organizationId - The workspace.
   * @param userId - Who asked.
   * @param investigationId - The investigation.
   * @param targetSourceId - The tracker the drafts are for; absent to use the workspace's only one.
   * @returns The epic, the batch and where to review it.
   * @throws {NotFoundError} `investigation_not_found`, `brief_not_found`, `roadmap_source_not_found`.
   * @throws {InvalidRequestError} `gaps_nothing_proposed`, `roadmap_target_required`.
   * @throws {ConflictError} `planning_target_read_only`.
   */
  async draftEpic(
    organizationId: string,
    userId: string,
    investigationId: string,
    targetSourceId?: string,
  ): Promise<DraftEpicResource> {
    const document = await this.briefs.document(organizationId, investigationId);
    const proposals = document.brief.proposed;
    const investigation = document.brief.investigation.displayId;

    if (proposals === null || proposals.tickets.length === 0) throw nothingProposed(investigation);

    const existing = await this.store.gapBatch(organizationId, investigationId);

    if (existing !== undefined) {
      const batch = await this.batches.read(organizationId, existing.batchId);
      const name =
        existing.epicId === null
          ? proposals.epic.title
          : (await this.epics.read(organizationId, existing.epicId)).name;

      return draftEpicResource(false, { id: existing.epicId, name }, batch);
    }

    const target = await this.target(organizationId, targetSourceId);
    const epic = await this.epics.create(organizationId, {
      name: proposals.epic.title.trim().slice(0, MAX_EPIC_NAME),
      status: "proposed",
    });
    let batch: BatchResource;

    try {
      batch = await this.batches.compose(organizationId, userId, {
        prompt: `${investigation} gaps → ${proposals.epic.label}`,
        planner: GAPS_PLANNER,
        targetSourceId: target,
        epicId: epic.id,
        drafts: gapDrafts(investigationId, investigation, proposals, document.ledger),
      });
    } catch (error) {
      // The drafts were refused (a read-only tracker, say): an epic with nothing under it would
      // be a lane on the roadmap that nobody asked for.
      await this.epics.remove(organizationId, epic.id);

      throw error;
    }

    return draftEpicResource(true, { id: epic.id, name: epic.name }, batch);
  }

  /**
   * The tracker a new batch is drafted for.
   *
   * @param organizationId - The workspace.
   * @param asked - The source the request named, if it named one.
   * @returns The source's id.
   * @throws {NotFoundError} `roadmap_source_not_found`.
   * @throws {InvalidRequestError} `roadmap_target_required`.
   */
  private async target(organizationId: string, asked: string | undefined): Promise<string> {
    const sources = await this.store.sources(organizationId);

    if (asked !== undefined) {
      if (!sources.some((source) => source.id === asked)) throw sourceNotFound(asked);

      return asked;
    }

    const only = sources.length === 1 ? sources[0] : undefined;

    if (only === undefined) throw targetRequired(sources.length);

    return only.id;
  }
}
