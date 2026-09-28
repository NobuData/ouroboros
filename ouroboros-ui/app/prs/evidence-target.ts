import "server-only";

/**
 * Where a citation of a test or a measurement leads, resolved on the server
 * ([#366](https://github.com/NobuData/ouroboros/issues/366)).
 *
 * A citation names a row — `test_cases.id`, `hil_measurements.id` — and not the attempt it ran
 * in, while the test-results page is addressed by attempt (`?attempt=4`). So the matrix links to
 * `/prs/:id/evidence/:evidenceId`, and following it reads the run's attempts, newest first, until
 * one holds the row:
 *
 * | Kind              | Lands on                                                          |
 * |-------------------|-------------------------------------------------------------------|
 * | `test_case`       | that attempt's page, the case's suite selected (#335, #337)       |
 * | `hil_measurement` | that attempt's page, the measured case selected on its card (#338) |
 *
 * The cost — a read per attempt, at most {@link MAX_ATTEMPTS_READ} — is paid when a link is
 * followed, never to draw the matrix.
 */

import { isApiError } from "@/app/api/errors";
import {
  type PrEvidence,
  type PullRequestPage,
  isPullRequestId,
  pullRequests,
} from "@/app/api/pull-requests";
import { type TestRunPage, type TestRunTimeline, testResults } from "@/app/api/test-results";
import { testsPath } from "@/app/paths";

/** The most attempts one resolution reads, newest first. */
export const MAX_ATTEMPTS_READ = 12;

/** How the reads are made. Replaced in tests. */
export interface TargetReaders {
  readonly page: (prId: string) => Promise<PullRequestPage>;
  readonly timeline: (runId: string) => Promise<TestRunTimeline>;
  readonly attempt: (testRunId: string) => Promise<TestRunPage>;
}

/** The production readers, over the request-scoped client. */
const READERS: TargetReaders = {
  page: (prId) => pullRequests.page(prId),
  timeline: (runId) => testResults.timeline(runId),
  attempt: (testRunId) => testResults.page(testRunId),
};

/**
 * What an attempt's page says about a citation.
 *
 * @param evidence The citation.
 * @param results The attempt's page.
 * @returns What to select on that page — the suite's name for a test, the measured case's name
 *   for a measurement — or `null` when the attempt does not hold the row.
 */
export function selectionIn(
  evidence: PrEvidence,
  results: Pick<TestRunPage, "suites" | "physical">,
): { readonly suite?: string; readonly case?: string } | null {
  if (evidence.kind === "test_case") {
    const suite = results.suites.find((each) =>
      each.cases.some((row) => row.id === evidence.ref.testCaseId),
    );

    return suite === undefined ? null : { suite: suite.name };
  }

  if (evidence.kind === "hil_measurement") {
    const measured = results.physical.find((each) =>
      each.measurements.some((row) => row.id === evidence.ref.hilMeasurementId),
    );

    return measured === undefined ? null : { case: measured.name };
  }

  return null;
}

/**
 * Resolve where a citation leads.
 *
 * @param prId The PR's id, from the URL.
 * @param evidenceId The citation's id, from the URL.
 * @param from The module the PR page was opened from, or `undefined`.
 * @param readers How to read. Replaced in tests.
 * @returns The test-results address with the row selected — or `null` when either id is not a
 *   uuid, the PR is not this workspace's, the matrix holds no such citation, the citation is not
 *   of a test or a measurement, no loop opened the PR, or none of the attempts read holds the
 *   row. An error that is not the API's own is rethrown.
 */
export async function evidenceTargetPath(
  prId: string,
  evidenceId: string,
  from: string | undefined,
  readers: TargetReaders = READERS,
): Promise<string | null> {
  if (!isPullRequestId(prId) || !isPullRequestId(evidenceId)) return null;

  try {
    const page = await readers.page(prId);
    const run = page.pullRequest.run;
    const evidence = page.criteria.criteria
      .flatMap((criterion) => criterion.evidence)
      .find((each) => each.id === evidenceId);

    if (run === null || evidence === undefined) return null;
    if (evidence.kind !== "test_case" && evidence.kind !== "hil_measurement") return null;

    const attempts = (await readers.timeline(run.id)).attempts
      .toReversed()
      .slice(0, MAX_ATTEMPTS_READ);

    for (const attempt of attempts) {
      const selection = selectionIn(evidence, await readers.attempt(attempt.id));

      if (selection !== null) {
        return testsPath(run.id, { from, attempt: attempt.attemptSeq, ...selection });
      }
    }

    return null;
  } catch (error) {
    if (!isApiError(error)) throw error;

    return null;
  }
}
