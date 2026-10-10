import { HttpStatus, RequestMethod } from "@nestjs/common";
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";

import { ALLOW_ANONYMOUS } from "../auth/anonymous";
import { INTERNAL_ONLY } from "../internal/internal.decorators";
import {
  DRY_RUNS_PATH,
  INTERNAL_DRY_RUN_REPLAY_ESTIMATES_PATH,
  INTERNAL_PATHS,
  isInternalPath,
} from "../internal/internal.paths";
import { ReplayEstimatesInternalController } from "./replay.internal.controller";
import type { ReplayEstimateService } from "./replay.service";

const DRY_RUN = "5eed008b-0000-4000-8000-000000000001";
const prototype = ReplayEstimatesInternalController.prototype;

describe("the replay estimates' internal controller", () => {
  it("hands the dry run and the stage through to the service, and its answer back", async () => {
    const answer = { estimate: { status: "estimate" }, stage: { how: "replayed" } };
    const estimate = jest.fn(() => Promise.resolve(answer));
    const controller = new ReplayEstimatesInternalController({
      estimate,
    } as unknown as ReplayEstimateService);
    const body = { kind: "build" as const, runnerPool: "pool-a" };

    expect(await controller.estimate(DRY_RUN, body)).toBe(answer);
    expect(estimate).toHaveBeenCalledTimes(1);
    expect(estimate).toHaveBeenCalledWith(DRY_RUN, body);
  });

  it("is behind the internal key, and outside the session guard", () => {
    expect(Reflect.getMetadata(INTERNAL_ONLY, ReplayEstimatesInternalController)).toBe(true);
    expect(Reflect.getMetadata(ALLOW_ANONYMOUS, ReplayEstimatesInternalController)).toBe(true);
  });

  it("serves the estimate at its internal path, as a 200", () => {
    const base = Reflect.getMetadata(PATH_METADATA, ReplayEstimatesInternalController) as string;
    const segment = Reflect.getMetadata(PATH_METADATA, prototype.estimate) as string;

    expect(base).toBe(DRY_RUNS_PATH);
    expect(`/${base}/${segment}`).toBe(INTERNAL_DRY_RUN_REPLAY_ESTIMATES_PATH);
    expect(INTERNAL_DRY_RUN_REPLAY_ESTIMATES_PATH).toBe("/internal/dry-runs/:id/replay-estimates");
    expect(Reflect.getMetadata(METHOD_METADATA, prototype.estimate)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, prototype.estimate)).toBe(HttpStatus.OK);
    expect(INTERNAL_PATHS).toContain(INTERNAL_DRY_RUN_REPLAY_ESTIMATES_PATH);
    expect(isInternalPath(INTERNAL_DRY_RUN_REPLAY_ESTIMATES_PATH)).toBe(true);
  });
});
