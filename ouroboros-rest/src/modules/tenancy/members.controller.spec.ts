import { HttpStatus } from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";

import { MembersController } from "./members.controller";
import type { MembersService } from "./members.service";

/** See `tenants.controller.spec.ts` for what these specs are and are not about. */

const TENANT = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const USER = "c7b1e2f4-5a63-4d8e-b0c9-7f2a1d3e6b85";

describe("the members controller", () => {
  let service: jest.Mocked<MembersService>;
  let controller: MembersController;

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 }),
      invite: jest.fn().mockResolvedValue({ userId: USER }),
      changeRole: jest.fn().mockResolvedValue({ userId: USER }),
      remove: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MembersService>;

    controller = new MembersController(service);
  });

  it("scopes a listing to the tenant in the path", async () => {
    await controller.list({ tenantId: TENANT }, {});

    expect(service.list).toHaveBeenCalledWith(TENANT, {});
  });

  it("passes an invitation straight through", async () => {
    await controller.invite({ tenantId: TENANT }, { email: "ada@acme.example", role: "owner" });

    expect(service.invite).toHaveBeenCalledWith(TENANT, {
      email: "ada@acme.example",
      role: "owner",
    });
  });

  it("addresses a member by the person's id", async () => {
    // V002 makes `(tenant_id, user_id)` the primary key: the pair *is* the membership, so
    // there is no membership id to address one by.
    await controller.changeRole({ tenantId: TENANT, userId: USER }, { role: "admin" });

    expect(service.changeRole).toHaveBeenCalledWith(TENANT, USER, { role: "admin" });
  });

  it("removes a member by the same pair", async () => {
    await controller.remove({ tenantId: TENANT, userId: USER });

    expect(service.remove).toHaveBeenCalledWith(TENANT, USER);
  });

  it("answers a removal with 204 and no body", () => {
    const status: unknown = Reflect.getMetadata(HTTP_CODE_METADATA, controller.remove);

    expect(status).toBe(HttpStatus.NO_CONTENT);
  });
});
