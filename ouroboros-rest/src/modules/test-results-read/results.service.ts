/**
 * The Test Results page's reads and the artifact download (AT.5,
 * [#333](https://github.com/NobuData/ouroboros/issues/333)).
 *
 * ```
 * timeline(run)          attempts + strips + T8's next step     GET /runs/:id/test-runs
 * page(attempt)          suites · cases · HIL · classifications GET /test-runs/:id
 *                        · artifacts · coverage · warnings
 * failure(attempt, case) message · log excerpt · path           GET /test-runs/:id/cases/:caseId/failure
 * download(artifact)     the store's stream + how to serve it   GET /artifacts/:id
 * ```
 *
 * Every read is scoped to the caller's workspace by the repository, and each thing that is not
 * found — absent or another workspace's — is the same `404`.
 */

import { Inject, Injectable } from "@nestjs/common";
import type { Readable } from "node:stream";

import { ArtifactNotFoundError, type ArtifactStore } from "../farm/artifacts/artifact.store";
import { ARTIFACT_STORE } from "../farm/artifacts/artifact.store.factory";
import { runNotFound } from "../runs/runs.errors";
import { testCaseNotFound, testRunNotFound } from "../triage/triage.errors";
import { classificationResource } from "../triage/triage.resources";
import { presentationOf, type ArtifactPresentation } from "./artifact.serving";
import {
  artifactContentUnavailable,
  artifactExpired,
  artifactNotFound,
  testCaseFailureNotFound,
} from "./results.errors";
import { ResultsRepository, type AttemptRow, type FlakeRow } from "./results.repository";
import {
  artifactResource,
  attemptResource,
  caseFailureResource,
  caseResource,
  coverageResource,
  parseWarnings,
  physicalResources,
  suiteResource,
  timelineRunResource,
  type CaseFailureResource,
  type NextStepResource,
  type TestRunPageResource,
  type TestRunTimelineResource,
} from "./results.resources";
import { activationState } from "./results.strip";

/** The statuses whose cases the strip names. */
const STRIP_STATUSES = ["failed", "error", "flaky"] as const;

/** An artifact ready to stream. */
export interface ArtifactDownload {
  readonly body: Readable;
  readonly sizeBytes: number;
  readonly presentation: ArtifactPresentation;
}

@Injectable()
export class ResultsService {
  /**
   * @param results - The statements.
   * @param store - The configured artifact store — the only thing that reads the bytes.
   */
  constructor(
    private readonly results: ResultsRepository,
    @Inject(ARTIFACT_STORE) private readonly store: ArtifactStore,
  ) {}

  /**
   * The attempts timeline of a run, each attempt's strip, and the next step.
   *
   * @param organizationId - The workspace.
   * @param runId - The run.
   * @returns The timeline.
   * @throws {NotFoundError} `404 run_not_found`.
   */
  async timeline(organizationId: string, runId: string): Promise<TestRunTimelineResource> {
    const run = await this.results.run(organizationId, runId);
    if (run === undefined) throw runNotFound(runId);

    const attempts = await this.results.attempts(organizationId, { runId });
    const ids = attempts.map((attempt) => attempt.id);
    const [suites, cases, intents, pullRequest] = await Promise.all([
      this.results.suites(organizationId, ids),
      this.results.cases(organizationId, ids, { statuses: STRIP_STATUSES }),
      this.results.intents(organizationId, runId),
      this.results.pullRequest(organizationId, runId),
    ]);
    const flakes = await this.flakeMap(
      organizationId,
      run.github_repo_id,
      cases.filter((each) => each.status === "flaky").map((each) => each.case_key),
    );

    const latest = attempts.at(-1);
    const blockUntilGreen = intents?.block_until_green ?? false;
    const gateRequired = pullRequest?.gate_required ?? null;
    const next: NextStepResource = {
      action: "publish_to_pr",
      pullRequest:
        pullRequest === undefined
          ? null
          : { number: pullRequest.external_number, url: pullRequest.external_url },
      gatedOn: latest === undefined ? null : { passed: latest.total, total: latest.total },
      activation: activationState(blockUntilGreen, gateRequired),
      intents: { blockUntilGreen, autoRerunPhysical: intents?.auto_rerun_physical ?? false },
      gate:
        pullRequest === undefined || gateRequired === null || pullRequest.gate_source === null
          ? null
          : { required: gateRequired, source: pullRequest.gate_source },
    };

    return {
      run: timelineRunResource(run),
      attempts: attempts.map((attempt) =>
        attemptResource(attempt, { siblings: attempts, suites, cases, flakes }),
      ),
      latestTestRunId: latest?.id ?? null,
      next,
    };
  }

