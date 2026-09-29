/** The detection routes ([#384](https://github.com/NobuData/ouroboros/issues/384)). */

import { HttpStatus } from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import type { Organization } from "../db/schema";
import { CONTRIBUTORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { DetectionController } from "./detection.controller";
import type { DetectionService } from "./detection.service";

const WORKSPACE = { id: "org-1" } as Organization;
const QUERY = { repo: "acme-robotics/helios-firmware" };
const RESOURCE = { repo: QUERY.repo };

describe("the detection controller", () => {
  let service: jest.Mocked<DetectionService>;
  let controller: DetectionController;

  beforeEach(() => {
    service = {
      read: jest.fn().mockResolvedValue(RESOURCE),
      readScan: jest.fn().mockResolvedValue(RESOURCE),
      start: jest.fn().mockResolvedValue({ joined: false }),
    } as unknown as jest.Mocked<DetectionService>;

    controller = new DetectionController(service);
  });

  it("scopes every route to the workspace and the repository", async () => {
    await controller.read(WORKSPACE, QUERY);
    await controller.readScan(WORKSPACE, { scanSeq: 2 }, QUERY);
    await controller.scan(WORKSPACE, QUERY);

    expect(service.read).toHaveBeenCalledWith("org-1", QUERY.repo);
    expect(service.readScan).toHaveBeenCalledWith("org-1", QUERY.repo, 2);
    expect(service.start).toHaveBeenCalledWith("org-1", QUERY.repo);
  });

  it("asks contributors to scan, and lets any member read", () => {
    const reflector = new Reflector();

    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.scan)).toEqual([...CONTRIBUTORS]);
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.read)).toBeUndefined();
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.readScan)).toBeUndefined();
  });

  it("answers a scan 202 — it runs in the background", () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.scan)).toBe(HttpStatus.ACCEPTED);
  });
});
