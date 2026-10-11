import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { Principal } from "../auth/principal";
import { CONTRIBUTORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { DryRunSuggestionsController } from "./suggestions.controller";
import type { DryRunSuggestionsService } from "./suggestions.service";

const TENANT = {
  id: "acme-robotics-id",
  name: "Acme Robotics",
  slug: "acme-robotics",
  logo: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  metadata: null,
};
const WORKFLOW = "5eed0089-0000-4000-8000-000000000001";
const DRY_RUN = "5eed008b-0000-4000-8000-000000000001";
const SUGGESTION = "5eed008c-0000-4000-8000-000000000001";
const RUN_PARAMS = { id: WORKFLOW, dryRunId: DRY_RUN };
const PARAMS = { ...RUN_PARAMS, suggestionId: SUGGESTION };
const PRINCIPAL = { user: { id: "user-1" } } as Principal;

type Handler = keyof DryRunSuggestionsController;

describe("the suggestions controller", () => {
  let service: jest.Mocked<Pick<DryRunSuggestionsService, "list" | "explain" | "apply" | "ignore">>;
  let controller: DryRunSuggestionsController;
  const reflector = new Reflector();

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue({ dryRunId: DRY_RUN, suggestions: [] }),
      explain: jest.fn().mockResolvedValue({ suggestionId: SUGGESTION }),
      apply: jest.fn().mockResolvedValue({ draftRev: 4, draftLabel: "v0.4" }),
      ignore: jest.fn().mockResolvedValue({ id: SUGGESTION, status: "ignored" }),
    };
    controller = new DryRunSuggestionsController(service as unknown as DryRunSuggestionsService);
  });

  function handler(name: Handler) {
    return DryRunSuggestionsController.prototype[name] as (...args: never[]) => unknown;
  }

  it("mounts under the dry run", () => {
    expect(Reflect.getMetadata(PATH_METADATA, DryRunSuggestionsController)).toBe(
      "workflows/:id/dry-runs/:dryRunId/suggestions",
    );

    const declared = Object.getOwnPropertyNames(DryRunSuggestionsController.prototype)
      .filter((name) => name !== "constructor")
      .map((name) => [
        RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler(name as Handler)) as number],
        Reflect.getMetadata(PATH_METADATA, handler(name as Handler)) as string,
      ]);

    expect(declared).toEqual([
      ["GET", "/"],
      ["GET", ":suggestionId/explanation"],
      ["POST", ":suggestionId/apply"],
      ["POST", ":suggestionId/ignore"],
    ]);
  });

  it("keeps Apply and Ignore to contributors, answers them 200, and leaves the reads to every member", () => {
    const roles = (name: Handler) =>
      reflector.get<string[] | undefined>(REQUIRED_ROLES, handler(name));

    for (const name of ["apply", "ignore"] as const) {
      expect(roles(name)).toEqual([...CONTRIBUTORS]);
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler(name))).toBe(200);
    }
    for (const name of ["list", "explain"] as const) {
      expect(roles(name)).toBeUndefined();
    }
  });

  it("passes the workspace, the path and whoever acted to the service", async () => {
    await controller.list(TENANT, RUN_PARAMS);
    await controller.explain(TENANT, PARAMS);
    expect(await controller.apply(TENANT, PARAMS, PRINCIPAL)).toEqual({
      draftRev: 4,
      draftLabel: "v0.4",
    });
    await controller.ignore(TENANT, PARAMS, PRINCIPAL);

    expect(service.list).toHaveBeenCalledWith(TENANT.id, WORKFLOW, DRY_RUN);
    expect(service.explain).toHaveBeenCalledWith(TENANT.id, WORKFLOW, DRY_RUN, SUGGESTION);
    expect(service.apply).toHaveBeenCalledWith(TENANT.id, WORKFLOW, DRY_RUN, SUGGESTION, "user-1");
    expect(service.ignore).toHaveBeenCalledWith(TENANT.id, WORKFLOW, DRY_RUN, SUGGESTION, "user-1");
  });
});
