"use server";

/**
 * The server hop for *Re-run failed (N)* and *Re-run full suite*
 * ([#335](https://github.com/NobuData/ouroboros/issues/335), over AT.4's
 * [#332](https://github.com/NobuData/ouroboros/issues/332)).
 *
 * `app/runs/control-actions.ts` states the rule this exists under: the browser cannot reach
 * `ouroboros-rest`, so a Client Component that needs to write calls a Server Action that calls
 * it. A Server Action is a POST endpoint anybody holding the page can reach with any arguments,
 * so:
 *
 * - **The role gate is the service's.** A re-run is `owner`, `admin` or `member`; the page
 *   switches the buttons off for a viewer with the reason, and a viewer who calls this anyway
 *   gets the service's `403`, handed back as a refusal.
 * - **The runner gate is advice, not a lock.** The page disables the buttons while no runner is
 *   eligible, but the service queues a re-run whatever the fleet looks like and answers the honest
 *   queue state — so a press that raced a runner going offline still says where it stands.
 * - **The id is checked before it is put in a path**, and **the scope is one of two**; anything
 *   else is refused before calling out.
 *
 * A refusal is a value, because the page is one the reader is still entitled to be on.
 */

import { isApiError } from "@/app/api/errors";
import { type RerunScope, isTestRunId, testResults } from "@/app/api/test-results";

import {
  RERUN_INVALID,
  RERUN_INVALID_CODE,
  RERUN_UNREACHABLE,
  RERUN_UNREACHABLE_CODE,
  type RerunOutcome,
} from "./rerun";

/**
 * Queue a re-run of an attempt.
 *
 * @param testRunId The attempt.
 * @param scope `failed` or `full`.
 * @returns The queued build and its queue state, or the reason nothing was queued.
 * @throws Whatever is not an `ApiError` or a dropped connection — Next.js's redirect signal for an
 *   ended session above all.
 */
export async function requestRerun(testRunId: string, scope: RerunScope): Promise<RerunOutcome> {
  if (!isTestRunId(testRunId) || (scope !== "failed" && scope !== "full")) {
    return { ok: false, status: 422, code: RERUN_INVALID_CODE, reason: RERUN_INVALID };
  }

  try {
    return { ok: true, rerun: await testResults.rerun(testRunId, scope) };
  } catch (error) {
    if (!isApiError(error)) {
      if (error instanceof TypeError) {
        return { ok: false, status: 502, code: RERUN_UNREACHABLE_CODE, reason: RERUN_UNREACHABLE };
      }
      throw error;
    }

    return { ok: false, status: error.status, code: error.code, reason: error.message };
  }
}
