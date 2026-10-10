import "server-only";

/**
 * The featured brief's first paint (CN.4, [#630](https://github.com/NobuData/ouroboros/issues/630)):
 * the newest investigation that delivered a brief, read once on the server with its brief and
 * its detail, so the card arrives whole — a matrix that fills in a second later would read as a
 * page that did not know its own evidence.
 *
 * **Which investigation is featured** is the newest with a brief: `brief_ready` first, then
 * `issues_filed` (a brief whose work was already filed), newest first within each. The list
 * route orders newest first, so one row per status is enough. A workspace that has finished
 * nothing features nothing, and the seat says so.
 *
 * One reading (`app/api/reading.ts`): the brief and the detail are one card, so one of them
 * failing is the card failing.
 */

import { type Reading, attempt } from "@/app/api/reading";
import { research } from "@/app/api/research";

import { FEATURED_STATUSES, type FeaturedBrief } from "./brief";

/**
 * Read the featured brief.
 *
 * @returns The brief and its detail; `null` when no investigation has delivered one; or why it
 *   could not be read.
 */
export async function readFeaturedBrief(): Promise<Reading<FeaturedBrief | null>> {
  return attempt(async () => {
    for (const status of FEATURED_STATUSES) {
      const page = await research.investigations({ status, limit: 1 });
      const row = page.items[0];
      if (row === undefined) continue;

      const [brief, detail] = await Promise.all([
        research.brief(row.id),
        research.investigation(row.id),
      ]);
      return { brief, detail };
    }

    return null;
  });
}
