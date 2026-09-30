"use server";

/**
 * The server hop for the **+ New skill** dialog
 * (BG.1, [#417](https://github.com/NobuData/ouroboros/issues/417)) — the one call its Client
 * Component cannot make itself.
 *
 * `app/planning/create-actions.ts` is the same seam for mockup 09's create dialog, and states the
 * rule: the browser cannot reach REST, so a Client Component that needs the API calls a Server
 * Action that calls it.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * - **There is no workspace in the call and no person.** The skill belongs to the workspace the
 *   caller's own session is acting in, resolved by `ouroboros-rest` from the cookie.
 * - **The role gate is the service's** — `owner` or `admin`. The head does not draw the control for
 *   anyone else, but that is presentation; a member who reaches {@link createSkill} anyway gets
 *   the service's `403` and writes nothing.
 * - **What is sent is what the dialog composed**, and the service validates it.
 *
 * A refusal comes back as a value, not a throw, so the dialog stays open over the page. The one
 * throw that must travel is Next.js's redirect signal. A `"use server"` module may export only
 * async functions, so the sentences live in `app/knowledge/create.ts`.
 */

import type { ErrorEnvelope } from "@/app/api/errors";
import { isApiError } from "@/app/api/errors";
import { type CreateSkillBody, skills } from "@/app/api/skills";

/** What one create produced. */
export type CreateSkillOutcome =
  /** The stored skill's slug and name. */
  | { readonly ok: true; readonly slug: string; readonly name: string }
  /** The service's refusal, for `create.ts`'s `createFailure` to turn into sentences. */
  | { readonly ok: false; readonly refusal: ErrorEnvelope };

/**
 * Create one skill, as a draft with no version.
 *
 * @param body The document and its address, composed by `create.ts`'s `createBody` and forwarded
 *   as it is.
 * @returns The stored skill's slug and name, or the service's refusal — which means nothing was
 *   created, since this is one `POST`.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function createSkill(body: CreateSkillBody): Promise<CreateSkillOutcome> {
  try {
    const detail = await skills.create(body);

    return { ok: true, slug: detail.skill.slug, name: detail.skill.name };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return {
      ok: false,
      refusal: { code: error.code, message: error.message, details: error.details },
    };
  }
}
