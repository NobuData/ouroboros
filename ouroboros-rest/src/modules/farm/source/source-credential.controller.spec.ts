import { Reflector } from "@nestjs/core";
import { PATH_METADATA, METHOD_METADATA } from "@nestjs/common/constants";
import type { Request } from "express";

import { DomainError } from "../../errors/error.envelope";
import { TENANT_OPTIONAL } from "../../tenancy/tenant.decorators";
import { SourceCredentialController } from "./source-credential.controller";
import { SOURCE_CREDENTIAL_ERRORS } from "./source-credential.errors";
import type { SourceCredentialService } from "./source-credential.service";

/** The redemption route (#991): anonymous, tenant-optional, and a path shape that refuses first. */

const JOB = "0199a1f2-6b3c-7d4e-8f50-61a2b3c4d5e6";

describe("POST /api/v1/farm/jobs/:id/source-credential", () => {
  let service: { redeem: jest.Mock };
  let controller: SourceCredentialController;

  beforeEach(() => {
    service = {
      redeem: jest
        .fn()
        .mockResolvedValue({ username: "x-access-token", password: "t", expires_at: "x" }),
    };
    controller = new SourceCredentialController(service as unknown as SourceCredentialService);
  });

  it("is a POST on the job's path under the farm prefix, needing no workspace", () => {
    const reflector = new Reflector();

    expect(Reflect.getMetadata(PATH_METADATA, SourceCredentialController)).toBe("farm/jobs");
    expect(Reflect.getMetadata(PATH_METADATA, controller.redeem)).toBe(":id/source-credential");
    // Nest's method enum: 1 is POST.
    expect(Reflect.getMetadata(METHOD_METADATA, controller.redeem)).toBe(1);
    expect(reflector.get<boolean>(TENANT_OPTIONAL, controller.redeem)).toBe(true);
  });

  it("hands the service the job and the Authorization header as sent", async () => {
    const http = { headers: { authorization: "Bearer ouro_src_x" } } as unknown as Request;

    await expect(controller.redeem(JOB, http)).resolves.toMatchObject({
      username: "x-access-token",
    });
    expect(service.redeem).toHaveBeenCalledWith(JOB, "Bearer ouro_src_x");
  });

  it("refuses a path that is not a job id with the same 401, reading nothing", async () => {
    const http = { headers: { authorization: "Bearer ouro_src_x" } } as unknown as Request;
    const error: unknown = await controller.redeem("not-a-uuid", http).then(
      () => undefined,
      (failure: unknown) => failure,
    );

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(SOURCE_CREDENTIAL_ERRORS.refused);
    expect(service.redeem).not.toHaveBeenCalled();
  });
});
