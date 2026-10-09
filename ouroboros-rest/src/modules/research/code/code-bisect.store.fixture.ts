/* eslint-disable @typescript-eslint/require-await -- in-memory stand-ins answer at once; async keeps the real services' signatures */
/**
 * An in-memory bisect store and build farm — the bisect primitive's tests run on these (#617).
 *
 * {@link MemoryBisectStore} keeps `code_bisects` / `code_bisect_steps` the way V118 does — including
 * the step bound, which it refuses exactly as `code_bisect_steps_guard` does — and reads each
 * step's job from {@link MemoryFarm}, which stands in for `build_jobs` and `FarmJobsService`.
 * Several services may share one store: that is a restart.
 */

import type { BuildJobStatus } from "../../db/schema";
import { NotFoundError } from "../../errors/error.envelope";
import type { BuildJobRequest } from "../../farm/dispatch/jobs.dto";
import type {
  BisectEnding,
  BisectRow,
  CodeBisectRepository,
  NewBisect,
  StepRow,
} from "./code-bisect.repository";

/** One farm job. */
export interface MemoryJob {
  readonly id: string;
  readonly organizationId: string;
  readonly number: number;
  readonly request: BuildJobRequest;
  status: BuildJobStatus;
  retryOf: string | null;
}

/** The build farm, as the bisect sees it. */
export class MemoryFarm {
  readonly jobs = new Map<string, MemoryJob>();
  /** Pools the farm refuses with `farm_pool_not_found`. */
  readonly missingPools = new Set<string>();

  /**
   * `FarmJobsService.submit`.
   *
   * @param organizationId - The workspace.
   * @param _actor - Unused.
   * @param request - The job.
   * @returns It, queued.
   */
  async submit(
    organizationId: string,
    _actor: string | null,
    request: BuildJobRequest,
  ): Promise<{ id: string }> {
    if (this.missingPools.has(request.pool)) {
      throw new NotFoundError("farm_pool_not_found", `There is no pool named ${request.pool}.`);
    }
    return this.add(organizationId, request, null);
  }

  /**
   * `FarmJobsService.cancel`.
   *
   * @param _organizationId - The workspace.
   * @param jobId - The job.
   * @returns Nothing useful.
   */
  async cancel(_organizationId: string, jobId: string): Promise<unknown> {
    const job = this.job(jobId);
    job.status = "canceled";
    return {};
  }

  /**
   * Finish a job.
   *
   * @param jobId - The job.
   * @param status - How.
   */
  finish(jobId: string, status: BuildJobStatus): void {
    this.job(jobId).status = status;
  }

  /**
   * Lose a job's runner: the job is `retried` and dispatch queues its retry.
   *
   * @param jobId - The job.
   * @returns The retry.
   */
  retry(jobId: string): MemoryJob {
    const job = this.job(jobId);
    job.status = "retried";
    return this.add(job.organizationId, job.request, job.id);
  }

  /**
   * A job by id.
   *
   * @param jobId - The job.
   * @returns It.
   */
  job(jobId: string): MemoryJob {
    const job = this.jobs.get(jobId);
    if (job === undefined) throw new Error(`no job ${jobId}`);
    return job;
  }

  /** The jobs submitted, in order. */
  list(): MemoryJob[] {
    return [...this.jobs.values()];
  }

