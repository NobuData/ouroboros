import { SchedulerRegistry } from "@nestjs/schedule";

import { CHANNELS_TIMEOUT, ChannelsScheduler } from "./channels.scheduler";
import type { DecisionMailService } from "./mail/decision-mail.service";
import type { DecisionMirrorService, MirrorSyncOutcome } from "./mirror/mirror.service";

describe("ChannelsScheduler (#463)", () => {
  let registry: SchedulerRegistry;
  let sweeps: number;
  let passes: number;
  let failSweep: boolean;
  let scheduler: ChannelsScheduler;

  beforeEach(() => {
    registry = new SchedulerRegistry();
    sweeps = 0;
    passes = 0;
    failSweep = false;

    const mirror = {
      sweep: () => {
        sweeps += 1;

        return failSweep
          ? Promise.reject(new Error("database down"))
          : Promise.resolve(new Map<string, MirrorSyncOutcome>([["item", "failed"]]));
      },
    } as unknown as DecisionMirrorService;
    const mail = {
      pass: () => {
        passes += 1;

        return Promise.resolve({ instantSent: 0, digestSent: 1, failed: 1 });
      },
    } as unknown as DecisionMailService;

    scheduler = new ChannelsScheduler(mirror, mail, registry);
  });

  afterEach(() => {
    scheduler.onApplicationShutdown();
  });

  it("books a tick at boot and clears it at shutdown", () => {
    scheduler.onApplicationBootstrap();
    expect(registry.doesExist("timeout", CHANNELS_TIMEOUT)).toBe(true);

    scheduler.onApplicationShutdown();
    expect(registry.doesExist("timeout", CHANNELS_TIMEOUT)).toBe(false);
  });

  it("runs the mirror sweep and the mail pass, then books the next tick", async () => {
    await scheduler.tick();

    expect([sweeps, passes]).toEqual([1, 1]);
    expect(registry.doesExist("timeout", CHANNELS_TIMEOUT)).toBe(true);
  });

  it("still sends mail when the mirror sweep fails, and keeps the loop", async () => {
    failSweep = true;

    await scheduler.tick();

    expect(passes).toBe(1);
    expect(registry.doesExist("timeout", CHANNELS_TIMEOUT)).toBe(true);
  });

  it("joins a pass already running instead of starting another", async () => {
    await Promise.all([scheduler.tick(), scheduler.tick()]);

    expect(sweeps).toBe(1);
  });

  it("books nothing once shutting down", async () => {
    scheduler.onApplicationShutdown();
    await scheduler.tick();

    expect(registry.doesExist("timeout", CHANNELS_TIMEOUT)).toBe(false);
  });
});
