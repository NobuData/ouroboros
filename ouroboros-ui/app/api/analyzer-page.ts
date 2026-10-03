import "server-only";

/**
 * One read of a repository's Build Analyzer page, for the poll's hop (BW.1,
 * [#516](https://github.com/NobuData/ouroboros/issues/516)).
 *
 * Two service reads made together — the newest run and the schedule — under the poll family's
 * deadline, answered as a `PollAnswer`. A page whose run is in flight asks to be read again every
 * {@link RUNNING_POLL_SECONDS} seconds, which is what makes the progress panel tick.
 */

import { analyzer } from "@/app/api/analyzer";
import { readForPoll } from "@/app/api/poll-read";
import { anonymousApi } from "@/app/api/server";
import { type AnalyzerPage, RUNNING_POLL_SECONDS, UNREACHABLE_ANALYZER } from "@/app/analyzer/analyzer-poll";
import type { PollAnswer } from "@/app/poll";

/** The code a failed read is reported under — this hop's own, not the service's. */
export const ANALYZER_UNAVAILABLE_CODE = "analyzer_unavailable";

/**
 * Read one repository's page.
 *
 * @param repo The repository, `owner/name`.
 * @param read How to read it. Defaults to the two service reads; a suite passes a stub.
 * @returns The page with a short interval while a run is in flight, or why it could not be read.
 */
export async function readAnalyzerPage(
  repo: string,
  read: (repo: string, signal: AbortSignal) => Promise<AnalyzerPage> = async (asked, signal) => {
    const client = anonymousApi();
    const [run, schedule] = await Promise.all([
      analyzer.latest(asked, client, signal),
      analyzer.schedule(asked, client, signal),
    ]);

    return { repo: asked, run, schedule };
  },
): Promise<PollAnswer<AnalyzerPage>> {
  const answer = await readForPoll((signal) => read(repo, signal), UNREACHABLE_ANALYZER);

  if (answer.state === "fresh" && answer.payload.run?.status === "running") {
    return { ...answer, pollAfterSeconds: RUNNING_POLL_SECONDS };
  }

  return answer;
}
