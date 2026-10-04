/**
 * When the webhook dispatcher runs: every `OURO_WEBHOOK_DISPATCH_SECONDS` (five by default),
 * jittered ±25% like every loop here (BR.3, [#487](https://github.com/NobuData/ouroboros/issues/487)).
 *
 * The `LifecyclePurgeScheduler` shape: a self-rescheduling, `unref()`'d timeout in Nest's
 * `SchedulerRegistry`, started on bootstrap and cleared on shutdown, with a public `tick()` a test
 * drives without waiting. A tick never overlaps itself: the next is booked only when this one has
 * settled.
 */

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import { AppConfigService } from "../config/config.service";
import { describeForLog } from "../errors/failure";
import { jittered } from "../scheduling/cadence";
import { WebhookDispatcher } from "./webhook.dispatcher";

/** The timeout's name in the registry. */
export const WEBHOOK_DISPATCH_TIMEOUT = "webhook-dispatch";

@Injectable()
export class WebhookDispatchScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  /** Where a tick's failure is reported. */
  private readonly logger = new Logger(WebhookDispatchScheduler.name);

  /** Set once the application is shutting down, so a tick in flight books no further one. */
  private stopped = false;

  /**
   * @param dispatcher - What a tick does. This class owns only *when*.
   * @param config - The cadence.
   * @param scheduler - Nest's registry.
   */
  constructor(
    private readonly dispatcher: WebhookDispatcher,
    private readonly config: AppConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  /** Start the loop once the application is up. */
  onApplicationBootstrap(): void {
    this.schedule(this.interval());
  }

  /** Stop the loop, and clear a pending timer. */
  onApplicationShutdown(): void {
    this.stopped = true;

    if (this.scheduler.doesExist("timeout", WEBHOOK_DISPATCH_TIMEOUT)) {
      this.scheduler.deleteTimeout(WEBHOOK_DISPATCH_TIMEOUT);
    }
  }

  /**
   * Run one dispatch and schedule the next, whatever the first did.
   *
   * @param now - The instant to judge against; the current time by default.
   * @returns When the tick has settled and the next is booked.
   */
  async tick(now: Date = new Date()): Promise<void> {
    if (this.scheduler.doesExist("timeout", WEBHOOK_DISPATCH_TIMEOUT)) {
      this.scheduler.deleteTimeout(WEBHOOK_DISPATCH_TIMEOUT);
    }

    try {
      await this.dispatcher.tick(now);
    } catch (error) {
      // A tick is lost, not the loop: undispatched events and due attempts are still there.
      this.logger.error("Webhook dispatch failed; retrying next tick.", describeForLog(error));
    }

    this.schedule(this.interval());
  }

  /**
   * The nominal delay, jittered.
   *
   * @returns Milliseconds.
   */
  private interval(): number {
    return jittered(this.config.webhookDispatchSeconds * 1000);
  }

  /**
   * Book the next tick, unless the application is going away.
   *
   * @param delayMs - How long to wait.
   */
  private schedule(delayMs: number): void {
    if (this.stopped) {
      return;
    }

    const timer = setTimeout(() => {
      void this.tick();
    }, delayMs);

    timer.unref();

    this.scheduler.addTimeout(WEBHOOK_DISPATCH_TIMEOUT, timer);
  }
}
