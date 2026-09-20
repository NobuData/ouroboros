"use server";

/**
 * The server hop for the submit-build dialog (AI.5,
 * [#260](https://github.com/NobuData/ouroboros/issues/260)) — the one write its Client Component
 * cannot make itself.
 *
 * `app/farm/pool-actions.ts` states the rules this keeps. **A Server Action is a POST endpoint
 * anybody can reach**: there is no workspace in the call — the build lands in the workspace the
 * caller's own session is acting in — and the body is judged by the service, whose DTO refuses
 * a field it does not know and a command that is not argv.
 *
 * **The page draws Submit build for an `owner` or `admin` only** — the issue's gate — while the
 * service itself admits a `member` (AH.4, #252: *submitting a build is ordinary work*). That is
 * deliberate and one-sided: the dialog is the stricter of the two, so nobody it shows the
 * control to is refused, and a `member` using the API directly is the service's to decide.
 * **Every submission is audited there**, as `runner.job_submitted`.
 *
 * Failure is a value, not a throw; the one throw that must travel is Next.js's redirect signal.
 * The outcome type and the sentences live in `app/farm/submit.ts`, because a `"use server"`
 * module may export nothing but async functions.
 */

import { isApiError } from "@/app/api/errors";
import { type BuildJobSubmission, farm } from "@/app/api/farm";

import { type SubmitOutcome, submitRefusal } from "./submit";

/**
 * Submit a build to a pool.
 *
 * @param submission The pool, repository, ref, exact commit and — unless the pool's default is
 *   to run — argv. `submissionOf`'s, from a draft that validated.
 * @returns The queued build's id, number and pool — what the toast says — or the sentence and
 *   the fields it is about. **A refusal means nothing was queued.**
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function submitBuild(submission: BuildJobSubmission): Promise<SubmitOutcome> {
  try {
    const { id, number, pool } = await farm.submitJob(submission);

    // Three fields, not the job: the rest of it — the command above all — has no business in a
    // Server Action's answer when nothing on the page draws it.
    return { ok: true, job: { id, number, pool } };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, ...submitRefusal(error) };
  }
}
