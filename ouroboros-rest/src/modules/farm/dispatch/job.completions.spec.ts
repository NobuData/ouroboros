import { Logger } from "@nestjs/common";

import { drain } from "../gateway/gateway.fixture";
import { JOB, ORG } from "./dispatch.fixture";
import { JobCompletions, type JobCompleted } from "./job.completions";

/**
 * #510's seam (#252): a completion is announced to every subscriber, off the completing path, and
 * a subscriber that fails never affects the completion.
 */
describe("job completions", () => {
  const event: JobCompleted = { organizationId: ORG, jobId: JOB, status: "succeeded" };
  let completions: JobCompletions;
  let logged: jest.SpyInstance;

  beforeEach(() => {
    completions = new JobCompletions();
    logged = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logged.mockRestore();
  });

  it("tells every subscriber, after the caller has moved on", async () => {
    const heard: JobCompleted[] = [];
    completions.subscribe((e) => {
      heard.push(e);
    });
    completions.subscribe((e) => {
      heard.push({ ...e, status: "retried" });
    });

    completions.emit(event);
    expect(heard).toEqual([]);

    await drain();
    expect(heard).toEqual([event, { ...event, status: "retried" }]);
  });

  it("returns at once even when a subscriber never settles — the hook is non-blocking", () => {
    completions.subscribe(() => new Promise<void>(() => undefined));

    expect(() => completions.emit(event)).not.toThrow();
  });

  it("logs a subscriber that throws or rejects, and still tells the others", async () => {
    const heard: string[] = [];
    completions.subscribe(() => {
      throw new Error("the analyzer's counter is down");
    });
    completions.subscribe(() => Promise.reject(new Error("and so is its queue")));
    completions.subscribe((e) => {
      heard.push(e.jobId);
    });

    expect(() => completions.emit(event)).not.toThrow();
    await drain();

    expect(heard).toEqual([JOB]);
    expect(logged).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("the job is unaffected"),
      expect.anything(),
    );
  });

  it("stops telling a subscriber that unsubscribed", async () => {
    const heard: string[] = [];
    const stop = completions.subscribe((e) => {
      heard.push(e.jobId);
    });

    stop();
    completions.emit(event);
    await drain();

    expect(heard).toEqual([]);
  });
});
