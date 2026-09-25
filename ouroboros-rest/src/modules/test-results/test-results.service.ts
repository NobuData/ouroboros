/**
 * Parse orchestration — one completed upload set in, one attempt's tree out (AT.1,
 * [#329](https://github.com/NobuData/ouroboros/issues/329)).
 *
 * The upload path (AT.2, [#330](https://github.com/NobuData/ouroboros/issues/330)) calls
 * {@link TestResultIngestService.parseAttempt} when an attempt's manifest completes, with the files
 * and the pinned workflow's flake policy. The service:
 *
 * 1. asks the registry which parser reads each file (an unrecognised one is a
 *    `format_unrecognized` warning, never an error);
 * 2. parses every file, collecting their warnings;
 * 3. merges the outputs into one tree and applies the flake policy (`tree.ts`);
 * 4. replaces the attempt's tree in one transaction, recounts, and stores the warnings and the
 *    wall-time split (`test-results.repository.ts`);
 * 5. sums the coverage counts and computes the percentage and the delta against the prior attempt
 *    exactly as V059's `test_run_coverage` does.
 *
 * Coverage counts are **returned, not stored**: V059 stores them on the coverage `test_artifacts`
 * row, which the upload path inserts and the database freezes once written — so #330 inserts that
 * row with these numbers.
 */

import { Inject, Injectable } from "@nestjs/common";

import { NotFoundError } from "../errors/error.envelope";
import { NO_RETRIES, type FlakePolicy } from "./flake-policy";
import type { CoverageCounts, NormalizedSuite, ParseWarning, ResultFile } from "./parser.spi";
import { TestResultParserRegistry } from "./parser.registry";
import {
  TestResultsRepository,
  type AttemptTotals,
  type PriorCoverage,
  type TestResultsStore,
} from "./test-results.repository";
import { assembleTree, durationSplit, type DurationSplit } from "./tree";

/** The code a parse of an attempt the workspace does not have answers with. */
export const TEST_RUN_NOT_FOUND = "test_run_not_found";

/** One parse request. */
export interface ParseAttemptInput {
  /** The workspace the attempt belongs to. */
  readonly organizationId: string;
  /** `test_runs.id`. */
  readonly testRunId: string;
  /** The completed upload set. */
  readonly files: readonly ResultFile[];
  /** The pinned workflow's `flakes:` policy. Absent is {@link NO_RETRIES}. */
  readonly flakePolicy?: FlakePolicy;
}

/** The attempt's coverage, as the artifacts row prints it — `coverage 87.4% (+0.6%)`. */
export interface CoverageSummary {
  /** Summed over every coverage report in the set. */
  readonly linesCovered: number;
  readonly linesTotal: number;
  /** One decimal. */
  readonly percent: number;
  /** Percentage points against the prior attempt with coverage, one decimal. Absent when none. */
  readonly delta?: number;
  /** Which attempt the delta is against. Absent with it. */
  readonly previousAttemptSeq?: number;
  /** Each report's own counts — what #330 stores on each coverage artifact row. */
  readonly files: readonly CoverageCounts[];
}

/** What one parse did. */
export interface ParseReport {
  readonly testRunId: string;
  /** The attempt's stored counts after the recount. */
  readonly totals: AttemptTotals;
  readonly split: DurationSplit;
  /** Exactly what was stored on `test_runs.parse_warnings`. */
  readonly warnings: readonly ParseWarning[];
  /** Which parser read each file — null for one nothing recognised. */
  readonly parsedBy: Readonly<Record<string, string | null>>;
  /** Absent when the set had no readable coverage report. */
  readonly coverage?: CoverageSummary;
}

/** See this file's header. */
@Injectable()
export class TestResultIngestService {
  /**
   * @param registry - The registered parsers.
   * @param store - The statements.
   */
  constructor(
    private readonly registry: TestResultParserRegistry,
    @Inject(TestResultsRepository) private readonly store: TestResultsStore,
  ) {}

