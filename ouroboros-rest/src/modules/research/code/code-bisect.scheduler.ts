/**
 * What keeps bisects moving: every farm completion, and a resume tick (CL.4,
 * [#617](https://github.com/NobuData/ouroboros/issues/617)).
 *
 * A completion (`JobCompletions`, #252) settles the bisect whose open step that job decides —
 * the fast path. The tick, every `OURO_RESEARCH_BISECT_TICK_MS` (jittered; `0` off; never at
 * boot), settles every running bisect — the path that survives a restart: a step whose job
 * finished while this process was down is decided, and a bisect with no step in flight gets its
 * next one, from its stored checkpoint.
 */

import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";

import { describeForLog } from "../../errors/failure";
import type { JobCompletions } from "../../farm/dispatch/job.completions";
import { jittered } from "../../scheduling/cadence";
import type { CodeBisectService } from "./code-bisect.service";

export class CodeBisectScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CodeBisectScheduler.name);
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;
  private pass: Promise<number> | undefined;
  private unsubscribe: (() => void) | undefined;

  /**
   * @param bisects - The primitive.
   * @param completions - Farm job completions.
   * @param tickMs - Milliseconds between resume passes; `0` is off.
   * @param random - The jitter's source.
   */
  constructor(
    private readonly bisects: CodeBisectService,
    private readonly completions: JobCompletions,
    private readonly tickMs: number,
    private readonly random?: () => number,
  ) {}

  /** Listen for completions, and book the first resume pass — a jittered tick away. */
  onApplicationBootstrap(): void {
    this.unsubscribe = this.completions.subscribe((event) =>
      this.bisects.onCompletion(event).catch((error: unknown) => {
        this.logger.error(
          `A bisect step decided by job ${event.jobId} could not be settled; the resume tick will.`,
          describeForLog(error),
        );
      }),
    );
    this.book();
  }

  /** Stop listening and ticking. */
  onApplicationShutdown(): void {
    this.stopped = true;
    this.unsubscribe?.();
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /**
   * One resume pass. A pass called while one runs joins it.
   *
   * @returns How many running bisects were looked at.
   */
  async tick(): Promise<number> {
    if (this.pass !== undefined) return this.pass;
    this.pass = this.bisects.resume().catch((error: unknown) => {
      this.logger.error(
        "Running bisects could not be read; trying again next tick.",
        describeForLog(error),
      );
      return 0;
    });
    try {
      return await this.pass;
    } finally {
      this.pass = undefined;
    }
  }

  private book(): void {
    if (this.stopped || this.tickMs <= 0) return;
    this.timer = setTimeout(
      () => {
        void this.tick().finally(() => {
          this.book();
        });
      },
      jittered(this.tickMs, this.random),
    );
    this.timer.unref();
  }
}
