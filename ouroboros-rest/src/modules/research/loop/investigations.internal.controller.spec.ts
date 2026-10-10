import { HttpStatus, RequestMethod } from "@nestjs/common";
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";

import { ALLOW_ANONYMOUS } from "../../auth/anonymous";
import { INTERNAL_ONLY } from "../../internal/internal.decorators";
import {
  INTERNAL_INVESTIGATION_BRIEF_PATH,
  INTERNAL_INVESTIGATION_CHECKPOINT_PATH,
  INTERNAL_INVESTIGATION_FINISH_PATH,
  INTERNAL_INVESTIGATION_START_PATH,
  INTERNAL_PATHS,
  RESEARCH_INVESTIGATIONS_PATH,
  isInternalPath,
} from "../../internal/internal.paths";
import type { InvestigationLoopService } from "./investigation-loop.service";
import { InvestigationsInternalController } from "./investigations.internal.controller";

/**
 * The routes, which are thin: each hands its request through and carries the decorators the
 * boundary depends on. A missing `@InternalOnly()` would let anyone write a brief into any
 * workspace; a missing `@AllowAnonymous()` would have the session guard refuse the engine
 * before its key is ever checked.
 */

const INVESTIGATION = "5eed0091-0000-4000-8000-000000000127";
const prototype = InvestigationsInternalController.prototype;

describe("the investigation loop's internal controller", () => {
  it.each([
    ["start", { loopVersion: "loop-v1" }],
    ["checkpoint", { attempt: 1, seq: 1 }],
    ["brief", { attempt: 1, claims: [] }],
    ["finish", { attempt: 1, outcome: "cancelled" }],
  ] as const)("hands %s through to the service", async (route, body) => {
    const handler = route === "brief" ? "deliver" : route;
    const handled = jest.fn(() => Promise.resolve({ ok: true }));
    const controller = new InvestigationsInternalController({
      [handler]: handled,
    } as unknown as InvestigationLoopService);

    const answer = await (controller[route] as (id: string, request: unknown) => Promise<unknown>)(
      INVESTIGATION,
      body,
    );

    expect(answer).toEqual({ ok: true });
    expect(handled).toHaveBeenCalledWith(INVESTIGATION, body);
  });

  it("is behind the internal key, and outside the session guard", () => {
    expect(Reflect.getMetadata(INTERNAL_ONLY, InvestigationsInternalController)).toBe(true);
    expect(Reflect.getMetadata(ALLOW_ANONYMOUS, InvestigationsInternalController)).toBe(true);
  });

  it.each([
    ["start", RequestMethod.POST, INTERNAL_INVESTIGATION_START_PATH, HttpStatus.OK],
    ["checkpoint", RequestMethod.PUT, INTERNAL_INVESTIGATION_CHECKPOINT_PATH, undefined],
    ["brief", RequestMethod.POST, INTERNAL_INVESTIGATION_BRIEF_PATH, HttpStatus.OK],
    ["finish", RequestMethod.POST, INTERNAL_INVESTIGATION_FINISH_PATH, HttpStatus.OK],
  ] as const)("serves %s at its internal path", (route, method, path, status) => {
    const base = Reflect.getMetadata(PATH_METADATA, InvestigationsInternalController) as string;
    const segment = Reflect.getMetadata(PATH_METADATA, prototype[route]) as string;

    expect(base).toBe(RESEARCH_INVESTIGATIONS_PATH);
    expect(`/${base}/${segment}`).toBe(path);
    expect(Reflect.getMetadata(METHOD_METADATA, prototype[route])).toBe(method);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, prototype[route])).toBe(status);
    expect(INTERNAL_PATHS).toContain(path);
    expect(isInternalPath(path)).toBe(true);
  });
});
