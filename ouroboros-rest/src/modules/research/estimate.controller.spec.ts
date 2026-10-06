import { HttpStatus, RequestMethod } from "@nestjs/common";
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";

import type { Organization } from "../db/schema";
import { ResearchEstimateController } from "./estimate.controller";
import type { ResearchEstimateService } from "./estimate.service";
import type { ScopeEstimateResource } from "./resources";

/** The controller hands the session's workspace and the body to the service, and nothing else. */

const TENANT = { id: "org-acme" } as Organization;

describe("the research estimate controller", () => {
  it("is POST /research/estimates, answering 200 — a read, nothing is created", () => {
    const handler = Object.getOwnPropertyDescriptor(
      ResearchEstimateController.prototype,
      "estimate",
    )!.value as object;

    expect(Reflect.getMetadata(PATH_METADATA, ResearchEstimateController)).toBe("research");
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe("estimates");
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(HttpStatus.OK);
  });

  it("estimates for the session's workspace", async () => {
    const answer = { label: "est. 40–60 sources · ~$6" } as ScopeEstimateResource;
    const estimate = jest.fn().mockResolvedValue(answer);
    const controller = new ResearchEstimateController({
      estimate,
    } as unknown as ResearchEstimateService);
    const body = { kind: "gap_analysis", depth: "deep_dive" as const, tools: ["web"] };

    expect(await controller.estimate(TENANT, body)).toBe(answer);
    expect(estimate).toHaveBeenCalledWith("org-acme", body);
  });
});