  /**
   * Everything the page shows of one attempt.
   *
   * @param organizationId - The workspace.
   * @param testRunId - The attempt.
   * @returns The page payload.
   * @throws {NotFoundError} `404 test_run_not_found`.
   */
  async page(organizationId: string, testRunId: string): Promise<TestRunPageResource> {
    const attempt = await this.attemptOrThrow(organizationId, testRunId);
    const run = await this.results.run(organizationId, attempt.run_id);
    if (run === undefined) throw testRunNotFound(testRunId);

    const [siblings, suites, cases, measurements, classifications, artifacts, coverage] =
      await Promise.all([
        this.results.attempts(organizationId, { runId: attempt.run_id }),
        this.results.suites(organizationId, [testRunId]),
        this.results.cases(organizationId, [testRunId]),
        this.results.measurements(organizationId, testRunId),
        this.results.classifications(organizationId, testRunId),
        this.results.artifacts(organizationId, testRunId),
        this.results.coverage(organizationId, testRunId),
      ]);
    const flakes = await this.flakeMap(
      organizationId,
      run.github_repo_id,
      cases.map((each) => each.case_key),
    );
    const summary = coverage === undefined ? null : coverageResource(coverage);

    return {
      runId: attempt.run_id,
      testRun: attemptResource(attempt, { siblings, suites, cases, flakes }),
      parseWarnings: parseWarnings(attempt.parse_warnings),
      suites: suites.map((suite) =>
        suiteResource(
          suite,
          cases
            .filter((each) => each.test_suite_id === suite.id)
            .map((each) => caseResource(each, flakes.get(each.case_key))),
        ),
      ),
      physical: physicalResources(cases, measurements),
      classifications: classifications.map(classificationResource),
      artifacts: artifacts.map((artifact) => artifactResource(artifact, summary)),
      coverage: summary,
    };
  }

  /**
   * A failing case's payload — the failure detail card.
   *
   * @param organizationId - The workspace.
   * @param testRunId - The attempt.
   * @param caseId - The case.
   * @returns Its message, log excerpt and path.
   * @throws {NotFoundError} `404 test_run_not_found`, `404 test_case_not_found`,
   *   `404 test_case_failure_not_found`.
   */
  async failure(
    organizationId: string,
    testRunId: string,
    caseId: string,
  ): Promise<CaseFailureResource> {
    await this.attemptOrThrow(organizationId, testRunId);

    const [row] = await this.results.cases(organizationId, [testRunId], { caseId });
    if (row === undefined) throw testCaseNotFound(testRunId, caseId);

    const failure = caseFailureResource(row);
    if (failure.message === null && failure.logExcerpt === null && failure.path === null) {
      throw testCaseFailureNotFound(testRunId, caseId);
    }

    return failure;
  }

  /**
   * Open an artifact for download, through the configured store.
   *
   * @param organizationId - The workspace.
   * @param artifactId - The artifact.
   * @returns Its stream, size and presentation.
   * @throws {NotFoundError} `404 artifact_not_found`, `404 artifact_content_unavailable`.
   * @throws {GoneError} `410 artifact_expired`.
   */
  async download(organizationId: string, artifactId: string): Promise<ArtifactDownload> {
    const row = await this.results.artifact(organizationId, artifactId);
    if (row === undefined) throw artifactNotFound(artifactId);
    if (row.expired_at !== null) throw artifactExpired(artifactId, row.expired_at);

    const key = storedKey(row.storage_ref, this.store.driver);
    if (key === null) throw artifactContentUnavailable(artifactId);

    let body: Readable;
    try {
      body = await this.store.open(key);
    } catch (error) {
      if (error instanceof ArtifactNotFoundError) throw artifactContentUnavailable(artifactId);
      throw error;
    }

    return {
      body,
      sizeBytes: Number(row.size_bytes),
      presentation: presentationOf(row.kind, row.name),
    };
  }

  /**
   * An attempt of this workspace.
   *
   * @param organizationId - The workspace.
   * @param testRunId - The attempt.
   * @returns It.
   * @throws {NotFoundError} `404 test_run_not_found`.
   */
  private async attemptOrThrow(organizationId: string, testRunId: string): Promise<AttemptRow> {
    const [attempt] = await this.results.attempts(organizationId, { testRunId });
    if (attempt === undefined) throw testRunNotFound(testRunId);

    return attempt;
  }

  /**
   * Flake states of some cases, by key.
   *
   * @param organizationId - The workspace.
   * @param githubRepoId - The run's repository.
   * @param caseKeys - The cases.
   * @returns A map from case key to score.
   */
  private async flakeMap(
    organizationId: string,
    githubRepoId: string,
    caseKeys: readonly string[],
  ): Promise<Map<string, FlakeRow>> {
    const rows = await this.results.flakes(organizationId, githubRepoId, [...new Set(caseKeys)]);
    return new Map(rows.map((row) => [row.case_key, row]));
  }
}

/**
 * The key of a stored artifact, when this process's store holds it.
 *
 * @param storageRef - `test_artifacts.storage_ref` — `{driver, key}` (V055's shape).
 * @param driver - The configured store's driver.
 * @returns The key, or null when the row names another driver or no key.
 */
export function storedKey(storageRef: unknown, driver: string): string | null {
  if (typeof storageRef !== "object" || storageRef === null) return null;

  const ref = storageRef as { driver?: unknown; key?: unknown };
  return ref.driver === driver && typeof ref.key === "string" ? ref.key : null;
}
