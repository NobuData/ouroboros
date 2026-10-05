import { Reflector } from "@nestjs/core";

import type { Organization } from "../db/schema";
import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import { IntegrationsController } from "./integrations.controller";
import type { IntegrationFacts, IntegrationsRepository } from "./integrations.repository";

/** The grid's one route (#488): every member reads it, for the session's workspace. */

describe("the integrations controller", () => {
  it("composes the grid from the session workspace's facts, read now", async () => {
    const facts: IntegrationFacts = {
      githubTokenStored: true,
      githubOrgs: [],
      sources: [],
      activeWebhooks: 1,
      runners: new Map(),
    };
    const repository = { facts: jest.fn().mockResolvedValue(facts) };
    const controller = new IntegrationsController(repository as unknown as IntegrationsRepository);

    const grid = await controller.list({ id: "org-acme" } as Organization);

    expect(repository.facts).toHaveBeenCalledWith("org-acme");
    expect(grid.connectedCount).toBe(2);
  });

  it("asks no role beyond membership", () => {
    const controller = new IntegrationsController({} as IntegrationsRepository);

    expect(new Reflector().get<string[]>(REQUIRED_ROLES, controller.list)).toBeUndefined();
  });
});
