import { HttpStatus } from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";

import { DomainsController } from "./domains.controller";
import type { DomainsService } from "./domains.service";

/** See `tenants.controller.spec.ts` for what these specs are and are not about. */

const TENANT = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const DOMAIN = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";

describe("the domains controller", () => {
  let service: jest.Mocked<DomainsService>;
  let controller: DomainsController;

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 }),
      add: jest.fn().mockResolvedValue({ id: DOMAIN }),
      setPrimary: jest.fn().mockResolvedValue({ id: DOMAIN }),
      remove: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DomainsService>;

    controller = new DomainsController(service);
  });

  it("scopes a listing to the tenant in the path", async () => {
    await controller.list({ tenantId: TENANT }, { limit: 5 });

    expect(service.list).toHaveBeenCalledWith(TENANT, { limit: 5 });
  });

  it("passes a new domain straight through", async () => {
    await controller.add({ tenantId: TENANT }, { domain: "acme.example", isPrimary: true });

    expect(service.add).toHaveBeenCalledWith(TENANT, {
      domain: "acme.example",
      isPrimary: true,
    });
  });

  it("addresses one domain of one tenant when promoting it", async () => {
    await controller.setPrimary({ tenantId: TENANT, domainId: DOMAIN }, { isPrimary: true });

    expect(service.setPrimary).toHaveBeenCalledWith(TENANT, DOMAIN, { isPrimary: true });
  });

  it("addresses one domain of one tenant when removing it", async () => {
    await controller.remove({ tenantId: TENANT, domainId: DOMAIN });

    expect(service.remove).toHaveBeenCalledWith(TENANT, DOMAIN);
  });

  it("answers a removal with 204 and no body", () => {
    // Nest answers a `DELETE` with `200` by default. There is nothing to say about a row
    // that no longer exists, and a body carrying the deleted resource invites a client to
    // keep using it.
    const status: unknown = Reflect.getMetadata(HTTP_CODE_METADATA, controller.remove);

    expect(status).toBe(HttpStatus.NO_CONTENT);
  });
});
