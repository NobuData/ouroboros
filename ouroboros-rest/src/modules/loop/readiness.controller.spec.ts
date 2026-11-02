import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import type { Organization } from "../db/schema";
import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import type { LoopReadinessResource } from "./readiness";
import { LoopReadinessController } from "./readiness.controller";
import { LoopReadinessQuery } from "./readiness.dto";
import type { ReadinessService } from "./readiness.service";

const ANSWER = { ready: false } as LoopReadinessResource;

/**
 * The fields a query fails on.
 *
 * @param query - The raw query.
 * @returns The failing properties.
 */
function invalid(query: Record<string, unknown>): string[] {
  return validateSync(plainToInstance(LoopReadinessQuery, query)).map((error) => error.property);
}

describe("LoopReadinessController (DK.1, #1318)", () => {
  it("serves GET /loop/readiness", () => {
    expect(Reflect.getMetadata(PATH_METADATA, LoopReadinessController)).toBe("loop/readiness");
    expect(Reflect.getMetadata(METHOD_METADATA, LoopReadinessController.prototype.read)).toBe(
      RequestMethod.GET,
    );
  });

  it("is open to any member — no role is required", () => {
    expect(
      Reflect.getMetadata(REQUIRED_ROLES, LoopReadinessController.prototype.read),
    ).toBeUndefined();
    expect(Reflect.getMetadata(REQUIRED_ROLES, LoopReadinessController)).toBeUndefined();
  });

  it("reads the preflight for the session's workspace", async () => {
    const read = jest.fn().mockResolvedValue(ANSWER);
    const controller = new LoopReadinessController({ read } as unknown as ReadinessService);
    const query = plainToInstance(LoopReadinessQuery, {
      repository: "acme/helios",
      workflow: "live-slice",
    });

    await expect(controller.read({ id: "org-a" } as Organization, query)).resolves.toBe(ANSWER);
    expect(read).toHaveBeenCalledWith("org-a", query);
  });
});

describe("LoopReadinessQuery", () => {
  it("accepts owner/name, a workflow slug and an optional issue number", () => {
    expect(invalid({ repository: "acme/helios", workflow: "live-slice" })).toEqual([]);
    expect(
      invalid({ repository: "Acme-1/helios.fw", workflow: "live-slice", issue: "12" }),
    ).toEqual([]);
    expect(plainToInstance(LoopReadinessQuery, { issue: "12" }).issue).toBe(12);
  });

  it("refuses anything else", () => {
    expect(invalid({ workflow: "live-slice" })).toEqual(["repository"]);
    expect(invalid({ repository: "acme", workflow: "live-slice" })).toEqual(["repository"]);
    expect(invalid({ repository: "acme/helios/x", workflow: "live-slice" })).toEqual([
      "repository",
    ]);
    expect(invalid({ repository: "../helios", workflow: "live-slice" })).toEqual(["repository"]);
    expect(invalid({ repository: "acme/..", workflow: "live-slice" })).toEqual(["repository"]);
    expect(invalid({ repository: "acme/helios" })).toEqual(["workflow"]);
    expect(invalid({ repository: "acme/helios", workflow: "Live Slice" })).toEqual(["workflow"]);
    expect(invalid({ repository: "acme/helios", workflow: "live-slice", issue: "0" })).toEqual([
      "issue",
    ]);
    expect(invalid({ repository: "acme/helios", workflow: "live-slice", issue: "x" })).toEqual([
      "issue",
    ]);
  });
});
