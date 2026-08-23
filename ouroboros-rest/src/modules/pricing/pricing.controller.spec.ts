import { HttpStatus } from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import type { Organization } from "../db/schema";
import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { PricingController } from "./pricing.controller";
import type { PricingService } from "./pricing.service";
import type { PriceOverrideResource } from "./resources";

/**
 * What a controller spec in this service is about — the routes' declarations — and the two
 * declarations that *are* this half of the ticket: `@Roles(...ADMINISTRATORS)` on both writes
 * and nothing on the read, and the workspace coming from the guard rather than from anything a
 * caller wrote. The guard honouring the metadata is `roles.guard.spec.ts`; the whole pipeline
 * refusing a member is `pricing.integration-spec.ts`.
 */

const WORKSPACE = { id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10" } as Organization;

const OVERRIDE: PriceOverrideResource = {
  connectionKind: "anthropic",
  modelId: "claude-fable-5",
  billingMode: "token",
  inputCentsPer1m: 1200,
  outputCentsPer1m: 6000,
  display: "$12 · $60",
  effectiveAt: "2026-08-22T09:00:00.000Z",
  updatedAt: "2026-08-22T09:00:00.000Z",
};

describe("the pricing controller", () => {
  let service: jest.Mocked<PricingService>;
  let controller: PricingController;

  beforeEach(() => {
    service = {
      listOverrides: jest
        .fn()
        .mockResolvedValue({ items: [OVERRIDE], total: 1, limit: 25, offset: 0 }),
      saveOverride: jest.fn().mockResolvedValue(OVERRIDE),
      removeOverride: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PricingService>;

    controller = new PricingController(service);
  });

  it("scopes the listing to the workspace the guard established", async () => {
    await expect(controller.list(WORKSPACE, { limit: 10 })).resolves.toMatchObject({ total: 1 });

    expect(service.listOverrides).toHaveBeenCalledWith(WORKSPACE.id, { limit: 10 });
  });

  it("passes a correction straight through, under the same workspace", async () => {
    const body = {
      connectionKind: "anthropic",
      modelId: "claude-fable-5",
      billingMode: "token" as const,
      inputCentsPer1m: 1200,
      outputCentsPer1m: 6000,
    };

    await expect(controller.save(WORKSPACE, body)).resolves.toEqual(OVERRIDE);

    expect(service.saveOverride).toHaveBeenCalledWith(WORKSPACE.id, body);
  });

  it("passes a withdrawal straight through, under the same workspace", async () => {
    const query = { connectionKind: "anthropic", modelId: "claude-fable-5" };

    await expect(controller.remove(WORKSPACE, query)).resolves.toBeUndefined();

    expect(service.removeOverride).toHaveBeenCalledWith(WORKSPACE.id, query);
  });

  it("asks administrators of both writes, and of nothing else", () => {
    // The ticket's *override writes are owner/admin only*, as metadata. The `GET` names no
    // roles at all: under the roles guard's own rule a bare route is every member's, and a
    // viewer is a role that exists to be able to look at what the workspace pays.
    const reflector = new Reflector();

    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.save)).toEqual([...ADMINISTRATORS]);
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.remove)).toEqual([...ADMINISTRATORS]);
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.list)).toBeUndefined();
  });

  it("answers a withdrawal with 204 and no body", () => {
    // There is nothing useful to say: what was removed is of no further use to the client that
    // asked for it gone, and what the price is *now* is a different question.
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.remove)).toBe(HttpStatus.NO_CONTENT);
  });

  it("declares no route that resolves a price", () => {
    // Deliberate, and worth an assertion because the obvious next endpoint is exactly the one
    // that must not exist. Resolution is served internally, to CH.5's registry table and to the
    // accounting tickets; a second HTTP answer to *what does this model cost* would be a second
    // place for the answer to come from.
    const handlers = Object.getOwnPropertyNames(PricingController.prototype).filter(
      (name) => name !== "constructor",
    );

    expect(handlers.sort()).toEqual(["list", "remove", "save"]);
  });
});
