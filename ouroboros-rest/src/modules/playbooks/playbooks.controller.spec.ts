/**
 * The playbooks routes (#415): reads are every member's, recipes are administrators', a launch is
 * a contributor's; each route answers what the service does for the tenant's workspace.
 */

import { PATH_METADATA } from "@nestjs/common/constants";

import type { Organization } from "../db/schema";
import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import { PlaybooksController } from "./playbooks.controller";
import {
  ISSUE_485,
  PlaybookWorld,
  SOURCE_RUN,
  STANDARD_FIX,
  WORKSPACE,
} from "./playbooks.store.fixture";

const TENANT = { id: WORKSPACE } as Organization;
const ADMINISTRATORS = ["owner", "admin"];
const CONTRIBUTORS = ["owner", "admin", "member"];

/**
 * @param method - A handler name.
 * @returns Its `@Roles()` metadata.
 */
function rolesOf(method: keyof PlaybooksController): unknown {
  return Reflect.getMetadata(REQUIRED_ROLES, PlaybooksController.prototype[method]);
}

describe("the playbooks routes", () => {
  it("lives under knowledge/playbooks, literal segments before :id", () => {
    expect(Reflect.getMetadata(PATH_METADATA, PlaybooksController)).toBe("knowledge/playbooks");

    const order = Object.getOwnPropertyNames(PlaybooksController.prototype);

    expect(order.indexOf("counts")).toBeLessThan(order.indexOf("read"));
    expect(order.indexOf("draftFromRun")).toBeLessThan(order.indexOf("read"));
  });

  it.each(["list", "counts", "draftFromRun", "read", "issues", "context"] as const)(
    "%s is open to every member",
    (method) => {
      expect(rolesOf(method)).toBeUndefined();
    },
  );

  it.each(["create", "createFromRun", "update", "delete"] as const)(
    "%s is an administrator's — a recipe changes what a run is injected with",
    (method) => {
      expect(rolesOf(method)).toEqual(ADMINISTRATORS);
    },
  );

  it("launch is a contributor's — the queue write's own gate", () => {
    expect(rolesOf("launch")).toEqual(CONTRIBUTORS);
  });

  it("creates from a run, launches, and lists the counted result for the tenant", async () => {
    const world = new PlaybookWorld();
    const controller = new PlaybooksController(world.service());

    const created = await controller.createFromRun(TENANT, { runId: SOURCE_RUN, name: "Flaky" });
    const receipt = await controller.launch(TENANT, { id: created.id }, { issueId: ISSUE_485 });
    world.openRun(created.id);

    expect(receipt.item.workflowTag).toBe(STANDARD_FIX);
    await expect(controller.list(TENANT)).resolves.toMatchObject({
      items: [{ id: created.id, runCount: 1 }],
    });
    await expect(controller.counts(TENANT)).resolves.toEqual({
      counts: [{ playbookId: created.id, runs: 1 }],
    });
  });
});
