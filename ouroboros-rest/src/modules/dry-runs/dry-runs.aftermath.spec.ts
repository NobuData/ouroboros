import { Logger } from "@nestjs/common";

import type { DryRun } from "../db/schema";
import { DryRunAftermath } from "./dry-runs.aftermath";
import type { DryRunSuggestionsService } from "./suggestions.service";

const RUN = { id: "r-1", status: "complete" } as DryRun;

describe("what follows a dry run's end", () => {
  function bench() {
    const suggestions = { file: jest.fn().mockResolvedValue([]) };
    const aftermath = new DryRunAftermath(suggestions as unknown as DryRunSuggestionsService);
    return { suggestions, aftermath };
  }

  it("files the rule pack's suggestions, and waits for them", async () => {
    const { suggestions, aftermath } = bench();

    await aftermath.ended(RUN);

    expect(suggestions.file).toHaveBeenCalledWith(RUN);
  });

  it("tells every registered debriefer without waiting for any of them", async () => {
    const { aftermath } = bench();
    let release: () => void = () => undefined;
    const heard: string[] = [];
    aftermath.register(async (run) => {
      await new Promise<void>((resolve) => (release = resolve));
      heard.push(`slow:${run.id}`);
    });
    aftermath.register((run) => {
      heard.push(`fast:${run.id}`);
      return Promise.resolve();
    });

    aftermath.debrief(RUN);
    expect(heard).toEqual(["fast:r-1"]);

    release();
    await aftermath.settled();
    expect(heard).toEqual(["fast:r-1", "slow:r-1"]);
  });

  it("logs a debriefer that fails and carries on — the run is already recorded", async () => {
    const logged = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const { aftermath } = bench();
    const second = jest.fn().mockResolvedValue(undefined);
    aftermath.register(() => Promise.reject(new Error("gateway unavailable")));
    aftermath.register(second);

    aftermath.debrief(RUN);
    await aftermath.settled();

    expect(second).toHaveBeenCalledWith(RUN);
    expect(logged).toHaveBeenCalledWith("dry run r-1 could not be debriefed", expect.anything());
    logged.mockRestore();
  });

  it("lets the debriefs in flight finish at shutdown, and has nothing to do with nobody registered", async () => {
    const { aftermath } = bench();
    aftermath.debrief(RUN);
    await aftermath.onModuleDestroy();

    const done = jest.fn();
    aftermath.register(async () => {
      await Promise.resolve();
      done();
    });
    aftermath.debrief(RUN);
    await aftermath.onModuleDestroy();

    expect(done).toHaveBeenCalledTimes(1);
  });
});
