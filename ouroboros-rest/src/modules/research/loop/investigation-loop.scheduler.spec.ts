/** The resume pass's clock (#620): booked a jittered tick away, never at boot, off at zero. */

import { Logger } from "@nestjs/common";

import type { InvestigationDispatchService } from "./investigation-dispatch.service";
import { InvestigationLoopScheduler } from "./investigation-loop.scheduler";

function scheduler(resume: () => Promise<number>, tickMs: number) {
  return new InvestigationLoopScheduler(
    { resume } as unknown as InvestigationDispatchService,
    tickMs,
    () => 0.5,
  );
}

describe("the investigation resume scheduler", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("runs a pass every tick, and not at boot", async () => {
    const resume = jest.fn(() => Promise.resolve(0));
    const booked = scheduler(resume, 60_000);

    booked.onApplicationBootstrap();
    expect(resume).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(60_000);
    expect(resume).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(resume).toHaveBeenCalledTimes(2);

    booked.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(180_000);
    expect(resume).toHaveBeenCalledTimes(2);
  });

  it("books nothing when the tick is zero", async () => {
    const resume = jest.fn(() => Promise.resolve(0));
    scheduler(resume, 0).onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(3_600_000);
    expect(resume).not.toHaveBeenCalled();
  });

  it("joins a pass that is already running", async () => {
    let finish: (value: number) => void = () => undefined;
    const resume = jest.fn(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    );
    const booked = scheduler(resume, 60_000);

    const first = booked.tick();
    const second = booked.tick();
    finish(3);

    expect(await Promise.all([first, second])).toEqual([3, 3]);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("survives a pass that fails, and ticks again", async () => {
    const resume = jest
      .fn<Promise<number>, []>()
      .mockRejectedValueOnce(new Error("the database went away"))
      .mockResolvedValue(1);
    const booked = scheduler(resume, 60_000);
    booked.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(60_000);
    expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(resume).toHaveBeenCalledTimes(2);
    booked.onApplicationShutdown();
  });
});
