import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import { ADMINISTRATORS, CONTRIBUTORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { BatchesController } from "./batches.controller";
import type { BatchesService } from "./batches.service";
import type { EpicsService } from "./epics.service";
import type { BacklogHealthService } from "./health.service";
import { PlanningController } from "./planning.controller";

/**
 * The role matrix, enforced server-side (AL.4, #280): members draft and edit; admins push and
 * mutate epics; reads are every member's. Asserted on the routes' own metadata, which is what the
 * global `RolesGuard` reads — `planning.integration-spec.ts` proves the `403` over HTTP.
 */

const reflector = new Reflector();

/**
 * The roles a handler requires.
 *
 * @param handler - The route method.
 * @returns The roles, or undefined for every member.
 */
function rolesOf(handler: unknown): readonly string[] | undefined {
  return reflector.get<string[] | undefined>(REQUIRED_ROLES, handler as () => void);
}

/**
 * A handler's method and path.
 *
 * @param handler - The route method.
 * @returns `METHOD path`.
 */
function routeOf(handler: unknown): string {
  const method = Reflect.getMetadata(METHOD_METADATA, handler as object) as RequestMethod;

  return `${RequestMethod[method]} ${String(Reflect.getMetadata(PATH_METADATA, handler as object))}`;
}

describe("the planning routes", () => {
  const batches = BatchesController.prototype;
  const planning = PlanningController.prototype;

  it("mounts under /planning", () => {
    expect(Reflect.getMetadata(PATH_METADATA, BatchesController)).toBe("planning/batches");
    expect(Reflect.getMetadata(PATH_METADATA, PlanningController)).toBe("planning");
  });

  it.each([
    [batches.generate, "POST /", CONTRIBUTORS],
    [batches.read, "GET :batch", undefined],
    [batches.regenerate, "POST :batch/regenerate", CONTRIBUTORS],
    [batches.patchDraft, "PATCH :batch/drafts/:key", CONTRIBUTORS],
    [batches.push, "POST :batch/push", ADMINISTRATORS],
    [batches.resume, "POST :batch/push/resume", ADMINISTRATORS],
    [batches.pushStatus, "GET :batch/push-status", undefined],
    [planning.roadmap, "GET roadmap", undefined],
    [planning.backlogHealth, "GET health", undefined],
    [planning.list, "GET epics", undefined],
    [planning.create, "POST epics", ADMINISTRATORS],
    [planning.reorder, "PUT epics/order", ADMINISTRATORS],
    [planning.read, "GET epics/:epic", undefined],
    [planning.update, "PATCH epics/:epic", ADMINISTRATORS],
    [planning.remove, "DELETE epics/:epic", ADMINISTRATORS],
    [planning.link, "POST epics/:epic/tickets", ADMINISTRATORS],
    [planning.unlink, "DELETE epics/:epic/tickets", ADMINISTRATORS],
    [planning.milestones, "GET sources/:source/milestones", undefined],
  ])("%#: %p is %s for %p", (handler, route, roles) => {
    expect(routeOf(handler)).toBe(route);
    expect(rolesOf(handler)).toEqual(roles);
  });

  it("never lets a member push or change the roadmap", () => {
    for (const handler of [
      batches.push,
      batches.resume,
      planning.create,
      planning.reorder,
      planning.update,
      planning.remove,
      planning.link,
      planning.unlink,
    ]) {
      expect(rolesOf(handler)).not.toContain("member");
      expect(rolesOf(handler)).not.toContain("viewer");
    }
  });

  it("lets a member draft, but never a viewer", () => {
    for (const handler of [batches.generate, batches.regenerate, batches.patchDraft]) {
      expect(rolesOf(handler)).toContain("member");
      expect(rolesOf(handler)).not.toContain("viewer");
    }
  });
});

describe("the planning handlers", () => {
  const tenant = { id: "org-planning" } as never;

  it("delegate to their services with the tenant's id", async () => {
    const batchesService = {
      generate: jest.fn(async () => Promise.resolve("generated")),
      read: jest.fn(async () => Promise.resolve("read")),
      regenerate: jest.fn(async () => Promise.resolve("regenerated")),
      patchDraft: jest.fn(async () => Promise.resolve("patched")),
      push: jest.fn(async () => Promise.resolve("pushed")),
      resume: jest.fn(async () => Promise.resolve("resumed")),
      pushStatus: jest.fn(async () => Promise.resolve("status")),
      milestones: jest.fn(async () => Promise.resolve("milestones")),
    };
    const epicsService = {
      roadmap: jest.fn(async () => Promise.resolve("roadmap")),
      list: jest.fn(async () => Promise.resolve("list")),
      create: jest.fn(async () => Promise.resolve("create")),
      reorder: jest.fn(async () => Promise.resolve("reorder")),
      read: jest.fn(async () => Promise.resolve("read")),
      update: jest.fn(async () => Promise.resolve("update")),
      remove: jest.fn(async () => Promise.resolve(undefined)),
      link: jest.fn(async () => Promise.resolve("link")),
      unlink: jest.fn(async () => Promise.resolve("unlink")),
    };
    const healthService = { health: jest.fn(async () => Promise.resolve("health")) };
    const batches = new BatchesController(batchesService as unknown as BatchesService);
    const planning = new PlanningController(
      epicsService as unknown as EpicsService,
      batchesService as unknown as BatchesService,
      healthService as unknown as BacklogHealthService,
    );
    const batch = { batch: "b" };
    const epic = { epic: "e" };
    const principal = { user: { id: "user-1" } } as never;

    await expect(batches.generate(tenant, principal, { prompt: "p" } as never)).resolves.toBe(
      "generated",
    );
    expect(batchesService.generate).toHaveBeenCalledWith("org-planning", "user-1", { prompt: "p" });
    await batches.read(tenant, batch);
    await batches.regenerate(tenant, batch);
    await batches.patchDraft(tenant, { batch: "b", key: "OTA-3" }, { selected: false });
    expect(batchesService.patchDraft).toHaveBeenCalledWith("org-planning", "b", "OTA-3", {
      selected: false,
    });
    await batches.push(tenant, batch);
    await batches.resume(tenant, batch);
    await batches.pushStatus(tenant, batch);
    await planning.roadmap(tenant);
    await expect(planning.backlogHealth(tenant)).resolves.toBe("health");
    expect(healthService.health).toHaveBeenCalledWith("org-planning");
    await planning.list(tenant);
    await planning.create(tenant, { name: "Lane" });
    await planning.reorder(tenant, { epicIds: ["e"] });
    expect(epicsService.reorder).toHaveBeenCalledWith("org-planning", ["e"]);
    await planning.read(tenant, epic);
    await planning.update(tenant, epic, { name: "Renamed" });
    await planning.remove(tenant, epic);
    await planning.link(tenant, epic, { ticketIds: ["t"] });
    await planning.unlink(tenant, epic, { ticketIds: ["t"] });
    expect(epicsService.unlink).toHaveBeenCalledWith("org-planning", "e", ["t"]);
    await planning.milestones(tenant, { source: "s" });
    expect(batchesService.milestones).toHaveBeenCalledWith("org-planning", "s");

    for (const mock of [
      ...Object.values(batchesService),
      ...Object.values(epicsService),
      ...Object.values(healthService),
    ]) {
      expect(mock).toHaveBeenCalledTimes(1);
    }
  });
});
