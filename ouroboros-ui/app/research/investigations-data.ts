import "server-only";

/**
 * The investigations card's first paint (CN.6,
 * [#632](https://github.com/NobuData/ouroboros/issues/632)): the list the address asks for —
 * the card's active rows, or the library's filtered page — and, when the address opens an
 * investigation, that investigation with its brief, read once on the server so the card arrives
 * whole and a shared address opens what it names.
 *
 * Each read may fail alone (`app/api/reading.ts`): a card whose rows could not be read says so
 * and offers a reload; an open investigation that could not be read says so beside the rows.
 */

import { isApiError } from "@/app/api/errors";
import { type Reading, attempt } from "@/app/api/reading";
import { type InvestigationList, research } from "@/app/api/research";

import {
  BRIEF_NOT_FOUND_CODE,
  type OpenedInvestigation,
  PAGE_SIZE,
  toListQuery,
} from "./investigations";
import type { LibraryFilters } from "./view";

/**
 * Read one page of investigations.
 *
 * @param filters The facets.
 * @returns The page, or why it could not be read.
 */
export async function readInvestigationPage(filters: LibraryFilters): Promise<Reading<InvestigationList>> {
  return attempt(() => research.investigations(toListQuery(filters, PAGE_SIZE)));
}

/**
 * Read an investigation and its brief — the brief being absent, not a failure, while the
 * investigation has not delivered one.
 *
 * @param investigationId The investigation.
 * @returns The detail and the brief, or why they could not be read.
 */
export async function readOpenedInvestigation(
  investigationId: string,
): Promise<Reading<OpenedInvestigation>> {
  return attempt(async () => {
    const [detail, brief] = await Promise.all([
      research.investigation(investigationId),
      research.brief(investigationId).catch((error: unknown) => {
        if (isApiError(error) && error.code === BRIEF_NOT_FOUND_CODE) return null;
        throw error;
      }),
    ]);

    return { detail, brief };
  });
}
