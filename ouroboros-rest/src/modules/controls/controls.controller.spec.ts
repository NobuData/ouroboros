import { HttpStatus } from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import { isAnonymous } from "../auth/anonymous";
import { FIXTURE_USER } from "../auth/principal.fixture";
import { isInternalOnly } from "../internal/internal.decorators";
import { isInternalPath } from "../internal/internal.paths";
import { FIXTURE_ORGANIZATION, membershipIn } from "../tenancy/organization.fixture";
import { CONTRIBUTORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { runWithTenantContext, setTenantContext } from "../tenancy/tenant.context";
import { TENANT_OPTIONAL } from "../tenancy/tenant.decorators";
import { ControlsController } from "./controls.controller";
import { ControlsInternalController } from "./controls.internal.controller";
import type { ControlsService } from "./controls.service";

/**
 * The two thin layers (#306), held to their classification and their delegation. The policy
 * is `controls.service.spec.ts`'s, and the pipeline is the integration suite's.
 */

const RUN = "5eed0009-0000-4000-8000-000000000482";
const CONTROL = "c0000000-0000-4000-8000-000000000001";

/** A service that records what it was handed. */
function stubService(): jest.Mocked<ControlsService> {
  return {
    submit: jest.fn().mockResolvedValue({ id: CONTROL }),
    list: jest.fn().mockResolvedValue({ controls: [] }),
    fetch: jest.fn().mockResolvedValue({ controls: [] }),
    ack: jest.fn().mockResolvedValue({ id: CONTROL }),
  } as unknown as jest.Mocked<ControlsService>;
}

describe("the public controller", () => {
  const reflector = new Reflector();

  it("hands the service the workspace, the run and the requester the session established", async () => {
    const service = stubService();
    const controller = new ControlsController(service);
    const member = membershipIn(["member"]);

    await runWithTenantContext(async () => {
      setTenantContext({ user: FIXTURE_USER, membership: member });
      await controller.submit(member, { id: RUN }, { kind: "steer", payload: "x" });
    });

    expect(service.submit).toHaveBeenCalledWith(
      FIXTURE_ORGANIZATION.id,
      RUN,
      { id: FIXTURE_USER.id, name: FIXTURE_USER.name, roles: ["member"] },
      { kind: "steer", payload: "x" },
    );
  });

  it("fails loudly rather than submit a control nobody can be named for", () => {
    const controller = new ControlsController(stubService());

    expect(() =>
      runWithTenantContext(() =>
        controller.submit(membershipIn(["admin"]), { id: RUN }, { kind: "pause" }),
      ),
    ).toThrow(/no signed-in person/);
  });

  it("hands the listing the workspace and the run", async () => {
    const service = stubService();

    await new ControlsController(service).list(FIXTURE_ORGANIZATION, { id: RUN });

    expect(service.list).toHaveBeenCalledWith(FIXTURE_ORGANIZATION.id, RUN);
  });

  it("refuses a viewer's submission at the guard, and leaves the listing open to every member", () => {
    expect(reflector.get<string[]>(REQUIRED_ROLES, ControlsController.prototype.submit)).toEqual([
      ...CONTRIBUTORS,
    ]);
    expect(
      reflector.get<string[]>(REQUIRED_ROLES, ControlsController.prototype.list),
    ).toBeUndefined();
  });

  it("answers a submission 202, because nothing has happened yet", () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, ControlsController.prototype.submit)).toBe(
      HttpStatus.ACCEPTED,
    );
  });

  it("requires a workspace, by saying nothing", () => {
    expect(reflector.get<boolean>(TENANT_OPTIONAL, ControlsController)).toBeUndefined();
    expect(Reflect.getMetadata("path", ControlsController)).toBe("runs");
  });
});

describe("the internal controller", () => {
  const reflector = new Reflector();

  /** An execution context whose handler and class are the ones being asked about. */
  function contextFor(handler: (...args: never[]) => unknown) {
    return { getHandler: () => handler, getClass: () => ControlsInternalController } as never;
  }

  it("is internal and sessionless, at the origin root", () => {
    expect(isInternalOnly(reflector, contextFor(ControlsInternalController.prototype.fetch))).toBe(
      true,
    );
    expect(isAnonymous(reflector, contextFor(ControlsInternalController.prototype.ack))).toBe(true);

    const base = Reflect.getMetadata("path", ControlsInternalController) as string;

    expect(base).toBe("internal/runs");
    expect(isInternalPath(base)).toBe(true);
  });

  it("answers both routes 200", () => {
    for (const handler of [
      ControlsInternalController.prototype.fetch,
      ControlsInternalController.prototype.ack,
    ]) {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(HttpStatus.OK);
    }
  });

  it("hands the service the run, the control and the body", async () => {
    const service = stubService();
    const controller = new ControlsInternalController(service);

    await controller.fetch({ id: RUN });
    await controller.ack({ id: RUN, controlId: CONTROL }, { attempt: 2 });

    expect(service.fetch).toHaveBeenCalledWith(RUN);
    expect(service.ack).toHaveBeenCalledWith(RUN, CONTROL, { attempt: 2 });
  });
});
