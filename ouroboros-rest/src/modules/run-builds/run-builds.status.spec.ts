import { Logger } from "@nestjs/common";

import { JobCompletions } from "../farm/dispatch/job.completions";
import type { RunBuildsRepository } from "./run-builds.repository";
import { RunBuildStatus } from "./run-builds.status";

/** The run's `building` status follows its build's completion (AJ.3, #265). */

describe("a run's building status", () => {
  let completions: JobCompletions;
  let released: jest.Mock;
  let status: RunBuildStatus;

  beforeEach(() => {
    completions = new JobCompletions();
    released = jest.fn().mockResolvedValue(true);
    status = new RunBuildStatus(completions, { released } as unknown as RunBuildsRepository);
    status.onModuleInit();
  });

  afterEach(() => {
    status.onModuleDestroy();
  });

  it.each(["succeeded", "failed", "retried", "canceled"] as const)(
    "releases the run that held a job that %s",
    async (outcome) => {
      await status.completed({ organizationId: "org", jobId: "job", status: outcome });

      expect(released).toHaveBeenCalledWith("org", "job", outcome);
    },
  );

  it("hears completions announced on the farm's seam", async () => {
    completions.emit({ organizationId: "org", jobId: "job", status: "succeeded" });
    await new Promise((resolve) => setImmediate(resolve));

    expect(released).toHaveBeenCalledWith("org", "job", "succeeded");
  });

  it("logs a failure to release and never throws into the completion", async () => {
    const error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    released.mockRejectedValue(new Error("database unavailable"));

    await expect(
      status.completed({ organizationId: "org", jobId: "job", status: "failed" }),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("database unavailable"));
    error.mockRestore();
  });

  it("stops listening when the module is torn down", async () => {
    status.onModuleDestroy();
    completions.emit({ organizationId: "org", jobId: "job", status: "succeeded" });
    await new Promise((resolve) => setImmediate(resolve));

    expect(released).not.toHaveBeenCalled();
  });
});
