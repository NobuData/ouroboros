/**
 * What makes the measurement job periodic (BV.6, [#515](https://github.com/NobuData/ouroboros/issues/515)).
 *
 * The shape of `analysis.scheduler.ts`: a self-rescheduling timeout rather than `@Interval`, a pass
 * that never overlaps itself, a failed pass that costs a tick rather than the loop.
 *
 * **Hourly, though the job is daily in spirit.** A window closes on the first pass after its last
 * day is both over and rolled up, and the rollup consolidates yesterday on its own hourly tick, so
 * an hourly pass closes each window within the hour its data is final. A pass touches only pending
 * rows and is idempotent, so the extra ticks cost a query each.
 */

import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import { describeForLog } from "../../errors/failure";
import { ANALYSIS_CLOCK } from "../analysis.orchestrator";
import { MeasurementService } from "./measurement.service";

/** How the timer names itself in `SchedulerRegistry`. */
export const MEASUREMENT_TIMEOUT = "analyzer-measurement-tick";

/** One hour. */
export const MEASUREMENT_TICK_MS = 3_600_000;

@Injectable()
export class MeasurementScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MeasurementScheduler.name);

  /** Set once the application is shutting down. */
  private stopped = false;

  /** The pass in flight, so a second caller joins it rather than starting another. */
  private pass?: Promise<void>;

  /**
   * @param job - One pass.
   * @param scheduler - Nest's registry.
   * @param clock - The current instant; `Date.now` unless a suite binds one.
   */
  constructor(
    private readonly job: MeasurementService,
    private readonly scheduler: SchedulerRegistry,
    @Optional() @Inject(ANALYSIS_CLOCK) private readonly clock: () => number = Date.now,
  ) {}

  /** Book the first tick once the application is up. */
  onApplicationBootstrap(): void {
    this.schedule();
  }

  /** Stop the loop and clear a pending timer. */
  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.scheduler.doesExist("timeout", MEASUREMENT_TIMEOUT)) {
      this.scheduler.deleteTimeout(MEASUREMENT_TIMEOUT);
    }
  }

  /**
   * Run one pass and book the next. A call made while a pass is running joins it.
   *
   * @returns When the pass has settled.
   */
  async tick(): Promise<void> {
    if (this.pass !== undefined) {
      await this.pass;
      return;
    }
    this.pass = this.run();
    try {
      await this.pass;
    } finally {
      this.pass = undefined;
    }
  }

  /**
   * One pass. Never rejects.
   *
   * @returns When settled and the next tick is booked.
   */
  private async run(): Promise<void> {
    if (this.scheduler.doesExist("timeout", MEASUREMENT_TIMEOUT)) {
      this.scheduler.deleteTimeout(MEASUREMENT_TIMEOUT);
    }
    try {
      const result = await this.job.pass(new Date(this.clock()));
      for (const closed of result.closed) {
        this.logger.log(`Measurement ${closed.id} closed ${closed.verdict}.`);
      }
    } catch (error) {
      this.logger.error(
        "The measurement pass could not run; retrying next tick.",
        describeForLog(error),
      );
    }
    this.schedule();
  }

  /** Book the next tick, unless the application is stopping. */
  private schedule(): void {
    if (this.stopped) return;
    const timer = setTimeout(() => void this.tick(), MEASUREMENT_TICK_MS);
    timer.unref();
    this.scheduler.addTimeout(MEASUREMENT_TIMEOUT, timer);
  }
}
