/**
 * An in-memory {@link TestResultsStore} — what the orchestration's unit suites run on (#329).
 * It counts the way V051's views do (`failed` includes `error`), so a unit suite can check the
 * totals a parse reports; `test-results.integration-spec.ts` checks the real recount.
 */

import type {
  AttemptRef,
  AttemptTotals,
  PriorCoverage,
  TestResultsStore,
  TreeWrite,
} from "./test-results.repository";

/** See this file's header. */
export class InMemoryTestResultsStore implements TestResultsStore {
  /** Every replacement written, in order. */
  readonly writes: TreeWrite[] = [];

  /**
   * @param attempts - The attempts that exist.
   * @param prior - The prior coverage {@link priorCoverage} answers, by attempt id.
   */
  constructor(
    private readonly attempts: readonly AttemptRef[],
    private readonly prior: Readonly<Record<string, PriorCoverage>> = {},
  ) {}

  /** @inheritdoc */
  attempt(organizationId: string, testRunId: string): Promise<AttemptRef | undefined> {
    return Promise.resolve(
      this.attempts.find((a) => a.organizationId === organizationId && a.id === testRunId),
    );
  }

  /** @inheritdoc */
  priorCoverage(attempt: AttemptRef): Promise<PriorCoverage | undefined> {
    return Promise.resolve(this.prior[attempt.id]);
  }

  /** @inheritdoc */
  replaceTree(write: TreeWrite): Promise<AttemptTotals> {
    this.writes.push(write);

    const statuses = write.suites.flatMap((suite) => suite.cases.map((kase) => kase.status));
    const count = (...of: string[]): number => statuses.filter((s) => of.includes(s)).length;

    return Promise.resolve({
      total: statuses.length,
      passed: count("passed"),
      failed: count("failed", "error"),
      flaky: count("flaky"),
      skipped: count("skipped"),
    });
  }
}
