import { PATH_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import { FIXTURE_USER } from "../auth/principal.fixture";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import {
  runWithTenantContext,
  setTenantContext,
  type ActiveMembership,
} from "../tenancy/tenant.context";
import { EnvRecipesController } from "./env-recipes.controller";
import type { EnvRecipesService } from "./env-recipes.service";
import { RECIPE, SAVE_BODY } from "./env-recipes.fixture";

/**
 * The routes' declarations (#420): the read is every member's, the save is `owner`/`admin` — on a
 * direct API call exactly as in the UI — and the save is made in the signed-in person's name.
 */

const TENANT = { id: "org-helios" } as Organization;

const MEMBER: ActiveMembership = { tenant: TENANT, roles: ["owner"] };

describe("the env-recipe controller", () => {
  let service: jest.Mocked<EnvRecipesService>;
  let controller: EnvRecipesController;

  beforeEach(() => {
    service = {
      read: jest.fn().mockResolvedValue(RECIPE),
      save: jest.fn().mockResolvedValue({ ...RECIPE, version: 4 }),
    } as unknown as jest.Mocked<EnvRecipesService>;
    controller = new EnvRecipesController(service);
  });

  it("lives under knowledge/env-recipe", () => {
    expect(Reflect.getMetadata(PATH_METADATA, EnvRecipesController)).toBe("knowledge/env-recipe");
  });

  it("reads the tenant's recipe for the repository the query names", async () => {
    await expect(controller.read(TENANT, { repo: RECIPE.repo })).resolves.toEqual(RECIPE);
    expect(service.read).toHaveBeenCalledWith("org-helios", RECIPE.repo);
  });

  it("saves in the signed-in person's name", async () => {
    await runWithTenantContext(async () => {
      setTenantContext({ user: FIXTURE_USER, membership: MEMBER });

      await expect(controller.save(TENANT, SAVE_BODY)).resolves.toMatchObject({ version: 4 });
    });

    expect(service.save).toHaveBeenCalledWith("org-helios", FIXTURE_USER.id, SAVE_BODY);
  });

  it("refuses a save nobody can be named for", () => {
    expect(() => controller.save(TENANT, SAVE_BODY)).toThrow(/no signed-in person/);
  });

  it("asks administrators of the save, and of nothing else", () => {
    const reflector = new Reflector();

    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.save)).toEqual([...ADMINISTRATORS]);
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.read)).toBeUndefined();
  });
});
