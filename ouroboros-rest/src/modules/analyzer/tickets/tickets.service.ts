/**
 * The drafted-tickets card's read (BW.4, [#519](https://github.com/NobuData/ouroboros/issues/519))
 * — a view onto ordinary planning batches, not a second drafting system:
 *
 *   * the ticket suggestions an analysis composed and **nobody has drafted yet**, which
 *     `POST /analyzer/suggestions/draft` turns into a batch;
 *   * the **planning batches** the rest were drafted into, read through planning's own service so
 *     a draft's checkbox, estimate and push state are the ones the planning page edits;
 *   * and, for each draft, the evidence its body states, resolved (`tickets.resources.ts`).
 *
 * A batch is on the card while any ticket suggestion drafted into it is still current — and then
 * **every** draft it holds is answered, because a push files every selected one.
 *
 * Like the suggestion cards, it says nothing until an analysis has **ended** having composed a
 * suggestion: a first run still composing draws no card ahead of the other two.
 */

import { Injectable } from "@nestjs/common";

import { BatchesService } from "../../planning/batches.service";
import { EvidenceRepository, type ResolvedEvidence } from "../evidence/evidence.repository";
import { groupRefs } from "../evidence/evidence.resources";
import { SuggestionsRepository } from "../suggestions/suggestions.repository";
import { TicketsRepository } from "./tickets.repository";
import { answeredTicketRefs, ticketsResource, type TicketsResource } from "./tickets.resources";

/** What an empty card's references resolve to. */
const NOTHING_RESOLVED: ResolvedEvidence = {
  builds: [],
  merges: [],
  workflowVersions: [],
  runnerPools: [],
  runners: [],
  testRuns: [],
  testCases: [],
  waivers: [],
};

@Injectable()
export class TicketsService {
  /**
   * @param reads - The ticket suggestions and the batches they were drafted into.
   * @param suggestions - Whether an analysis has ended having composed anything.
   * @param batches - Planning's batch read.
   * @param evidence - What the references name.
   */
  constructor(
    private readonly reads: TicketsRepository,
    private readonly suggestions: SuggestionsRepository,
    private readonly batches: BatchesService,
    private readonly evidence: EvidenceRepository,
  ) {}

  /**
   * A repository's drafted-tickets card.
   *
   * @param organizationId - The workspace.
   * @param repoRef - The repository.
   * @returns The card; empty before an analysis has composed a ticket suggestion, and for a
   *   repository the workspace has none of.
   */
  async list(organizationId: string, repoRef: string): Promise<TicketsResource> {
    if ((await this.suggestions.composedRun(organizationId, repoRef)) === undefined) {
      return ticketsResource(repoRef, [], [], NOTHING_RESOLVED);
    }

    const [undrafted, batchIds] = await Promise.all([
      this.reads.undrafted(organizationId, repoRef),
      this.reads.batchIds(organizationId, repoRef),
    ]);
    const batches = await Promise.all(batchIds.map((id) => this.batches.read(organizationId, id)));
    const resolved = await this.evidence.resolve(
      organizationId,
      groupRefs(answeredTicketRefs(undrafted, batches)),
    );

    return ticketsResource(repoRef, undrafted, batches, resolved);
  }
}
