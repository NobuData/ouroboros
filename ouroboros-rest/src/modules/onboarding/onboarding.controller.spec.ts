/** The onboarding routes ([#385](https://github.com/NobuData/ouroboros/issues/385)). */

import { Reflector } from "@nestjs/core";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, CONTRIBUTORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import type { FirstIssueService } from "./first-issue.service";
import { OnboardingController } from "./onboarding.controller";
import type { OnboardingService } from "./onboarding.service";
import type { TemplateInstantiationService } from "./templates.service";

const WORKSPACE = { id: "org-1" } as Organization;
const QUERY = { repo: "acme-robotics/helios-firmware" };
const RESOURCE = { repo: QUERY.repo };
const PRINCIPAL = { user: { id: "user-1" } } as Principal;

describe("the onboarding controller", () => {
  let service: jest.Mocked<OnboardingService>;
  let templates: jest.Mocked<TemplateInstantiationService>;
  let picker: jest.Mocked<FirstIssueService>;
  let controller: OnboardingController;

  beforeEach(() => {
    service = {
      read: jest.fn().mockResolvedValue(RESOURCE),
      update: jest.fn().mockResolvedValue(RESOURCE),
      completeStep: jest.fn().mockResolvedValue(RESOURCE),
      skip: jest.fn().mockResolvedValue(RESOURCE),
    } as unknown as jest.Mocked<OnboardingService>;

    templates = {
      list: jest.fn().mockResolvedValue(RESOURCE),
      select: jest.fn().mockResolvedValue(RESOURCE),
    } as unknown as jest.Mocked<TemplateInstantiationService>;

    picker = {
      pick: jest.fn().mockResolvedValue(RESOURCE),
      alternatives: jest.fn().mockResolvedValue(RESOURCE),
    } as unknown as jest.Mocked<FirstIssueService>;

    controller = new OnboardingController(service, templates, picker);
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

  it("routes the tiles and the selection to the instantiation service (#386)", async () => {
    await controller.listTemplates(WORKSPACE, QUERY);
    await controller.selectTemplate(WORKSPACE, QUERY, PRINCIPAL, { slug: "quick-fixes" });

    expect(templates.list).toHaveBeenCalledWith("org-1", QUERY.repo);
    expect(templates.select).toHaveBeenCalledWith("org-1", QUERY.repo, "quick-fixes", "user-1");
  });

  it("routes the first-issue pick and its alternatives to the picker (#387)", async () => {
    await controller.firstIssue(WORKSPACE, QUERY);
    await controller.firstIssueAlternatives(WORKSPACE, { ...QUERY, limit: 5 });
    await controller.firstIssueAlternatives(WORKSPACE, QUERY);

    expect(picker.pick).toHaveBeenCalledWith("org-1", QUERY.repo);
    expect(picker.alternatives).toHaveBeenNthCalledWith(1, "org-1", QUERY.repo, 5);
    expect(picker.alternatives).toHaveBeenNthCalledWith(2, "org-1", QUERY.repo, undefined);
  });

  it("lets any member read the first-issue pick and its alternatives", () => {
    const reflector = new Reflector();

    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.firstIssue)).toBeUndefined();
    expect(
      reflector.get<string[]>(REQUIRED_ROLES, controller.firstIssueAlternatives),
    ).toBeUndefined();
  });

  it("asks administrators of select-template — it publishes — and nobody of the tiles", () => {
    const reflector = new Reflector();

    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.selectTemplate)).toEqual([
      ...ADMINISTRATORS,
    ]);
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.listTemplates)).toBeUndefined();
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
