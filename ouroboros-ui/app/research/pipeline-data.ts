import "server-only";

/**
 * The roadmap pipeline's first paint (CN.5,
 * [#631](https://github.com/NobuData/ouroboros/issues/631)): the newest investigation with a
 * roadmap document, read once on the server so the card arrives whole — a tracker that fills in
 * a second after the document would read as two things that had drifted.
 *
 * **Which roadmap is shown** is the newest finished investigation's that has one: `issues_filed`
 * first — a roadmap whose issues exist is the card's whole argument — then `brief_ready`. The
 * list route says which rows link to a roadmap document, and those are asked first; a document
 * generated since the brief was written carries no such link yet, so the newest few of each
 * status are asked too (`PIPELINE_PROBES`). `404 roadmap_not_found` is "not this one", not a
 * failure. A workspace with no roadmap shows none, and the seat says so.
 */

import { isApiError } from "@/app/api/errors";
import { type Reading, attempt } from "@/app/api/reading";
import { type Investigation, type ResearchRoadmap, research } from "@/app/api/research";

import { type FeaturedPipeline, PIPELINE_PROBES, pipelineCandidates } from "./pipeline";

/** The statuses a roadmap's investigation can be in, the one whose issues are filed first. */
const PIPELINE_STATUSES = ["issues_filed", "brief_ready"] as const;

/** What the service answers for an investigation with no roadmap document. */
const NOT_FOUND = 404;

/**
 * An investigation's roadmap, or nothing when it has none.
 *
 * @param row The investigation.
 * @returns The card, or null on `404`.
 * @throws Any other refusal, and whatever is not an `ApiError`.
 */
async function roadmapOf(row: Investigation): Promise<ResearchRoadmap | null> {
  try {
    return await research.roadmap(row.id);
  } catch (error) {
    if (isApiError(error) && error.status === NOT_FOUND) return null;

    throw error;
  }
}

/**
 * Read the roadmap the pipeline's seat shows.
 *
 * @returns The roadmap and its investigation's kind; `null` when no finished investigation has
 *   one; or why it could not be read.
 */
export async function readFeaturedPipeline(): Promise<Reading<FeaturedPipeline | null>> {
  return attempt(async () => {
    for (const status of PIPELINE_STATUSES) {
      const page = await research.investigations({ status, limit: PIPELINE_PROBES });

      for (const row of pipelineCandidates(page.items)) {
        const roadmap = await roadmapOf(row);

        if (roadmap !== null) return { roadmap, kind: row.kind };
      }
    }

    return null;
  });
}
