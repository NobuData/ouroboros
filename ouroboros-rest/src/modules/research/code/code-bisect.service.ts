/**
 * The bisect primitive — `bisect(good, bad, test_ref)` over build-farm jobs, checkpointed (CL.4,
 * [#617](https://github.com/NobuData/ouroboros/issues/617)).
 *
 * ```
 * start(good=v2.0.4, bad=nightly, test=hil:hover_drift)
 *   ─▶ engine: the first-parent line good..bad, n candidates, bound ⌊log₂ n⌋+1
 *   ─▶ code_bisects row (checkpoint lo..hi = the whole line) ─▶ advance
 * advance ─▶ farm job (AH.4) at the window's middle ─▶ code_bisect_steps row
 * job completes (JobCompletions) or the resume tick finds it done
 *   ─▶ settle: succeeded = good, failed = bad ─▶ narrow lo..hi ─▶ advance … ─▶ converged: culprit
 * ```
 *
 * **One primitive, two callers.** The research `code` tool starts and reads bisects as an
 * operation; the regression watch (#623) calls {@link CodeBisectService.start} for a drift. Both
 * get the same rows — and asking the same question again (same repository, commits, test, pool
 * and command) returns the bisect already running or converged rather than starting another.
 *
 * **Checkpointed.** Every move happens holding the bisect's row: a step's verdict and the narrowed
 * window are written in one transaction, and a step's job is recorded before anything waits on it.
 * After a restart the resume tick settles whatever finished meanwhile and dispatches the next step
 * — the bisect continues from its window; nothing already built is built again.
 *
 * **Honest endings.** `converged` names the culprit; `inconclusive` says the only candidate built
 * good; `failed` says which step's job was canceled or which farm refusal stopped it; `canceled` is
 * a person's (or the watch's) decision. A step past the bound is never taken (the database refuses
 * it too, V118).
 */

import { Injectable, Logger } from "@nestjs/common";
import type { Transaction } from "kysely";

import type { Database } from "../../db/schema";

import { bisectCommitsSchema } from "../../engine/engine.code.contract";
import { DomainError } from "../../errors/error.envelope";
import { describeForLog } from "../../errors/failure";
import { FarmJobsService } from "../../farm/dispatch/jobs.service";
import type { JobCompleted } from "../../farm/dispatch/job.completions";
import {
  type BisectEnding,
  type BisectRow,
  CodeBisectRepository,
  type NewBisect,
  type StepRow,
} from "./code-bisect.repository";
import { applyVerdict, maxSteps, nextMove } from "./code-bisect.search";
import { CodeReader, CodeRefusal } from "./code.reader";

/** The most running bisects one resume pass settles. */
export const RESUME_BATCH = 50;

/** What starting a bisect takes. */
export interface StartBisect {
  readonly organizationId: string;
  /** `owner/name`, or a bare name only one enabled repository has. */
  readonly repository: string;
  /** A ref known good — `v2.0.4`. */
  readonly good: string;
  /** A ref known bad — `nightly`. */
  readonly bad: string;
  /** What a step tests, as the caller names it — `hil:hover_drift`. */
  readonly testRef: string;
  /** The farm pool every step builds in. */
  readonly pool: string;
  /** The argv each step runs; omitted for the pool's default. Success marks the commit good. */
  readonly command?: readonly string[] | null;
  /** The investigation asking, when one is. */
  readonly investigationId?: string | null;
  /** The person asking; null for the watch. */
  readonly createdBy?: string | null;
}

/** A bisect and its steps. */
export interface BisectView {
  readonly bisect: BisectRow;
  readonly steps: readonly StepRow[];
}

@Injectable()
export class CodeBisectService {
  private readonly logger = new Logger(CodeBisectService.name);

  /**
   * @param repository - The bisect rows.
   * @param reader - The engine's clones, for the candidate line.
   * @param farm - Build-farm dispatch (AH.4).
   */
  constructor(
    private readonly repository: CodeBisectRepository,
    private readonly reader: CodeReader,
    private readonly farm: FarmJobsService,
  ) {}

  /** The clock — a field, so a spec can pin it. */
  now: () => Date = () => new Date();

