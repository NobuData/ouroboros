import "server-only";

/**
 * The PR verification page's first read, and the by-run lookup, on the server
 * ([#363](https://github.com/NobuData/ouroboros/issues/363)).
 *
 * What the page paints before the browser's poll has answered — `app/runs/data.ts`'s three
 * outcomes, for the same reasons: a page, a PR that does not exist *for this workspace* (the
 * route's `notFound()`), and a failure the page draws as a banner while the poll keeps asking.
 *
 * {@link runPullRequests} is how a surface that holds runs and not PRs links here: the run
 * console, test results and the dashboard's rows each ask which of their runs opened a PR, and
 * link only those that did.
 *
 * {@link readEpics} is the Merge plan card's roadmap
 * ([#369](https://github.com/NobuData/ouroboros/issues/369)): the epics its picker offers, and the
 * name of the one the plan back-annotates.
 */

import { isApiError } from "@/app/api/errors";
import { planning } from "@/app/api/planning";
import {
  type PullRequestPage,
  type PullRequestRef,
  type PullRequestSummary,
  isPullRequestId,
  pullRequests,
} from "@/app/api/pull-requests";

import type { PlanEpic } from "./merge-plan";

/** What the first read found. */
export type PrReading =
  | { readonly state: "found"; readonly value: PullRequestPage }
  | { readonly state: "missing" }
  | { readonly state: "failed"; readonly reason: string };

/**
 * Read one PR's page.
 *
 * @param prId The PR's id, from the URL.
 * @param read How to read it. Replaced in tests.
 * @returns The reading. An id that is not a uuid is `missing` without calling out; an error that
 *   is not the API's own is rethrown.
 */
export async function readPr(
  prId: string,
  read: (prId: string) => Promise<PullRequestPage> = (asked) => pullRequests.page(asked),
): Promise<PrReading> {
  if (!isPullRequestId(prId)) return { state: "missing" };

  try {
    return { state: "found", value: await read(prId) };
  } catch (error) {
    if (!isApiError(error)) throw error;
    if (error.status === 404 || error.status === 400) return { state: "missing" };

    return { state: "failed", reason: error.message };
  }
}

/**
 * Find the PRs some runs opened — **best-effort**, because a link to the PR page is never the
 * reason the page asking was opened.
 *
 * @param runIds The runs' ids. Ids that are not uuids are left out rather than sent.
 * @param find How to look them up. Replaced in tests.
 * @returns Each run's PR, by run id. Empty when none of them opened one, and when the lookup was
 *   refused — a surface then draws no link rather than a guessed one. An error that is not the
 *   API's own is rethrown: a bug is not a missing link.
 */
export async function runPullRequests(
  runIds: readonly string[],
  find: (runIds: readonly string[]) => Promise<ReadonlyMap<string, PullRequestSummary>> = (
    asked,
  ) => pullRequests.forRuns(asked),
): Promise<ReadonlyMap<string, PullRequestRef>> {
  const asked = runIds.filter(isPullRequestId);
  if (asked.length === 0) return new Map();

  try {
    const found = await find(asked);

    return new Map([...found].map(([runId, pr]) => [runId, { id: pr.id, number: pr.number }]));
  } catch (error) {
    if (!isApiError(error)) throw error;

    return new Map();
  }
}

/**
 * Read the workspace's roadmap epics — **best-effort**, because the roadmap is never the reason
 * the PR page was opened.
 *
 * @param read How to read them. Replaced in tests.
 * @returns The epics, top first, each by id and name. `null` when the read was refused: the card
 *   then says the roadmap could not be read, rather than offering an empty picker as though the
 *   workspace had no epics. An error that is not the API's own is rethrown.
 */
export async function readEpics(
  read: () => Promise<readonly PlanEpic[]> = () => planning.epics(),
): Promise<readonly PlanEpic[] | null> {
  try {
    return (await read()).map((epic) => ({ id: epic.id, name: epic.name }));
  } catch (error) {
    if (!isApiError(error)) throw error;

    return null;
  }
}
