import "server-only";

/**
 * One read of a repository's Build Analyzer page, for the poll's hop (BW.1,
 * [#516](https://github.com/NobuData/ouroboros/issues/516)).
 *
 * Five service reads made together — the newest run, the schedule, the duration chart (BW.2,
 * [#517](https://github.com/NobuData/ouroboros/issues/517)), the suggestion cards (BW.3,
 * [#518](https://github.com/NobuData/ouroboros/issues/518)) and the drafted-tickets card (BW.4,
 * [#519](https://github.com/NobuData/ouroboros/issues/519)) — under the poll family's deadline,
 * answered as a `PollAnswer`. A page whose run is in flight asks to be read again every
 * {@link RUNNING_POLL_SECONDS} seconds, which is what makes the progress panel tick; so does one
 * with a drafted batch the estimator is still sizing, which is what turns `sizing…` into chips.
 */

import { analyzer } from "@/app/api/analyzer";
import { readForPoll } from "@/app/api/poll-read";
import { anonymousApi } from "@/app/api/server";
import { type AnalyzerPage, RUNNING_POLL_SECONDS, UNREACHABLE_ANALYZER } from "@/app/analyzer/analyzer-poll";
import { isSettling } from "@/app/planning/batch-poll";
import type { PollAnswer } from "@/app/poll";

/** The code a failed read is reported under — this hop's own, not the service's. */
export const ANALYZER_UNAVAILABLE_CODE = "analyzer_unavailable";

/**
 * Read one repository's page.
 *
 * @param repo The repository, `owner/name`.
 * @param read How to read it. Defaults to the five service reads; a suite passes a stub.
 * @returns The page — with a short interval while a run is in flight or a drafted batch is still
 *   being sized — or why it could not be read.
 */
export async function readAnalyzerPage(
  repo: string,
  read: (repo: string, signal: AbortSignal) => Promise<AnalyzerPage> = async (asked, signal) => {
    const client = anonymousApi();
    const [run, schedule, duration, suggestions, tickets] = await Promise.all([
      analyzer.latest(asked, client, signal),
      analyzer.schedule(asked, client, signal),
      analyzer.duration(asked, client, signal),
      analyzer.suggestions(asked, client, signal),
      analyzer.tickets(asked, client, signal),
    ]);

    return { repo: asked, run, schedule, duration, suggestions, tickets };
  },
): Promise<PollAnswer<AnalyzerPage>> {
  const answer = await readForPoll((signal) => read(repo, signal), UNREACHABLE_ANALYZER);

  if (answer.state !== "fresh") return answer;

  const { run, tickets } = answer.payload;
  const moving = run?.status === "running" || tickets.batches.some((entry) => isSettling(entry.batch));

  return moving ? { ...answer, pollAfterSeconds: RUNNING_POLL_SECONDS } : answer;
}