  /**
   * Start a bisect — or answer the one already asking the same question.
   *
   * @param request - The repository, the refs, the test and where to build.
   * @returns The bisect, its first step dispatched (or its ending, if the farm refused it).
   * @throws {CodeRefusal} A repository the workspace has not enabled, a ref that names nothing, a
   *   good commit that is not on bad's first-parent line, or an engine that could not be reached.
   */
  async start(request: StartBisect): Promise<BisectView> {
    const testRef = request.testRef.trim();
    if (testRef === "" || testRef.length > 200) {
      throw new CodeRefusal(
        "unsupported",
        'name the test a step runs — {testRef: "hil:hover_drift"}',
      );
    }
    const pool = request.pool.trim();
    if (pool === "") throw new CodeRefusal("unsupported", "name the farm pool the steps build in");

    const repo = await this.reader.repository(request.organizationId, request.repository);
    const line = await this.reader.read(
      request.organizationId,
      repo,
      "bisect-commits",
      { good: request.good, bad: request.bad },
      bisectCommitsSchema,
    );

    const bisect: NewBisect = {
      organizationId: request.organizationId,
      investigationId: request.investigationId ?? null,
      githubRepoId: repo.id,
      repository: repo.slug,
      pool,
      testRef,
      command: request.command ?? null,
      goodRef: request.good,
      badRef: request.bad,
      goodSha: line.goodSha,
      badSha: line.badSha,
      buildRef: line.badRefName ?? `refs/heads/${repo.defaultBranch ?? "main"}`,
      commits: line.commits,
      maxSteps: maxSteps(line.commits.length),
      createdBy: request.createdBy ?? null,
    };

    const existing = await this.repository.same(bisect);
    if (existing !== undefined) return this.view(existing);

    const id = await this.repository.insert(bisect);
    await this.settle(request.organizationId, id);
    return this.require(request.organizationId, id);
  }

  /**
   * A bisect and its steps.
   *
   * @param organizationId - The workspace.
   * @param id - The bisect.
   * @returns It, or `undefined` for one the workspace does not have.
   */
  async get(organizationId: string, id: string): Promise<BisectView | undefined> {
    const bisect = await this.repository.find(organizationId, id);
    return bisect === undefined ? undefined : this.view(bisect);
  }

  /**
   * Stop a bisect, and the farm job of its open step.
   *
   * @param organizationId - The workspace.
   * @param id - The bisect.
   * @returns It, `canceled` — or as it was, when it had already ended; `undefined` when the
   *   workspace has no such bisect.
   */
  async cancel(organizationId: string, id: string): Promise<BisectView | undefined> {
    const open = await this.repository.locked(organizationId, id, async (bisect, trx) => {
      if (bisect.status !== "running") return null;
      const steps = await this.repository.steps(id, trx);
      await this.repository.finish(
        trx,
        id,
        { status: "canceled", note: "the bisect was canceled before it converged" },
        this.now(),
      );
      return steps.find((step) => step.verdict === null) ?? null;
    });
    if (open === undefined) return undefined;

    if (open !== null) {
      try {
        await this.farm.cancel(organizationId, open.buildJobId);
      } catch (error) {
        // A job that finished meanwhile cannot be canceled, and need not be.
        if (!(error instanceof DomainError)) throw error;
      }
    }
    return this.get(organizationId, id);
  }

  /**
   * A farm job finished — if it decides a bisect's step, settle that bisect.
   *
   * @param event - The completion.
   */
  async onCompletion(event: JobCompleted): Promise<void> {
    const bisectId = await this.repository.bisectOfJob(event.organizationId, event.jobId);
    if (bisectId !== undefined) await this.settle(event.organizationId, bisectId);
  }

  /**
   * The resume pass: settle every running bisect — a step whose job finished while nobody listened
   * (a restart, a lost event) is decided, and a bisect with no step in flight gets its next one.
   *
   * @returns How many bisects were looked at.
   */
  async resume(): Promise<number> {
    const running = await this.repository.running(RESUME_BATCH);
    for (const { id, organizationId } of running) {
      try {
        await this.settle(organizationId, id);
      } catch (error) {
        this.logger.error(
          `Bisect ${id} could not be resumed; trying again next tick.`,
          describeForLog(error),
        );
      }
    }
    return running.length;
  }

