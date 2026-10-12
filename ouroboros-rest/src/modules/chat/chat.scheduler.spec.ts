import { SchedulerRegistry } from "@nestjs/schedule";

import type { ChatDispatcher } from "./chat.dispatcher";
import type { ChatPublisher } from "./chat.publisher";
import type { ChatRepository } from "./chat.repository";
import { CHAT_DISPATCH_TIMEOUT, CHAT_UPKEEP_TIMEOUT, ChatScheduler } from "./chat.scheduler";

/** The publisher's clock (#536): two named timers that survive a failed pass and stop on shutdown. */

function harness() {
  const tick = jest.fn().mockResolvedValue({});
  const digestPass = jest.fn().mockResolvedValue(0);
  const prune = jest.fn().mockResolvedValue(0);
  const registry = new SchedulerRegistry();
  const scheduler = new ChatScheduler(
    { tick } as unknown as ChatDispatcher,
    { digestPass } as unknown as ChatPublisher,
    { prune } as unknown as ChatRepository,
    registry,
  );

  return { scheduler, registry, tick, digestPass, prune };
}

describe("the chat scheduler", () => {
  it("registers both timers at bootstrap and clears them at shutdown", () => {
    const { scheduler, registry } = harness();

    scheduler.onApplicationBootstrap();
    expect(registry.doesExist("timeout", CHAT_DISPATCH_TIMEOUT)).toBe(true);
    expect(registry.doesExist("timeout", CHAT_UPKEEP_TIMEOUT)).toBe(true);

    scheduler.onApplicationShutdown();
    expect(registry.doesExist("timeout", CHAT_DISPATCH_TIMEOUT)).toBe(false);
    expect(registry.doesExist("timeout", CHAT_UPKEEP_TIMEOUT)).toBe(false);
  });

  it("dispatches, then schedules the next dispatch", async () => {
    const { scheduler, registry, tick } = harness();
    const now = new Date("2026-10-11T14:11:00.000Z");

    await scheduler.dispatch(now);

    expect(tick).toHaveBeenCalledWith(now);
    expect(registry.doesExist("timeout", CHAT_DISPATCH_TIMEOUT)).toBe(true);
    scheduler.onApplicationShutdown();
  });

  it("enqueues due digests and prunes on upkeep, then schedules the next", async () => {
    const { scheduler, registry, digestPass, prune } = harness();
    const now = new Date("2026-10-11T14:11:00.000Z");

    await scheduler.upkeep(now);

    expect(digestPass).toHaveBeenCalledWith(now);
    expect(prune).toHaveBeenCalledWith(now);
    expect(registry.doesExist("timeout", CHAT_UPKEEP_TIMEOUT)).toBe(true);
    scheduler.onApplicationShutdown();
  });

  it("loses a pass, not the loop, when a pass fails", async () => {
    const { scheduler, registry, tick, digestPass } = harness();
    tick.mockRejectedValueOnce(new Error("boom"));
    digestPass.mockRejectedValueOnce(new Error("boom"));

    await expect(scheduler.dispatch()).resolves.toBeUndefined();
    await expect(scheduler.upkeep()).resolves.toBeUndefined();

    expect(registry.doesExist("timeout", CHAT_DISPATCH_TIMEOUT)).toBe(true);
    expect(registry.doesExist("timeout", CHAT_UPKEEP_TIMEOUT)).toBe(true);
    scheduler.onApplicationShutdown();
  });

  it("schedules nothing once it has been stopped", async () => {
    const { scheduler, registry } = harness();

    scheduler.onApplicationShutdown();
    await scheduler.dispatch();
    await scheduler.upkeep();

    expect(registry.doesExist("timeout", CHAT_DISPATCH_TIMEOUT)).toBe(false);
    expect(registry.doesExist("timeout", CHAT_UPKEEP_TIMEOUT)).toBe(false);
  });
});
