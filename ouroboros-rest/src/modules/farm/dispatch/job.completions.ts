/**
 * Job completion, announced — the seam #510's build counter subscribes to.
 *
 * AH.4 ([#252](https://github.com/NobuData/ouroboros/issues/252)), amended for BV.1
 * ([#510](https://github.com/NobuData/ouroboros/issues/510)). The Build Analyzer's *"every 50
 * builds"* trigger is a counter incremented when a build job completes. The counter is #510's;
 * what this ticket owes it is the moment of completion, and one rule about it: **the hook is cheap
 * and non-blocking, and a failing subscriber never affects the completion itself.**
 *
 * So {@link JobCompletions.emit} is called *after* the completing transaction has committed, it
 * returns before any subscriber has run, and a subscriber that throws or rejects is logged and
 * forgotten. A build is finished whether or not anybody was listening.
 *
 * A completion is every move into a terminal status, from wherever it came:
 *
 * ```
 * job.finish applied (gateway)  ─┐
 * runner lost → retried|failed  ─┼─▶ emit({organizationId, jobId, status}) ─▶ subscribers, later
 * cancel (API)                  ─┘
 * ```
 *
 * A duplicate `job.finish` — a re-send the ledger recognised — is not a completion, and is not
 * emitted: the ledger's `applied` is what says a frame finished a build.
 */

import { Injectable, Logger } from "@nestjs/common";

import type { BuildJobStatus } from "../../db/schema";
import { describeForLog } from "../../errors/failure";

/** One build job reaching a terminal status. */
export interface JobCompleted {
  readonly organizationId: string;
  readonly jobId: string;
  /** `succeeded`, `failed`, `retried` or `canceled`. */
  readonly status: Extract<BuildJobStatus, "succeeded" | "failed" | "retried" | "canceled">;
}

/** A subscriber. Its result is not awaited by the completion that called it. */
export type CompletionListener = (event: JobCompleted) => void | Promise<void>;

@Injectable()
export class JobCompletions {
  private readonly logger = new Logger(JobCompletions.name);
  private readonly listeners = new Set<CompletionListener>();

  /**
   * Hear about every completion from now on.
   *
   * @param listener - Called once per completion, off the completing path.
   * @returns A function that stops listening.
   */
  subscribe(listener: CompletionListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Announce a completion. Returns at once: every subscriber runs on a later microtask, and one
   * that throws or rejects is logged rather than propagated.
   *
   * @param event - The completion, already committed.
   */
  emit(event: JobCompleted): void {
    for (const listener of this.listeners) {
      void Promise.resolve()
        .then(() => listener(event))
        .catch((error: unknown) => {
          this.logger.error(
            `A job-completion listener failed for job ${event.jobId}; the job is unaffected.`,
            describeForLog(error),
          );
        });
    }
  }
}
