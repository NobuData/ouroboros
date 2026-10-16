import { HttpStatus, RequestMethod } from "@nestjs/common";
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";

import { ALLOW_ANONYMOUS } from "../auth/anonymous";
import { INTERNAL_ONLY } from "../internal/internal.decorators";
import {
  INTERNAL_PATHS,
  INTERNAL_RUN_CHECKPOINT_PATH,
  INTERNAL_RUN_FINISH_PATH,
  INTERNAL_RUN_HEARTBEAT_PATH,
  INTERNAL_RUN_START_PATH,
  RUNS_PATH,
  isInternalPath,
} from "../internal/internal.paths";
import { RunExecutionController } from "./run-execution.controller";
import type { RunExecutionService } from "./run-execution.service";

/**
 * The execution bridge's routes (#160), which are thin: each hands its request through and
 * carries the decorators the boundary depends on.
 */

const RUN = "5eed0009-0000-4000-8000-000000000482";
const prototype = RunExecutionController.prototype;

describe("the run-execution controller", () => {
  it.each([
    ["start", { worker: "engine-worker-a" }],
    ["heartbeat", { epoch: 1 }],
    ["checkpoint", { epoch: 1, state: {} }],
    ["finish", { epoch: 1, idempotency_key: "k", outcome: "failed", reason: "x" }],
  ] as const)("hands %s through to the service", async (route, body) => {
    const handled = jest.fn(() => Promise.resolve({ ok: true }));
    const controller = new RunExecutionController({
      [route]: handled,
    } as unknown as RunExecutionService);

    const answer = await (
      controller[route] as (params: { id: string }, request: unknown) => Promise<unknown>
    )({ id: RUN }, body);

    expect(answer).toEqual({ ok: true });
    expect(handled).toHaveBeenCalledWith(RUN, body);
  });

  it("is behind the internal key, and outside the session guard", () => {
    expect(Reflect.getMetadata(INTERNAL_ONLY, RunExecutionController)).toBe(true);
    expect(Reflect.getMetadata(ALLOW_ANONYMOUS, RunExecutionController)).toBe(true);
  });

  it.each([
    ["start", RequestMethod.POST, INTERNAL_RUN_START_PATH],
    ["heartbeat", RequestMethod.POST, INTERNAL_RUN_HEARTBEAT_PATH],
    ["checkpoint", RequestMethod.PUT, INTERNAL_RUN_CHECKPOINT_PATH],
    ["finish", RequestMethod.POST, INTERNAL_RUN_FINISH_PATH],
  ] as const)("serves %s at its internal path with a 200", (route, method, path) => {
    const base = Reflect.getMetadata(PATH_METADATA, RunExecutionController) as string;
    const segment = Reflect.getMetadata(PATH_METADATA, prototype[route]) as string;

    expect(base).toBe(RUNS_PATH);
    expect(`/${base}/${segment}`).toBe(path);
    expect(Reflect.getMetadata(METHOD_METADATA, prototype[route])).toBe(method);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, prototype[route])).toBe(HttpStatus.OK);
    expect(INTERNAL_PATHS).toContain(path);
    expect(isInternalPath(path)).toBe(true);
  });
});
