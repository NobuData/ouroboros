import { HttpStatus } from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import type { Principal } from "../../auth/principal";
import type { Organization } from "../../db/schema";
import { CONTRIBUTORS, REQUIRED_ROLES } from "../../tenancy/roles.guard";
import { COMMIT, JOB, ORG, jobView } from "./dispatch.fixture";
import { FarmJobsController } from "./jobs.controller";
import { buildJobResource } from "./jobs.resources";
import type { FarmJobsService } from "./jobs.service";

/** The two job routes (#252): who may call them, and that the workspace is the session's. */
describe("the build job routes", () => {
  const TENANT = { id: ORG } as Organization;
  const PRINCIPAL = { user: { id: "user_ken" } } as Principal;
  const reflector = new Reflector();

  function subject(): { controller: FarmJobsController; jobs: jest.Mocked<FarmJobsService> } {
    const jobs = {
      submit: jest.fn().mockResolvedValue(buildJobResource(jobView())),
      cancel: jest.fn().mockResolvedValue(buildJobResource(jobView({ status: "canceled" }))),
    } as unknown as jest.Mocked<FarmJobsService>;

    return { controller: new FarmJobsController(jobs), jobs };
  }

  it.each(["submit", "cancel"] as const)(
    "lets any member and above %s — it is the farm's work",
    (handler) => {
      expect(reflector.get(REQUIRED_ROLES, FarmJobsController.prototype[handler])).toEqual(
        CONTRIBUTORS,
      );
    },
  );

  it("answers a cancel 200 — nothing was created", () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, FarmJobsController.prototype.cancel)).toBe(
      HttpStatus.OK,
    );
  });

  it("submits into the session's workspace, as the session's user", async () => {
    // Both come off the session and neither off the body: the workspace scopes the build, and
    // the user is who the audit trail says submitted it (#260).
    const { controller, jobs } = subject();
    const body = {
      pool: "pool-a",
      repository: "acme-robotics/helios-firmware",
      ref: "main",
      commit: COMMIT,
    };

    await controller.submit(TENANT, PRINCIPAL, body);

    expect(jobs.submit).toHaveBeenCalledWith(ORG, "user_ken", body);
  });

  it("cancels in the session's workspace", async () => {
    const { controller, jobs } = subject();

    expect((await controller.cancel(TENANT, JOB)).status).toBe("canceled");
    expect(jobs.cancel).toHaveBeenCalledWith(ORG, JOB);
  });
});
