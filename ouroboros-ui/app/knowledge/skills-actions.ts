"use server";

/**
 * The server hops for the skills table
 * (BG.2, [#418](https://github.com/NobuData/ouroboros/issues/418)) — the two calls its Client
 * Component cannot make itself: a switch's write, and the generated row's regenerate.
 *
 * `app/knowledge/create-actions.ts` is the same seam for the create dialog and states the rule:
 * the browser cannot reach REST, so a Client Component that needs the API calls a Server Action
 * that calls it.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * - **There is no workspace in the call and no person.** The skill belongs to the workspace the
 *   caller's own session is acting in, resolved by `ouroboros-rest` from the cookie.
 * - **The gates are the service's.** A member's switches are drawn read-only, but that is
 *   presentation; a member who reaches {@link setSkillEnabled} anyway gets `403 forbidden` back
 *   as a value and writes nothing. **The required lock is the service's too**: switching off a
 *   required skill is `403 skill_required_locked` for every role, owner included, which is why
 *   the table's locked switch makes this call rather than pretending to.
 *
 * A refusal comes back as a value, not a throw, so the row can show it. The one throw that must
 * travel is Next.js's redirect signal. A `"use server"` module may export only async functions,
 * so the sentences live in `app/knowledge/skills.ts`.
 */

import type { ErrorEnvelope } from "@/app/api/errors";
import { isApiError } from "@/app/api/errors";
import { type RegenerateRepoMapBody, type RepoMapReport, repoMap } from "@/app/api/repo-map";
import { type SkillSummary, skills } from "@/app/api/skills";

/** What one call produced: the service's answer, or its refusal as a value. */
export type SkillActionOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: ErrorEnvelope };

/**
 * Run one call, keeping the service's refusal as a value.
 *
 * @param call The call.
 * @returns Its answer, or the envelope.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
async function outcome<T>(call: () => Promise<T>): Promise<SkillActionOutcome<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return {
      ok: false,
      refusal: { code: error.code, message: error.message, details: error.details },
    };
  }
}

/**
 * Move one skill's switch.
 *
 * @param slug The skill's slug.
 * @param enabled The position to move to — not the position it is in, so a stale row asks for
 *   something specific rather than inverting whatever the flag has become since.
 * @returns The skill after the change, or the service's refusal — `skill_required_locked` for a
 *   required skill switched off, `forbidden` for a member.
 * @throws Whatever is not an `ApiError`.
 */
export async function setSkillEnabled(slug: string, enabled: boolean): Promise<SkillActionOutcome<SkillSummary>> {
  return outcome(() => skills.update(slug, { enabled }));
}

/**
 * Regenerate one repository's `repo-map` now.
 *
 * @param body The repository, `owner/name`.
 * @returns The generator's report, or the service's refusal — `repo_map_regenerate_too_soon`
 *   within a minute of the last run, `forbidden` for a member.
 * @throws Whatever is not an `ApiError`.
 */
export async function regenerateRepoMap(body: RegenerateRepoMapBody): Promise<SkillActionOutcome<RepoMapReport>> {
  return outcome(() => repoMap.regenerate(body));
}
