import { HttpStatus, RequestMethod } from "@nestjs/common";
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import { FIXTURE_USER } from "../auth/principal.fixture";
import { FIXTURE_ORGANIZATION, membershipIn } from "../tenancy/organization.fixture";
import { CONTRIBUTORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { runWithTenantContext, setTenantContext } from "../tenancy/tenant.context";
import { TENANT_OPTIONAL } from "../tenancy/tenant.decorators";
import { TriageIntentsController } from "./triage.intents.controller";
import type { TriageService } from "./triage.service";

/**
 * The thin layer over `TriageService.setIntents` (AU.6,
 * [#340](https://github.com/NobuData/ouroboros/issues/340)), held to its classification and its
 * delegation. The policy is `triage.service.spec.ts`'s, and the pipeline is the integration
 * suite's.
 */

const RUN = "5eed0009-0000-4000-8000-000000000482";

/** A service that records what it was handed. */
function stubService(): jest.Mocked<TriageService> {
  return {
    setIntents: jest.fn().mockResolvedValue({ runId: RUN }),
  } as unknown as jest.Mocked<TriageService>;
}

describe("the PR intents controller", () => {
  const reflector = new Reflector();
  const handler = TriageIntentsController.prototype.setIntents;

  it("hands the service the workspace, the run and the requester the session established", async () => {
    const service = stubService();
    const controller = new TriageIntentsController(service);
    const member = membershipIn(["member"]);

    await runWithTenantContext(async () => {
      setTenantContext({ user: FIXTURE_USER, membership: member });
      await controller.setIntents(member, { id: RUN }, { blockUntilGreen: true });
    });

    expect(service.setIntents).toHaveBeenCalledWith(
      FIXTURE_ORGANIZATION.id,
      RUN,
      { id: FIXTURE_USER.id, name: FIXTURE_USER.name, roles: ["member"] },
      { blockUntilGreen: true },
    );
  });

  it("fails loudly rather than store a toggle nobody can be named for", () => {
    const service = stubService();
    const controller = new TriageIntentsController(service);

    expect(() =>
      runWithTenantContext(() =>
        controller.setIntents(membershipIn(["admin"]), { id: RUN }, { blockUntilGreen: true }),
      ),
    ).toThrow(/no signed-in person/);
    expect(service.setIntents).not.toHaveBeenCalled();
  });

  it("refuses a viewer at the guard — the roles that may classify", () => {
    expect(reflector.get<string[]>(REQUIRED_ROLES, handler)).toEqual([...CONTRIBUTORS]);
  });

  it("is PUT /runs/:id/pr-intents, answered 200", () => {
    expect(Reflect.getMetadata(PATH_METADATA, TriageIntentsController)).toBe("runs");
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(":id/pr-intents");
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.PUT);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler) ?? HttpStatus.OK).toBe(HttpStatus.OK);
  });

  it("requires a workspace, by saying nothing", () => {
    expect(reflector.get<boolean>(TENANT_OPTIONAL, TriageIntentsController)).toBeUndefined();
  });
});