  /**
   * Decide what can be decided, then take the next step — holding the bisect's row.
   *
   * @param organizationId - The workspace.
   * @param id - The bisect.
   */
  async settle(organizationId: string, id: string): Promise<void> {
    await this.repository.locked(organizationId, id, async (initial, trx) => {
      if (initial.status !== "running") return;
      let bisect = initial;
      const steps = await this.repository.steps(id, trx);
      const open = steps.find((step) => step.verdict === null);

      if (open !== undefined) {
        const at = this.now();
        switch (open.jobStatus) {
          case "queued":
          case "offered":
          case "running":
            return; // still building
          case "retried": {
            const retry = await this.repository.retryOf(organizationId, open.buildJobId, trx);
            if (retry !== undefined) await this.repository.followRetry(trx, id, open.step, retry);
            return; // the retry decides it
          }
          case "canceled":
            await this.repository.finish(
              trx,
              id,
              {
                status: "failed",
                note: `step ${String(open.step)}'s farm job #${String(open.jobNumber)} was canceled before it decided ${open.commitSha.slice(0, 7)}`,
              },
              at,
            );
            return;
          case "succeeded":
          case "failed": {
            const verdict = open.jobStatus === "succeeded" ? "good" : "bad";
            const applied = applyVerdict(bisect, open.candidate, verdict);
            if (applied.kind === "inconclusive") {
              await this.repository.decide(trx, id, open.step, verdict, null, at);
              await this.repository.finish(
                trx,
                id,
                {
                  status: "inconclusive",
                  note: `the only candidate, ${open.commitSha.slice(0, 7)}, built good — the regression did not reproduce at the bad commit`,
                },
                at,
              );
              return;
            }
            await this.repository.decide(trx, id, open.step, verdict, applied, at);
            bisect = { ...bisect, lo: applied.lo, hi: applied.hi };
            steps.splice(steps.indexOf(open), 1, { ...open, verdict, decidedAt: at });
            break;
          }
        }
      }

      const move = nextMove({
        lo: bisect.lo,
        hi: bisect.hi,
        steps: steps.length,
        maxSteps: bisect.maxSteps,
      });
      if (move.kind === "converged") {
        await this.repository.finish(
          trx,
          id,
          { status: "converged", culpritSha: bisect.commits[move.culprit] },
          this.now(),
        );
        return;
      }
      if (move.kind === "exhausted") {
        await this.repository.finish(
          trx,
          id,
          { status: "failed", note: "the step bound was spent before the window closed" },
          this.now(),
        );
        return;
      }

      const step = steps.length + 1;
      const ending = await this.dispatch(trx, bisect, step, move.candidate);
      if (ending !== null) await this.repository.finish(trx, id, ending, this.now());
    });
  }

  /**
   * Submit one step's farm job and record it.
   *
   * @param trx - The lock's transaction.
   * @param bisect - The bisect.
   * @param step - The step's number.
   * @param candidate - What it builds.
   * @returns `null` once recorded; the ending when the farm refused the job.
   */
  private async dispatch(
    trx: Transaction<Database>,
    bisect: BisectRow,
    step: number,
    candidate: number,
  ): Promise<BisectEnding | null> {
    const commit = bisect.commits[candidate];
    let jobId: string;
    try {
      const job = await this.farm.submit(bisect.organizationId, null, {
        pool: bisect.pool,
        repository: bisect.repository,
        ref: bisect.buildRef,
        commit,
        ...(bisect.command === null ? {} : { command: bisect.command }),
        label: "bisect",
        title: `bisect ${bisect.testRef} · step ${String(step)}/${String(bisect.maxSteps)} · ${commit.slice(0, 7)}`,
      });
      jobId = job.id;
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      return {
        status: "failed",
        note: `the farm refused step ${String(step)}: ${error.message}`.slice(0, 500),
      };
    }
    await this.repository.addStep(trx, bisect, step, candidate, jobId);
    return null;
  }

  private async view(bisect: BisectRow): Promise<BisectView> {
    return { bisect, steps: await this.repository.steps(bisect.id) };
  }

  private async require(organizationId: string, id: string): Promise<BisectView> {
    const view = await this.get(organizationId, id);
    if (view === undefined) throw new Error(`bisect ${id} vanished after it was written`);
    return view;
  }
}
