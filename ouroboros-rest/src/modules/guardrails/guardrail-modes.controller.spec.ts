import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { principalFor } from "../auth/principal.fixture";
import { HUMAN_ONLY } from "../auth/service.scopes";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { GuardrailModesController } from "./guardrail-modes.controller";
import { PatchGuardrailModesDto } from "./guardrail-modes.dto";
import type { GuardrailModesService } from "./guardrail-modes.service";

/** The routes' metadata and hand-off (AR.1, #315), and the patch's validation. */

const TENANT: Organization = {
  id: "acme-robotics-id",
  name: "Acme Robotics",
  slug: "acme-robotics",
  logo: null,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  metadata: null,
};

describe("/api/v1/settings/guardrails", () => {
  const reflector = new Reflector();
  let modes: jest.Mocked<Pick<GuardrailModesService, "read" | "update">>;

  beforeEach(() => {
    modes = {
      read: jest.fn().mockResolvedValue({ modes: {} }),
      update: jest.fn().mockResolvedValue({ modes: {} }),
    };
  });

  const controller = () => new GuardrailModesController(modes as unknown as GuardrailModesService);

  it("lives under settings/guardrails", () => {
    expect(Reflect.getMetadata(PATH_METADATA, GuardrailModesController)).toBe(
      "settings/guardrails",
    );
  });

  it("lets any member read", async () => {
    const read = GuardrailModesController.prototype.read;

    expect(Reflect.getMetadata(METHOD_METADATA, read)).toBe(RequestMethod.GET);
    expect(reflector.get<string[]>(REQUIRED_ROLES, read)).toBeUndefined();
    await controller().read(TENANT);
    expect(modes.read).toHaveBeenCalledWith(TENANT.id);
  });

  it("lets only an owner or admin, in person, change a mode", async () => {
    const update = GuardrailModesController.prototype.update;
    const principal = principalFor();

    expect(Reflect.getMetadata(METHOD_METADATA, update)).toBe(RequestMethod.PATCH);
    expect(reflector.get<string[]>(REQUIRED_ROLES, update)).toEqual([...ADMINISTRATORS]);
    expect(reflector.get<boolean>(HUMAN_ONLY, update)).toBe(true);

    await controller().update(TENANT, principal, { modes: { secrets: "warn" } });
    expect(modes.update).toHaveBeenCalledWith(TENANT.id, { secrets: "warn" }, principal.user.id);
  });
});

describe("PatchGuardrailModesDto", () => {
  /** Validate as the global pipe does, returning the failing paths. */
  async function violations(body: unknown): Promise<string[]> {
    const failures = await validate(plainToInstance(PatchGuardrailModesDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    return failures.flatMap((failure) =>
      failure.children !== undefined && failure.children.length > 0
        ? failure.children.map((child) => `${failure.property}.${child.property}`)
        : [failure.property],
    );
  }

  it("takes a partial map of the four checks", async () => {
    expect(await violations({ modes: { secrets: "warn" } })).toEqual([]);
    expect(
      await violations({
        modes: {
          allowed_paths: "block",
          ci_config: "warn",
          secrets: "warn",
          review_required: "block",
        },
      }),
    ).toEqual([]);
    expect(await violations({ modes: {} })).toEqual([]);
  });

  it("refuses a mode that is neither block nor warn", async () => {
    expect(await violations({ modes: { secrets: "off" } })).toEqual(["modes.secrets"]);
  });

  it("refuses a check that is not one of the four", async () => {
    expect(await violations({ modes: { licence: "warn" } })).toEqual(["modes.licence"]);
  });

  it("refuses a body without modes, or with modes of the wrong shape", async () => {
    expect(await violations({})).toEqual(["modes"]);
    expect(await violations({ modes: "warn" })).toEqual(["modes"]);
  });
});
