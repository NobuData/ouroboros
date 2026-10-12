/**
 * The chat publisher's clock (BZ.2, [#536](https://github.com/NobuData/ouroboros/issues/536)).
 *
 * Two self-rescheduling timers, in the house style (`webhooks/webhook.scheduler.ts`): never
 * `setInterval`, so a slow pass cannot overlap the next; `unref`ed, so neither holds the process
 * open; registered by name, so shutdown can clear them.
 *
 * ```
 * chat-dispatch   every ~5 s    send what is due
 * chat-upkeep     every ~60 s   enqueue due weekly digests · prune settled rows
 * ```
 *
 * Both are safe on every replica at once: the dispatcher's claim skips locked rows, and a digest
 * slot is intended once per target whoever notices it.
 */

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import { describeForLog } from "../errors/failure";
import { jittered } from "../scheduling/cadence";
import { ChatDispatcher } from "./chat.dispatcher";
import { ChatPublisher } from "./chat.publisher";
import { ChatRepository } from "./chat.repository";

/** The timers' names in the scheduler registry. */
export const CHAT_DISPATCH_TIMEOUT = "chat-dispatch";
export const CHAT_UPKEEP_TIMEOUT = "chat-upkeep";

/** How often each runs, before jitter. */
export const CHAT_DISPATCH_MS = 5000;
export const CHAT_UPKEEP_MS = 60_000;

@Injectable()
export class ChatScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ChatScheduler.name);

  /** Set at shutdown, so a pass that is finishing does not schedule another. */
  private stopped = false;

  /**
   * @param dispatcher - Sends what is due.
   * @param publisher - Enqueues due digests.
   * @param repository - Prunes settled rows.
   * @param scheduler - Holds the timers.
   */
  constructor(
    private readonly dispatcher: ChatDispatcher,
    private readonly publisher: ChatPublisher,
    private readonly repository: ChatRepository,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  /** Start both timers. */
  onApplicationBootstrap(): void {
    this.schedule(CHAT_DISPATCH_TIMEOUT, CHAT_DISPATCH_MS, () => this.dispatch());
    this.schedule(CHAT_UPKEEP_TIMEOUT, CHAT_UPKEEP_MS, () => this.upkeep());
  }

  /** Stop both. */
  onApplicationShutdown(): void {
    this.stopped = true;

    for (const name of [CHAT_DISPATCH_TIMEOUT, CHAT_UPKEEP_TIMEOUT]) {
      this.clear(name);
    }
  }

  /**
   * One dispatch pass, then the next is scheduled. Never throws.
   *
   * @param now - The instant of the pass.
   */
  async dispatch(now: Date = new Date()): Promise<void> {
    this.clear(CHAT_DISPATCH_TIMEOUT);

    try {
      await this.dispatcher.tick(now);
    } catch (error) {
      // A tick is lost, not the outbox: what was due is still due.
      this.logger.error("Chat dispatch failed; retrying next tick.", describeForLog(error));
    }

    this.schedule(CHAT_DISPATCH_TIMEOUT, CHAT_DISPATCH_MS, () => this.dispatch());
  }

  /**
   * One upkeep pass, then the next is scheduled. Never throws.
   *
   * @param now - The instant of the pass.
   */
  async upkeep(now: Date = new Date()): Promise<void> {
    this.clear(CHAT_UPKEEP_TIMEOUT);

    try {
      await this.publisher.digestPass(now);
      await this.repository.prune(now);
    } catch (error) {
      this.logger.error("Chat upkeep failed; retrying next pass.", describeForLog(error));
    }

    this.schedule(CHAT_UPKEEP_TIMEOUT, CHAT_UPKEEP_MS, () => this.upkeep());
  }

  /**
   * Remove a timer, if it is registered.
   *
   * @param name - The timer.
   */
  private clear(name: string): void {
    if (this.scheduler.doesExist("timeout", name)) {
      this.scheduler.deleteTimeout(name);
    }
  }

  /**
   * Register the next run of a pass.
   *
   * @param name - The timer.
   * @param baseMs - Its cadence, before jitter.
   * @param run - The pass.
   */
  private schedule(name: string, baseMs: number, run: () => Promise<void>): void {
    if (this.stopped) {
      return;
    }

    const timer = setTimeout(() => {
      void run();
    }, jittered(baseMs));

    timer.unref();
    this.scheduler.addTimeout(name, timer);
  }
}
