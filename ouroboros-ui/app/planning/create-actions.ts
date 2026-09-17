"use server";

/**
 * The server hop for the **New roadmap** dialog
 * (AM.1, [#283](https://github.com/NobuData/ouroboros/issues/283)) — the one call its Client
 * Component cannot make itself.
 *
 * `app/workflows/create-actions.ts` is the same seam for mockup 04's create dialog, and states the
 * rule: the browser cannot reach REST, so a Client Component that needs the API calls a Server
 * Action that calls it.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * - **There is no workspace in the call and no person.** The lane belongs to the workspace the
 *   caller's own session is acting in, resolved by `ouroboros-rest` from the cookie.
 * - **The role gate is the service's** — `owner` or `admin`. The head draws the control inert for
 *   anyone else, but that is presentation; a member who reaches {@link createRoadmap} anyway gets
 *   the service's `403` and writes nothing.
 * - **What is sent is what the dialog composed**, and the service validates it.
 *
 * A refusal comes back as a value, not a throw, so the dialog stays open over the page. The one
 * throw that must travel is Next.js's redirect signal. A `"use server"` module may export only
 * async functions, so the sentences live in `app/planning/create.ts`.
 */

import type { ErrorEnvelope } from "@/app/api/errors";
import { isApiError } from "@/app/api/errors";
import { type PlanningEpicCreate, planning } from "@/app/api/planning";

/** What one create produced. */
export type CreateRoadmapOutcome =
  /** The stored first epic's id, and the roadmap name it carries. */
  | { readonly ok: true; readonly epicId: string; readonly roadmapName: string | null }
  /** The service's refusal, for `create.ts`'s `createFailure` to turn into sentences. */
  | { readonly ok: false; readonly refusal: ErrorEnvelope };

/**
 * Name a roadmap by creating its first epic.
 *
 * @param body The lane, composed by `create.ts`'s `createBody` and forwarded as it is.
 * @returns The stored epic's id and roadmap name, or the service's refusal — which means nothing
 *   was created, since this is one `POST`.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function createRoadmap(body: PlanningEpicCreate): Promise<CreateRoadmapOutcome> {
  try {
    const epic = await planning.createEpic(body);

    return { ok: true, epicId: epic.id, roadmapName: epic.roadmapName };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return {
      ok: false,
      refusal: { code: error.code, message: error.message, details: error.details },
    };
  }
}
