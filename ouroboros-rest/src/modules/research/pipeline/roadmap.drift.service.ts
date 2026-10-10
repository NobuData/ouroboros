/**
 * The drift check: is the document still what the tracker and the repository say? (CM.5,
 * [#624](https://github.com/NobuData/ouroboros/issues/624))
 *
 * One check does three things, in order:
 *
 * 1. **Settles the projection** — a version that could not be projected is tried again, and an
 *    open pull request is followed to `committed` (merged) or back to `pending` (closed).
 * 2. **Compares** every filed item with the tracker's mirror, and — for a committed version —
 *    the repository's file with the version's projection.
 * 3. **Reports** a difference: the version moves `committed → drift_detected`, and one
 *    suggestion is raised naming every difference.
 *
 * **Nothing is rewritten.** The check writes no version and edits no file; applying the
 * suggestion is a re-run like any other. **And it raises once:** while a drift suggestion is
 * open on a document, another check adds none — the open one already says the document is stale.
 *
 * A repository that cannot be read is not a drift: the file comparison is skipped and the
 * tracker comparison stands on its own.
 */

import { Injectable, Logger } from "@nestjs/common";

import { describeForLog } from "../../errors/failure";
import { PipelineRepository, type PipelineStore } from "./pipeline.repository";
import { suggestionResource, type DriftResource } from "./pipeline.resources";
import {
  DRIFT_AGENT,
  compareWithTracker,
  driftSuggestion,
  fileDifference,
  type DriftDifference,
} from "./roadmap.drift";
import { RoadmapProjector } from "./roadmap.projector";
import { RoadmapService } from "./roadmap.service";
import { itemsOf } from "./roadmap.structure";

/** The most documents one scheduled pass checks. */
export const PASS_BATCH = 50;

/** What one scheduled pass did. */
export interface DriftPassSummary {
  /** Documents checked. */
  readonly checked: number;
  /** Documents found to differ. */
  readonly drifted: number;
  /** Suggestions raised. */
  readonly raised: number;
}

@Injectable()
export class RoadmapDriftService {
  private readonly logger = new Logger(RoadmapDriftService.name);

  /** The store, behind its seam. */
  private readonly store: PipelineStore;

  /**
   * @param repository - The tracker's mirror, the suggestions and the documents to watch.
   * @param roadmap - Loads a document, raises a suggestion and answers the card.
   * @param projector - Settles the projection, reads the file and records a drift.
   */
  constructor(
    repository: PipelineRepository,
    private readonly roadmap: RoadmapService,
    private readonly projector: RoadmapProjector,
  ) {
    this.store = repository;
  }

  /**
   * Check one document.
   *
   * @param organizationId - The workspace.
   * @param investigationId - The investigation.
   * @returns Whether document, tracker and repository agree; what differs; the suggestion raised.
   * @throws {NotFoundError} `investigation_not_found`, `roadmap_not_found`.
   */
  async check(organizationId: string, investigationId: string): Promise<DriftResource> {
    const loaded = await this.roadmap.load(organizationId, investigationId);
    const { doc } = loaded;
    const settled = await this.projector.settle(doc, loaded.version);
    let version = { ...loaded.version, projection: settled.projection };

    const ticketIds = itemsOf(version.structure).flatMap(({ item }) =>
      item.ticket_id === null ? [] : [item.ticket_id],
    );
    const tickets = await this.store.issues(organizationId, ticketIds);
    const differences: DriftDifference[] = compareWithTracker(
      version.structure,
      new Map(tickets.map((ticket) => [ticket.id, ticket])),
    );
    let observedSha: string | null = null;

    if (version.projection.state === "committed") {
      const reading = await this.projector.read(doc, version);

      if (reading !== null && reading.file?.content !== version.markdown) {
        observedSha = reading.file?.commitSha ?? null;
        differences.push(
          reading.file === null
            ? {
                ...fileDifference(version.projection.path, null),
                tracker: "removed from the repository",
              }
            : fileDifference(version.projection.path, observedSha),
        );
      }
    }

    let raised = null;

    if (differences.length > 0) {
      const suggestions = await this.store.suggestions(doc.id);
      const standing = suggestions.some(
        (suggestion) => suggestion.status === "open" && suggestion.authorAgent === DRIFT_AGENT,
      );

      if (!standing) {
        const { text, hint } = driftSuggestion(differences);

        raised = await this.roadmap.raise(doc.id, DRIFT_AGENT, text, hint);
      }

      version = {
        ...version,
        projection: await this.projector.markDrift(doc, version, observedSha),
      };
    }

    return {
      identical: differences.length === 0,
      differences,
      raised: raised === null ? null : suggestionResource(raised),
      roadmap: await this.roadmap.resource({ ...loaded, version }, settled.problem),
    };
  }

  /**
   * Check every document the scheduler watches. One document's failure is logged and does not
   * stop the pass.
   *
   * @returns What the pass did.
   */
  async pass(): Promise<DriftPassSummary> {
    let checked = 0;
    let drifted = 0;
    let raised = 0;

    for (const watched of await this.store.watchedDocs(PASS_BATCH)) {
      try {
        const outcome = await this.check(watched.organizationId, watched.investigationId);

        checked += 1;
        if (!outcome.identical) drifted += 1;
        if (outcome.raised !== null) raised += 1;
      } catch (error) {
        this.logger.error(
          `The roadmap of investigation ${watched.investigationId} could not be checked; ` +
            "trying again next pass.",
          describeForLog(error),
        );
      }
    }

    return { checked, drifted, raised };
  }
}
