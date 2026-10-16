import { HttpStatus, RequestMethod } from "@nestjs/common";
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";

import { ALLOW_ANONYMOUS } from "../auth/anonymous";
import { INTERNAL_ONLY } from "../internal/internal.decorators";
import {
  INTERNAL_PATHS,
  INTERNAL_RUN_BUILD_CANCEL_PATH,
  INTERNAL_RUN_BUILD_PATH,
  INTERNAL_RUN_BUILDS_PATH,
  RUNS_PATH,
  isInternalPath,
} from "../internal/internal.paths";
import { RunBuildsController } from "./run-builds.controller";
import type { RunBuildsService } from "./run-builds.service";

/** A run's build routes (AJ.3, #265): thin, behind the internal key. */

const RUN = "5eed0009-0000-4000-8000-000000000482";
const JOB = "5eed0028-0000-4000-8000-000000000483";
const prototype = RunBuildsController.prototype;

describe("the run-builds controller", () => {
  it("hands a submission through to the service", async () => {
    const submit = jest.fn(() => Promise.resolve({ ok: true }));
    const controller = new RunBuildsController({ submit } as unknown as RunBuildsService);
    const body = { stageKey: "build", attempt: 1 };

    expect(await controller.submit({ id: RUN }, body as never)).toEqual({ ok: true });
    expect(submit).toHaveBeenCalledWith(RUN, body);
  });

  it("hands a read through with the run and the job", async () => {
    const read = jest.fn(() => Promise.resolve({ ok: true }));
    const controller = new RunBuildsController({ read } as unknown as RunBuildsService);

    expect(await controller.read({ id: RUN, jobId: JOB })).toEqual({ ok: true });
    expect(read).toHaveBeenCalledWith(RUN, JOB);
  });

  it("hands a cancellation through with the run, the job and the body", async () => {
    const cancel = jest.fn(() => Promise.resolve({ ok: true }));
    const controller = new RunBuildsController({ cancel } as unknown as RunBuildsService);
    const body = { idempotencyKey: "k", reason: "grace window" };

    expect(await controller.cancel({ id: RUN, jobId: JOB }, body)).toEqual({ ok: true });
    expect(cancel).toHaveBeenCalledWith(RUN, JOB, body);
  });

  it("is behind the internal key, and outside the session guard", () => {
    expect(Reflect.getMetadata(INTERNAL_ONLY, RunBuildsController)).toBe(true);
    expect(Reflect.getMetadata(ALLOW_ANONYMOUS, RunBuildsController)).toBe(true);
  });

  it.each([
    ["submit", INTERNAL_RUN_BUILDS_PATH, RequestMethod.POST],
    ["read", INTERNAL_RUN_BUILD_PATH, RequestMethod.GET],
    ["cancel", INTERNAL_RUN_BUILD_CANCEL_PATH, RequestMethod.POST],
  ] as const)("serves %s at its internal path", (route, path, method) => {
    const base = Reflect.getMetadata(PATH_METADATA, RunBuildsController) as string;
    const segment = Reflect.getMetadata(PATH_METADATA, prototype[route]) as string;

    expect(base).toBe(RUNS_PATH);
    expect(`/${base}/${segment}`).toBe(path);
    expect(Reflect.getMetadata(METHOD_METADATA, prototype[route])).toBe(method);
    expect(INTERNAL_PATHS).toContain(path);
    expect(isInternalPath(path)).toBe(true);
  });

  it.each(["submit", "cancel"] as const)("answers %s with a 200, not a 201", (route) => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, prototype[route])).toBe(HttpStatus.OK);
  });
});