  private add(organizationId: string, request: BuildJobRequest, retryOf: string | null): MemoryJob {
    const number = this.jobs.size + 4400;
    const id = `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
    const job: MemoryJob = { id, organizationId, number, request, status: "queued", retryOf };
    this.jobs.set(id, job);
    return job;
  }
}

interface StoredStep {
  readonly step: number;
  readonly candidate: number;
  readonly commitSha: string;
  buildJobId: string;
  verdict: "good" | "bad" | null;
  decidedAt: Date | null;
}

/** `code_bisects` and `code_bisect_steps`, in memory. */
export class MemoryBisectStore implements Pick<
  CodeBisectRepository,
  | "insert"
  | "same"
  | "find"
  | "steps"
  | "running"
  | "bisectOfJob"
  | "retryOf"
  | "locked"
  | "addStep"
  | "followRetry"
  | "decide"
  | "finish"
> {
  readonly bisects = new Map<string, BisectRow>();
  readonly stepRows = new Map<string, StoredStep[]>();
  private sequence = 0;

  /** @param farm - Where each step's job lives. */
  constructor(private readonly farm: MemoryFarm) {}

  async insert(bisect: NewBisect): Promise<string> {
    this.sequence += 1;
    const id = `b1500000-0000-4000-8000-${String(this.sequence).padStart(12, "0")}`;
    this.bisects.set(id, {
      id,
      organizationId: bisect.organizationId,
      investigationId: bisect.investigationId,
      githubRepoId: bisect.githubRepoId,
      repository: bisect.repository,
      pool: bisect.pool,
      testRef: bisect.testRef,
      command: bisect.command,
      goodRef: bisect.goodRef,
      badRef: bisect.badRef,
      goodSha: bisect.goodSha,
      badSha: bisect.badSha,
      buildRef: bisect.buildRef,
      commits: bisect.commits,
      lo: 0,
      hi: bisect.commits.length - 1,
      maxSteps: bisect.maxSteps,
      status: "running",
      culpritSha: null,
      note: null,
      createdAt: new Date("2026-10-09T06:00:00Z"),
      finishedAt: null,
    });
    this.stepRows.set(id, []);
    return id;
  }

  async same(bisect: NewBisect): Promise<BisectRow | undefined> {
    return [...this.bisects.values()]
      .reverse()
      .find(
        (row) =>
          row.organizationId === bisect.organizationId &&
          row.githubRepoId === bisect.githubRepoId &&
          row.goodSha === bisect.goodSha &&
          row.badSha === bisect.badSha &&
          row.testRef === bisect.testRef &&
          row.pool === bisect.pool &&
          JSON.stringify(row.command) === JSON.stringify(bisect.command) &&
          (row.status === "running" || row.status === "converged"),
      );
  }

  async find(organizationId: string, id: string): Promise<BisectRow | undefined> {
    const row = this.bisects.get(id);
    return row?.organizationId === organizationId ? row : undefined;
  }

  async steps(id: string): Promise<StepRow[]> {
    return (this.stepRows.get(id) ?? []).map((step) => {
      const job = this.farm.job(step.buildJobId);
      return {
        step: step.step,
        candidate: step.candidate,
        commitSha: step.commitSha,
        buildJobId: step.buildJobId,
        jobNumber: job.number,
        jobStatus: job.status,
        verdict: step.verdict,
        decidedAt: step.decidedAt,
      };
    });
  }

  async running(limit: number): Promise<{ id: string; organizationId: string }[]> {
    return [...this.bisects.values()]
      .filter((row) => row.status === "running")
      .slice(0, limit)
      .map((row) => ({ id: row.id, organizationId: row.organizationId }));
  }

  async bisectOfJob(organizationId: string, jobId: string): Promise<string | undefined> {
    for (const [id, steps] of this.stepRows) {
      const row = this.bisects.get(id);
      if (
        row?.organizationId === organizationId &&
        steps.some((step) => step.buildJobId === jobId && step.verdict === null)
      ) {
        return id;
      }
    }
    return undefined;
  }

  async retryOf(organizationId: string, jobId: string): Promise<string | undefined> {
    return this.farm
      .list()
      .find((job) => job.organizationId === organizationId && job.retryOf === jobId)?.id;
  }

  async locked<T>(
    organizationId: string,
    id: string,
    work: (bisect: BisectRow, trx: never) => Promise<T>,
  ): Promise<T | undefined> {
    const row = await this.find(organizationId, id);
    return row === undefined ? undefined : work(row, undefined as never);
  }

  async addStep(
    _trx: unknown,
    bisect: BisectRow,
    step: number,
    candidate: number,
    jobId: string,
  ): Promise<void> {
    if (step > bisect.maxSteps) {
      throw new Error(
        `code_bisect_steps_bounded: step ${String(step)} > ${String(bisect.maxSteps)}`,
      );
    }
    this.stepRows.get(bisect.id)?.push({
      step,
      candidate,
      commitSha: bisect.commits[candidate],
      buildJobId: jobId,
      verdict: null,
      decidedAt: null,
    });
  }

  async followRetry(_trx: unknown, bisectId: string, step: number, jobId: string): Promise<void> {
    const row = this.stepRows.get(bisectId)?.find((candidate) => candidate.step === step);
    if (row !== undefined) row.buildJobId = jobId;
  }

  async decide(
    _trx: unknown,
    bisectId: string,
    step: number,
    verdict: "good" | "bad",
    window: { lo: number; hi: number } | null,
    at: Date,
  ): Promise<void> {
    const row = this.stepRows.get(bisectId)?.find((candidate) => candidate.step === step);
    if (row !== undefined) {
      row.verdict = verdict;
      row.decidedAt = at;
    }
    if (window !== null) this.update(bisectId, { lo: window.lo, hi: window.hi });
  }

  async finish(_trx: unknown, bisectId: string, ending: BisectEnding, at: Date): Promise<void> {
    this.update(bisectId, {
      status: ending.status,
      culpritSha: ending.culpritSha ?? null,
      note: ending.note ?? null,
      finishedAt: at,
    });
  }

  private update(id: string, patch: Partial<BisectRow>): void {
    const row = this.bisects.get(id);
    if (row !== undefined) this.bisects.set(id, { ...row, ...patch });
  }
}
