"use server";

/**
 * The server hops for the brief card (CN.4,
 * [#630](https://github.com/NobuData/ouroboros/issues/630)) — the calls its Client Component
 * cannot make itself; `app/research/composer-actions.ts` states the rule.
 *
 * ### Three hops
 * - **The ledger** — `all ↗` reads the whole ledger, excerpts and retrieval times included, when
 *   the sheet opens rather than with the page: 44 excerpts of up to 4 KiB each are not the first
 *   paint's business.
 * - **The trackers** — when the workspace has more than one ticket source, the draft action has
 *   to say which the drafts are for; the dialog lists them from the sources facade.
 * - **Draft epic from gaps** — `POST …/draft-epic`. **Nothing is filed**: the service answers the
 *   batch and where to review it in Planning, and the card navigates there.
 *
 * ### Failure posture: a value, not a throw
 * A refusal comes back with the service's own code and sentence, so the card can tell
 * `roadmap_target_required` — ask which tracker — from a refusal it should print. The one throw
 * that must travel is Next.js's redirect signal, for a session that expired since the page
 * rendered. **Every value this module needs is imported rather than declared**: a `"use server"`
 * module may export nothing but async functions, so the outcome types live in `brief.ts`.
 */

import { isApiError } from "@/app/api/errors";
import { research } from "@/app/api/research";
import { sources } from "@/app/api/sources";

import type { BriefRefusal, DraftEpicOutcome, LedgerOutcome, TrackersOutcome } from "./brief";

/**
 * The service's refusal, as the card renders it.
 *
 * @param error What the client threw.
 * @returns The code and the sentence.
 * @throws Whatever is not an `ApiError` — a dropped connection, the redirect signal.
 */
function refusalOf(error: unknown): BriefRefusal {
  if (!isApiError(error)) throw error;

  return { code: error.code, message: error.message };
}

/**
 * Read an investigation's whole ledger.
 *
 * @param investigationId The investigation.
 * @returns Every record with its excerpt and retrieval time, or the service's refusal.
 * @throws Whatever is not an `ApiError`.
 */
export async function readBriefLedger(investigationId: string): Promise<LedgerOutcome> {
  try {
    const ledger = await research.sources(investigationId);

    return { ok: true, total: ledger.total, items: ledger.items };
  } catch (error) {
    return { ok: false, refusal: refusalOf(error) };
  }
}

/**
 * The ticket sources the drafts may be for.
 *
 * @returns Each source's id, name and kind, in the service's order, or the service's refusal.
 * @throws Whatever is not an `ApiError`.
 */
export async function readTrackers(): Promise<TrackersOutcome> {
  try {
    const page = await sources.list();

    return {
      ok: true,
      trackers: page.items.map((source) => ({
        id: source.id,
        displayName: source.displayName,
        kind: source.kind,
      })),
    };
  } catch (error) {
    return { ok: false, refusal: refusalOf(error) };
  }
}

/**
 * **Draft epic from gaps →** — the brief's proposals as a Planning batch. Nothing is filed.
 *
 * @param investigationId The investigation.
 * @param targetSourceId The tracker the drafts are for; omitted when the workspace has one.
 * @returns Where to review the batch, and whether it was created now or already existed — or
 *   the service's refusal (`roadmap_target_required` when a tracker must be named).
 * @throws Whatever is not an `ApiError`.
 */
export async function draftEpicFromGaps(
  investigationId: string,
  targetSourceId?: string,
): Promise<DraftEpicOutcome> {
  try {
    const drafted = await research.draftEpic(
      investigationId,
      targetSourceId === undefined ? {} : { targetSourceId },
    );

    return { ok: true, href: drafted.href, created: drafted.created };
  } catch (error) {
    return { ok: false, refusal: refusalOf(error) };
  }
}
