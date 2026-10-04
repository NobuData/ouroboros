import { Logger } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import type { AppConfigService } from "../config/config.service";
import { JITTER_SPREAD } from "../scheduling/cadence";
import type { WebhookDispatcher } from "./webhook.dispatcher";
import { WEBHOOK_DISPATCH_TIMEOUT, WebhookDispatchScheduler } from "./webhook.scheduler";

const CONFIG = { webhookDispatchSeconds: 5 } as AppConfigService;

describe("the webhook dispatch loop (#487)", () => {
  let registry: SchedulerRegistry;

  beforeEach(() => {
    jest.useFakeTimers();
    registry = new SchedulerRegistry();
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /** A scheduler over a dispatcher stand-in. */
  function loop(tick: jest.Mock) {
    return new WebhookDispatchScheduler({ tick } as unknown as WebhookDispatcher, CONFIG, registry);
  }

  it("books its first tick a jittered interval after bootstrap", () => {
    const tick = jest.fn().mockResolvedValue({ fannedOut: 0, queued: 0, sent: 0 });
    const scheduler = loop(tick);

    scheduler.onApplicationBootstrap();

    expect(tick).not.toHaveBeenCalled();
    jest.advanceTimersByTime(5000 * (1 + JITTER_SPREAD));
    expect(tick).toHaveBeenCalledTimes(1);
    scheduler.onApplicationShutdown();
  });

  it("hands the dispatcher the instant it is judged at", async () => {
    const tick = jest.fn().mockResolvedValue({ fannedOut: 0, queued: 0, sent: 0 });
    const at = new Date("2026-10-04T12:00:00Z");

    await loop(tick).tick(at);

    expect(tick).toHaveBeenCalledWith(at);
  });

  it("keeps the loop alive when a tick fails", async () => {
    const scheduler = loop(jest.fn().mockRejectedValue(new Error("down")));

    await scheduler.tick();

    expect(registry.doesExist("timeout", WEBHOOK_DISPATCH_TIMEOUT)).toBe(true);
    scheduler.onApplicationShutdown();
    expect(registry.doesExist("timeout", WEBHOOK_DISPATCH_TIMEOUT)).toBe(false);
  });

  it("books nothing after shutdown", async () => {
    const scheduler = loop(jest.fn().mockResolvedValue({}));

    scheduler.onApplicationShutdown();
    await scheduler.tick();

    expect(registry.doesExist("timeout", WEBHOOK_DISPATCH_TIMEOUT)).toBe(false);
  });
});