  /**
   * Parse one attempt's upload set into its tree, replacing whatever an earlier parse wrote.
   * Idempotent: the same set parsed twice leaves the same rows.
   *
   * The set is the **whole** of the attempt's results: a suite absent from it is deleted. Pass
   * every file of the manifest on every call — a set with nothing readable leaves an empty tree
   * and the warnings that say why.
   *
   * @param input - The attempt, the files and the flake policy.
   * @returns What was written, the warnings, and the coverage summary.
   * @throws {NotFoundError} `test_run_not_found` when the workspace has no such attempt.
   */
  async parseAttempt(input: ParseAttemptInput): Promise<ParseReport> {
    const attempt = await this.store.attempt(input.organizationId, input.testRunId);

    if (attempt === undefined) {
      throw new NotFoundError(TEST_RUN_NOT_FOUND, "No such test run in this workspace.", {
        testRunId: input.testRunId,
      });
    }

    const flakePolicy = input.flakePolicy ?? NO_RETRIES;
    const suites: NormalizedSuite[] = [];
    const coverage: CoverageCounts[] = [];
    const warnings: ParseWarning[] = [];
    const parsedBy: Record<string, string | null> = {};

    for (const file of input.files) {
      const parser = this.registry.detect(file);

      parsedBy[file.name] = parser?.id ?? null;
      if (parser === null) {
        warnings.push({
          code: "format_unrecognized",
          file: file.name,
          message: "No registered parser reads this file; it was ignored.",
        });
        continue;
      }

      const output = parser.parse(file, { flakePolicy });

      suites.push(...output.suites);
      coverage.push(...output.coverage);
      warnings.push(...output.warnings);
    }

    const tree = assembleTree(suites, flakePolicy);
    const split = durationSplit(tree);
    const totals = await this.store.replaceTree({ attempt, suites: tree, warnings, split });
    const prior = coverage.length === 0 ? undefined : await this.store.priorCoverage(attempt);

    return {
      testRunId: attempt.id,
      totals,
      split,
      warnings,
      parsedBy,
      ...(coverage.length === 0 ? {} : { coverage: summarizeCoverage(coverage, prior) }),
    };
  }
}

/**
 * The attempt's coverage, with the delta against the prior attempt.
 *
 * V059's arithmetic: the percentage is `round(100 × covered / total, 1)`, and the delta is the
 * difference of the **unrounded** ratios rounded once, so it cannot drift from the two percentages
 * by a rounding step taken twice.
 *
 * @param files - Every readable report's counts. Must not be empty.
 * @param prior - The latest earlier attempt with coverage, or undefined.
 * @returns The summary; `delta` absent — not zero — when there is no prior.
 */
export function summarizeCoverage(
  files: readonly CoverageCounts[],
  prior: PriorCoverage | undefined,
): CoverageSummary {
  const linesCovered = files.reduce((sum, file) => sum + file.linesCovered, 0);
  const linesTotal = files.reduce((sum, file) => sum + file.linesTotal, 0);
  const ratio = (100 * linesCovered) / linesTotal;
  const summary = { linesCovered, linesTotal, percent: roundTenth(ratio), files: [...files] };

  if (prior === undefined) {
    return summary;
  }

  return {
    ...summary,
    delta: roundTenth(ratio - (100 * prior.linesCovered) / prior.linesTotal),
    previousAttemptSeq: prior.attemptSeq,
  };
}

/**
 * Round to one decimal, half away from zero — PostgreSQL's `round(numeric, 1)`.
 *
 * @param value - The value.
 * @returns It, to one decimal.
 */
export function roundTenth(value: number): number {
  // The epsilon absorbs binary representation error (87.45 is stored as 87.4499…).
  const rounded = Math.sign(value) * (Math.round(Math.abs(value) * 10 + 1e-9) / 10);

  return rounded === 0 ? 0 : rounded;
}
