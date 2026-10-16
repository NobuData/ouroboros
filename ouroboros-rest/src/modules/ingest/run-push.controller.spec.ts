import { HttpStatus, RequestMethod } from "@nestjs/common";
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";

import { ALLOW_ANONYMOUS } from "../auth/anonymous";
import { INTERNAL_ONLY } from "../internal/internal.decorators";
import {
  INTERNAL_PATHS,
  INTERNAL_RUN_PUSH_PATH,
  INTERNAL_RUN_PUSH_RESULT_PATH,
  RUNS_PATH,
  isInternalPath,
} from "../internal/internal.paths";
import { RunPushController } from "./run-push.controller";
import type { RunPushService } from "./run-push.service";

/** The branch publisher's two routes (DI.2, #1310): thin, behind the internal key. */

const RUN = "5eed0051-0000-4000-8000-000000000001";
const prototype = RunPushController.prototype;

describe("the run-push controller", () => {
  it.each([
    ["push", "grant", { branch: "ouro/run-1-1" }],
    ["result", "recordResult", { branch: "ouro/run-1-1", outcome: "pushed" }],
  ] as const)("hands %s through to the service", async (route, method, body) => {
    const handled = jest.fn(() => Promise.resolve({ ok: true }));
    const controller = new RunPushController({ [method]: handled } as unknown as RunPushService);

    const answer = await (
      controller[route] as (params: { id: string }, request: unknown) => Promise<unknown>
    )({ id: RUN }, body);

    expect(answer).toEqual({ ok: true });
    expect(handled).toHaveBeenCalledWith(RUN, body);
  });

  it("is behind the internal key, and outside the session guard", () => {
    expect(Reflect.getMetadata(INTERNAL_ONLY, RunPushController)).toBe(true);
    expect(Reflect.getMetadata(ALLOW_ANONYMOUS, RunPushController)).toBe(true);
  });

  it.each([
    ["push", INTERNAL_RUN_PUSH_PATH],
    ["result", INTERNAL_RUN_PUSH_RESULT_PATH],
  ] as const)("serves %s at its internal path with a 200", (route, path) => {
    const base = Reflect.getMetadata(PATH_METADATA, RunPushController) as string;
    const segment = Reflect.getMetadata(PATH_METADATA, prototype[route]) as string;

    expect(base).toBe(RUNS_PATH);
    expect(`/${base}/${segment}`).toBe(path);
    expect(Reflect.getMetadata(METHOD_METADATA, prototype[route])).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, prototype[route])).toBe(HttpStatus.OK);
    expect(INTERNAL_PATHS).toContain(path);
    expect(isInternalPath(path)).toBe(true);
  });
});
