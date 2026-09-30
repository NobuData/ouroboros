import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { Organization } from "../db/schema";
import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { DEFAULT_SUPPRESSIONS_PAGE } from "./proposers.dto";
import { FactProposersController } from "./proposers.controller";
import { PROPOSER_REGISTRY_VERSION } from "./proposers.registry";
import type { FactProposersService } from "./proposers.service";

/**
 * The proposers' controller (#412), held to its routes, its role gates and its delegation — the
 * rules live in `proposers.service.spec.ts`.
 */

const TENANT = { id: "acme-robotics-id" } as Organization;
const RUN = "5eed0021-0000-4000-8000-000000000482";

describe("the fact proposers controller", () => {
  const reflector = new Reflector();
  let service: jest.Mocked<Pick<FactProposersService, "suppressions" | "backfillRun">>;
  let controller: FactProposersController;

  beforeEach(() => {
    service = {
      suppressions: jest.fn().mockResolvedValue([]),
      backfillRun: jest
        .fn()
        .mockResolvedValue([
          { outcome: "skipped", source: { kind: "steer", id: "s" }, reason: "not_remembered" },
        ]),
    };
    controller = new FactProposersController(service as unknown as FactProposersService);
  });

  it.each([
    ["registry", "/", RequestMethod.GET],
    ["suppressions", "suppressions", RequestMethod.GET],
    ["backfill", "backfill", RequestMethod.POST],
  ] as const)("serves %s at fact-proposers/%s", (handler, path, method) => {
    expect(Reflect.getMetadata(PATH_METADATA, FactProposersController)).toBe("fact-proposers");
    expect(Reflect.getMetadata(PATH_METADATA, FactProposersController.prototype[handler])).toBe(
      path,
    );
    expect(Reflect.getMetadata(METHOD_METADATA, FactProposersController.prototype[handler])).toBe(
      method,
    );
  });

  it("lets every member read, and only administrators backfill", () => {
    expect(
      reflector.get<string[] | undefined>(
        REQUIRED_ROLES,
        FactProposersController.prototype.registry,
      ),
    ).toBeUndefined();
    expect(
      reflector.get<string[] | undefined>(
        REQUIRED_ROLES,
        FactProposersController.prototype.suppressions,
      ),
    ).toBeUndefined();
    expect(
      reflector.get<string[]>(REQUIRED_ROLES, FactProposersController.prototype.backfill),
    ).toEqual([...ADMINISTRATORS]);
  });

  it("serves the registry as data, landing everything proposed", () => {
    const registry = controller.registry();

    expect(registry.version).toBe(PROPOSER_REGISTRY_VERSION);
    expect(registry.landsAs).toBe("proposed");
    expect(registry.proposers.map((entry) => entry.kind)).toEqual([
      "correction_note",
      "waiver",
      "steer",
      "import",
    ]);
  });

  it("reads the session's workspace's suppressions, a default page when no limit is given", async () => {
    await controller.suppressions(TENANT, {});
    await controller.suppressions(TENANT, { limit: 7 });

    expect(service.suppressions.mock.calls).toEqual([
      [TENANT.id, DEFAULT_SUPPRESSIONS_PAGE],
      [TENANT.id, 7],
    ]);
  });

  it("backfills the session's workspace's run and counts the outcomes", async () => {
    const answer = await controller.backfill(TENANT, { runId: RUN });

    expect(service.backfillRun).toHaveBeenCalledWith(TENANT.id, RUN);
    expect(answer.counts).toEqual({ proposed: 0, suppressed: 0, alreadyProposed: 0, skipped: 1 });
  });
});
