import { SchedulerRegistry } from "@nestjs/schedule";

import type { ChatDispatcher } from "./chat.dispatcher";
import type { ChatEscalation } from "./chat.escalation";
import type { ChatPublisher } from "./chat.publisher";
import type { ChatRepository } from "./chat.repository";
import { CHAT_DISPATCH_TIMEOUT, CHAT_UPKEEP_TIMEOUT, ChatScheduler } from "./chat.scheduler";

/**
 * The publisher's clock (#536): two named timers that survive a failed pass and stop on shutdown.
 * Since #538 the dispatch pass fires the due escalation timers first.
 */

function harness() {
  // What ran, in order.
  const order: string[] = [];
  const tick = jest.fn((_now: Date) => {
    order.push("dispatch");

    return Promise.resolve({});
  });
  const pass = jest.fn((_now: Date) => {
    order.push("escalation");

    return Promise.resolve({ escalated: 0, cardEdits: 0, directMessages: 0 });
  });
  const digestPass = jest.fn().mockResolvedValue(0);
  const prune = jest.fn().mockResolvedValue(0);
  const registry = new SchedulerRegistry();
  const scheduler = new ChatScheduler(
    { tick } as unknown as ChatDispatcher,
    { pass } as unknown as ChatEscalation,
    { digestPass } as unknown as ChatPublisher,
    { prune } as unknown as ChatRepository,
    registry,
  );

  return { scheduler, registry, tick, pass, digestPass, prune, order };
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

  it("fires the due escalation timers before it dispatches, at the same instant (#538)", async () => {
    const { scheduler, tick, pass, order } = harness();
    const now = new Date("2026-10-11T14:37:00.000Z");

    await scheduler.dispatch(now);

    // Before, so what an escalation intends goes out in the same pass.
    expect(order).toEqual(["escalation", "dispatch"]);
    expect(pass).toHaveBeenCalledWith(now);
    expect(tick).toHaveBeenCalledWith(now);
    scheduler.onApplicationShutdown();
  });

  it("still dispatches when the escalation pass fails", async () => {
    const { scheduler, registry, tick, pass } = harness();
    pass.mockRejectedValueOnce(new Error("boom"));

    await expect(scheduler.dispatch()).resolves.toBeUndefined();

    expect(tick).toHaveBeenCalledTimes(1);
    expect(registry.doesExist("timeout", CHAT_DISPATCH_TIMEOUT)).toBe(true);
    scheduler.onApplicationShutdown();
  });

  it("still escalates on the next pass when a dispatch failed", async () => {
    const { scheduler, registry, tick, pass } = harness();
    tick.mockRejectedValueOnce(new Error("boom"));

    await expect(scheduler.dispatch()).resolves.toBeUndefined();
    await expect(scheduler.dispatch()).resolves.toBeUndefined();

    expect(pass).toHaveBeenCalledTimes(2);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(registry.doesExist("timeout", CHAT_DISPATCH_TIMEOUT)).toBe(true);
    scheduler.onApplicationShutdown();
  });

  it("loses neither loop when both halves of a pass fail", async () => {
    const { scheduler, registry, tick, pass } = harness();
    pass.mockRejectedValueOnce(new Error("boom"));
    tick.mockRejectedValueOnce(new Error("boom"));

    await expect(scheduler.dispatch()).resolves.toBeUndefined();

    expect(registry.doesExist("timeout", CHAT_DISPATCH_TIMEOUT)).toBe(true);
    scheduler.onApplicationShutdown();
  });

  it("leaves the escalation timers to the dispatch pass — upkeep fires none", async () => {
    const { scheduler, pass } = harness();

    await scheduler.upkeep(new Date("2026-10-11T14:37:00.000Z"));

    expect(pass).not.toHaveBeenCalled();
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
