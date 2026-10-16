import { HttpStatus, RequestMethod } from "@nestjs/common";
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";

import { ALLOW_ANONYMOUS } from "../auth/anonymous";
import { INTERNAL_ONLY } from "../internal/internal.decorators";
import {
  INTERNAL_PATHS,
  INTERNAL_RUN_PULL_REQUEST_PATH,
  RUNS_PATH,
  isInternalPath,
} from "../internal/internal.paths";
import { RunPullRequestController } from "./run-pull-request.controller";
import type { RunPullRequestService } from "./run-pull-request.service";

/** The draft pull-request publisher's route (DI.3, #1311): thin, behind the internal key. */

const RUN = "5eed0051-0000-4000-8000-000000000001";

describe("the run pull-request controller", () => {
  it("hands the request through to the service", async () => {
    const opened = {
      pull_request_id: "pr-1",
      number: 2,
      url: "https://github.com/acme-robotics/helios-greeter/pull/2",
      draft: true as const,
      created: true,
    };
    const open = jest.fn(() => Promise.resolve(opened));
    const controller = new RunPullRequestController({ open } as unknown as RunPullRequestService);
    const body = { idempotency_key: "k", epoch: 1 };

    await expect(controller.open({ id: RUN }, body)).resolves.toEqual(opened);
    expect(open).toHaveBeenCalledWith(RUN, body);
  });

  it("is behind the internal key, and outside the session guard", () => {
    expect(Reflect.getMetadata(INTERNAL_ONLY, RunPullRequestController)).toBe(true);
    expect(Reflect.getMetadata(ALLOW_ANONYMOUS, RunPullRequestController)).toBe(true);
  });

  it("serves POST /internal/runs/:id/pull-request with a 200", () => {
    const handler = RunPullRequestController.prototype.open;
    const base = Reflect.getMetadata(PATH_METADATA, RunPullRequestController) as string;
    const segment = Reflect.getMetadata(PATH_METADATA, handler) as string;

    expect(base).toBe(RUNS_PATH);
    expect(`/${base}/${segment}`).toBe(INTERNAL_RUN_PULL_REQUEST_PATH);
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(HttpStatus.OK);
    expect(INTERNAL_PATHS).toContain(INTERNAL_RUN_PULL_REQUEST_PATH);
    expect(isInternalPath(INTERNAL_RUN_PULL_REQUEST_PATH)).toBe(true);
  });
});
