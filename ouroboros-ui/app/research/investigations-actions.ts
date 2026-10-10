"use server";

/**
 * The server hops for the investigations card (CN.6,
 * [#632](https://github.com/NobuData/ouroboros/issues/632)) — the calls its Client Component
 * cannot make itself; `app/research/composer-actions.ts` states the rule.
 *
 * - **A page of rows** — a facet changed, **History** toggled, **Show more** pressed, or a live
 *   row's run ended and the service's derived pill and link are wanted.
 * - **An investigation, opened** — a row pressed: its detail, and its brief when it has one.
 *
 * ### Failure posture: a value, not a throw
 * A refusal comes back with the service's own code and sentence. The one throw that must travel
 * is Next.js's redirect signal, for a session that expired since the page rendered. **Every value
 * this module needs is imported rather than declared**: a `"use server"` module may export
 * nothing but async functions, so the outcome types live in `investigations.ts`.
 */

import { isApiError } from "@/app/api/errors";
import { research } from "@/app/api/research";

import {
  BRIEF_NOT_FOUND_CODE,
  type ListOutcome,
  type ListRefusal,
  type OpenOutcome,
  PAGE_SIZE,
  toListQuery,
} from "./investigations";
import type { LibraryFilters } from "./view";

/**
 * The service's refusal, as the card renders it.
 *
 * @param error What the client threw.
 * @returns The code and the sentence.
 * @throws Whatever is not an `ApiError`.
 */
function refusalOf(error: unknown): ListRefusal {
  if (!isApiError(error)) throw error;

  return { code: error.code, message: error.message };
}

/**
 * Read one page of investigations.
 *
 * @param filters The facets.
 * @param offset Where the page starts — `0` for the first.
 * @returns The page, or the service's refusal.
 * @throws Whatever is not an `ApiError`.
 */
export async function readInvestigations(filters: LibraryFilters, offset = 0): Promise<ListOutcome> {
  try {
    return { ok: true, list: await research.investigations(toListQuery(filters, PAGE_SIZE, offset)) };
  } catch (error) {
    return { ok: false, refusal: refusalOf(error) };
  }
}

/**
 * Open an investigation: its detail, and its brief when it has one.
 *
 * @param investigationId The investigation.
 * @returns The detail and the brief (null before the investigation delivers one), or the
 *   service's refusal.
 * @throws Whatever is not an `ApiError`.
 */
export async function openInvestigation(investigationId: string): Promise<OpenOutcome> {
  try {
    const [detail, brief] = await Promise.all([
      research.investigation(investigationId),
      research.brief(investigationId).catch((error: unknown) => {
        if (isApiError(error) && error.code === BRIEF_NOT_FOUND_CODE) return null;
        throw error;
      }),
    ]);

    return { ok: true, opened: { detail, brief } };
  } catch (error) {
    return { ok: false, refusal: refusalOf(error) };
  }
}
