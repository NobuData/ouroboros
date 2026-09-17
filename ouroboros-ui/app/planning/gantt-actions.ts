"use server";

/**
 * The server hops for the roadmap gantt and its epic editor
 * (AM.4, [#286](https://github.com/NobuData/ouroboros/issues/286)) — the calls their Client Components
 * cannot make themselves, because the browser cannot reach REST.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * - **There is no workspace in any call.** Every lane is the session's workspace's, resolved by
 *   `ouroboros-rest` from the cookie; an id from another workspace answers `404`.
 * - **The role gates are the service's.** A drag, a stepper, a save, an add, a link and an unlink are
 *   `owner` or `admin`; the two reads are any member's. The gantt draws controls inert for other
 *   readers, but that is presentation — a member who posts here anyway gets the service's `403`.
 * - **What is sent is what the caller composed**, and the service validates it.
 *
 * Every refusal comes back as a value (`app/workflows/action-outcome.ts`), so the card and the sheet
 * stay on screen and say what happened. A `"use server"` module may export only async functions, so
 * the sentences live in `app/planning/gantt.ts` and `app/planning/epic-editor.ts`.
 */

import {
  type PlanningEpic,
  type PlanningEpicCreate,
  type PlanningEpicLinks,
  type PlanningEpicPatch,
  type PlanningTicketSearch,
  planning,
} from "@/app/api/planning";
import { type ActionOutcome, attempt } from "@/app/workflows/action-outcome";

/** What a link or an unlink produced: the lane with its chip recomputed, and its lists re-read. */
export interface LinksOutcome {
  /** The lane, as the write answered it. */
  readonly epic: PlanningEpic;
  /** The lane's tickets and mirrors after the write, or `null` when that read was refused. */
  readonly links: PlanningEpicLinks | null;
}

/**
 * Change one lane — a drag, a stepper, or the editor's **Save**.
 *
 * @param epicId The lane.
 * @param body What changes.
 * @returns The stored lane, or the refusal — which means nothing changed, since this is one `PATCH`.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function updateEpic(
  epicId: string,
  body: PlanningEpicPatch,
): Promise<ActionOutcome<PlanningEpic>> {
  return attempt(() => planning.updateEpic(epicId, body));
}

/**
 * Add a lane at the bottom of the roadmap — **Add epic**.
 *
 * @param body The lane, under the roadmap's head.
 * @returns The stored lane, or the refusal.
 * @throws Whatever is not an `ApiError`.
 */
export async function addEpic(body: PlanningEpicCreate): Promise<ActionOutcome<PlanningEpic>> {
  return attempt(() => planning.createEpic(body));
}

/**
 * A lane's linked tickets and tracker mirrors.
 *
 * @param epicId The lane.
 * @returns The lists, or the refusal.
 * @throws Whatever is not an `ApiError`.
 */
export async function readEpicLinks(epicId: string): Promise<ActionOutcome<PlanningEpicLinks>> {
  return attempt(() => planning.epicLinks(epicId));
}

/**
 * The link picker's search.
 *
 * @param term What was typed.
 * @returns The matches, or the refusal.
 * @throws Whatever is not an `ApiError`.
 */
export async function searchTickets(term: string): Promise<ActionOutcome<PlanningTicketSearch>> {
  return attempt(() => planning.searchTickets(term));
}

/**
 * Link one ticket to a lane, or unlink it, and read the lane's lists again.
 *
 * @param epicId The lane.
 * @param ticketId The ticket.
 * @param linked `true` to link, `false` to unlink.
 * @returns The lane and its lists, or the write's refusal.
 * @throws Whatever is not an `ApiError`.
 */
export async function setTicketLinked(
  epicId: string,
  ticketId: string,
  linked: boolean,
): Promise<ActionOutcome<LinksOutcome>> {
  const written = await attempt(() =>
    linked ? planning.linkTickets(epicId, [ticketId]) : planning.unlinkTickets(epicId, [ticketId]),
  );

  if (!written.ok) return written;

  const links = await attempt(() => planning.epicLinks(epicId));

  return { ok: true, value: { epic: written.value, links: links.ok ? links.value : null } };
}
