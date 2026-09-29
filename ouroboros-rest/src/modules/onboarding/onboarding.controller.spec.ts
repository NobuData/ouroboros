/** The onboarding routes ([#385](https://github.com/NobuData/ouroboros/issues/385)). */

import { Reflector } from "@nestjs/core";

import type { Organization } from "../db/schema";
import { CONTRIBUTORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { OnboardingController } from "./onboarding.controller";
import type { OnboardingService } from "./onboarding.service";

const WORKSPACE = { id: "org-1" } as Organization;
const QUERY = { repo: "acme-robotics/helios-firmware" };
const RESOURCE = { repo: QUERY.repo };

describe("the onboarding controller", () => {
  let service: jest.Mocked<OnboardingService>;
  let controller: OnboardingController;

  beforeEach(() => {
    service = {
      read: jest.fn().mockResolvedValue(RESOURCE),
      update: jest.fn().mockResolvedValue(RESOURCE),
      completeStep: jest.fn().mockResolvedValue(RESOURCE),
      skip: jest.fn().mockResolvedValue(RESOURCE),
    } as unknown as jest.Mocked<OnboardingService>;

    controller = new OnboardingController(service);
  });

  it("scopes every route to the workspace and the repository", async () => {
    await controller.read(WORKSPACE, QUERY);
    await controller.update(WORKSPACE, QUERY, { dismissed: true });
    await controller.completeStep(WORKSPACE, QUERY, { step: 3 });
    await controller.skip(WORKSPACE, QUERY);

    expect(service.read).toHaveBeenCalledWith("org-1", QUERY.repo);
    expect(service.update).toHaveBeenCalledWith("org-1", QUERY.repo, { dismissed: true });
    expect(service.completeStep).toHaveBeenCalledWith("org-1", QUERY.repo, 3);
    expect(service.skip).toHaveBeenCalledWith("org-1", QUERY.repo);
  });

  it("asks contributors of complete-step and skip, and leaves read and PATCH to the service", () => {
    // PATCH's rule depends on the body — anyone may dismiss — so it is the service's.
    const reflector = new Reflector();

    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.completeStep)).toEqual([
      ...CONTRIBUTORS,
    ]);
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.skip)).toEqual([...CONTRIBUTORS]);
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.read)).toBeUndefined();
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.update)).toBeUndefined();
  });
});
