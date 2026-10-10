import { Logger } from "@nestjs/common";

import { RoadmapScheduler } from "./roadmap.scheduler";

const SUMMARY = { checked: 2, drifted: 1, raised: 1 };

describe("the roadmap pipeline's clock", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("runs a pass and answers what it did", async () => {
    const pass = jest.fn().mockResolvedValue(SUMMARY);

    expect(await new RoadmapScheduler({ pass }, 60_000).tick()).toEqual(SUMMARY);
  });

  it("does not start a second pass while one is running", async () => {
    let finish: (value: typeof SUMMARY) => void = () => undefined;
    const pass = jest.fn(
      () =>
        new Promise<typeof SUMMARY>((resolve) => {
          finish = resolve;
        }),
    );
    const scheduler = new RoadmapScheduler({ pass }, 60_000);
    const first = scheduler.tick();
    const second = scheduler.tick();

    finish(SUMMARY);

    expect(await first).toEqual(SUMMARY);
    expect(await second).toEqual(SUMMARY);
    expect(pass).toHaveBeenCalledTimes(1);

    const third = scheduler.tick();

    finish(SUMMARY);
    await third;

    expect(pass).toHaveBeenCalledTimes(2);
  });

  it("answers zeros and logs when a pass cannot run", async () => {
    const pass = jest.fn().mockRejectedValue(new Error("no database"));

    expect(await new RoadmapScheduler({ pass }, 60_000).tick()).toEqual({
      checked: 0,
      drifted: 0,
      raised: 0,
    });
    expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
  });

  it("books jittered passes from bootstrap until shutdown", async () => {
    const pass = jest.fn().mockResolvedValue(SUMMARY);
    const scheduler = new RoadmapScheduler({ pass }, 60_000, () => 0.5);

    scheduler.onApplicationBootstrap();
    expect(pass).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(120_000);
    const afterTwoMinutes = pass.mock.calls.length;

    expect(afterTwoMinutes).toBeGreaterThanOrEqual(1);

    scheduler.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(600_000);

    expect(pass.mock.calls.length).toBe(afterTwoMinutes);
  });

  it("books nothing when the tick is zero", async () => {
    const pass = jest.fn().mockResolvedValue(SUMMARY);
    const scheduler = new RoadmapScheduler({ pass }, 0);

    scheduler.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(3_600_000);

    expect(pass).not.toHaveBeenCalled();
    scheduler.onApplicationShutdown();
  });
});
