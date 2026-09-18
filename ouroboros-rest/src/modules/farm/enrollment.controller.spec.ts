import { Reflector } from "@nestjs/core";

import { EnrollmentController } from "./enrollment.controller";
import type { EnrollmentService } from "./enrollment.service";
import type { RegistrationService } from "./registration.service";
import { REQUIRED_ROLES, ADMINISTRATORS } from "../tenancy/roles.guard";
import { ALLOW_ANONYMOUS } from "../auth/anonymous";
import { authorityResource } from "./farm.resources";
import { authority, FIXTURE_ORGANIZATION } from "./farm.fixture";
import type { Organization } from "../db/schema";
import type { Principal } from "../auth/principal";

/**
 * The operator's five routes: which role each one needs, and that every one of them takes its
 * workspace from the session rather than from the request.
 */

const TENANT = { id: FIXTURE_ORGANIZATION } as Organization;
const PRINCIPAL = { user: { id: "user_ken" } } as Principal;

/** The controller over two stubs, with the calls recorded. */
function subject(): {
  controller: EnrollmentController;
  enrollment: EnrollmentService;
  registration: RegistrationService;
} {
  const enrollment = {
    mint: jest.fn(() => Promise.resolve({ token: "orb_enroll_x" })),
    list: jest.fn(() => Promise.resolve([])),
    revoke: jest.fn(() => Promise.resolve({ revoked: true })),
  } as unknown as EnrollmentService;

  const registration = {
    // The service answers the *resource*, never the row — see `registration.service.ts` on why
    // that is load-bearing rather than tidy.
    authorityOf: jest.fn(() => Promise.resolve(authorityResource(authority().row))),
    revokeCertificate: jest.fn(() => Promise.resolve({ revoked: true })),
  } as unknown as RegistrationService;

  return {
    controller: new EnrollmentController(enrollment, registration),
    enrollment,
    registration,
  };
}

describe("who may do what", () => {
  const reflector = new Reflector();

  /**
   * The roles a handler declares.
   *
   * @param handler - The method name.
   * @returns The roles, or `undefined` for a route open to every member.
   */
  function roles(handler: keyof EnrollmentController): unknown {
    return reflector.get(REQUIRED_ROLES, EnrollmentController.prototype[handler]);
  }

  it.each(["mint", "list", "revoke", "revokeCertificate"] as const)(
    "requires an administrator to %s",
    (handler) => {
      expect(roles(handler)).toEqual([...ADMINISTRATORS]);
    },
  );

  it("lets any member read the CA certificate", () => {
    // It is a public certificate, and the person who needs it is whoever is configuring the
    // reverse proxy. A gate with no secret behind it is a gate that only costs.
    expect(roles("authority")).toBeUndefined();
  });

  it("is not anonymous anywhere", () => {
    // Every route here is behind a session; the two unsessioned ones are the agent's, in
    // `registration.controller.ts`.
    for (const handler of ["authority", "mint", "list", "revoke", "revokeCertificate"] as const) {
      expect(reflector.get(ALLOW_ANONYMOUS, EnrollmentController.prototype[handler])).toBeFalsy();
    }
  });
});

describe("the workspace each handler acts in", () => {
  it("is the session's, on every one of them", async () => {
    const { controller, enrollment, registration } = subject();

    await controller.authority(TENANT);
    await controller.mint(TENANT, PRINCIPAL, { pool: "pool-a" });
    await controller.list(TENANT);
    await controller.revoke(TENANT, PRINCIPAL, "7f3a9c1e-4b0d-4e2a-8f6b-5c3d1e0f2a4b");
    await controller.revokeCertificate(TENANT, PRINCIPAL, "9c4ab7f0-2d31-4e55-8a0b-6f1c2d3e4a5b");

    expect(registration.authorityOf).toHaveBeenCalledWith(FIXTURE_ORGANIZATION);
    expect(enrollment.mint).toHaveBeenCalledWith(FIXTURE_ORGANIZATION, "user_ken", {
      pool: "pool-a",
    });
    expect(enrollment.list).toHaveBeenCalledWith(FIXTURE_ORGANIZATION);
    expect(enrollment.revoke).toHaveBeenCalledWith(
      FIXTURE_ORGANIZATION,
      "user_ken",
      "7f3a9c1e-4b0d-4e2a-8f6b-5c3d1e0f2a4b",
    );
    expect(registration.revokeCertificate).toHaveBeenCalledWith(
      FIXTURE_ORGANIZATION,
      "user_ken",
      "9c4ab7f0-2d31-4e55-8a0b-6f1c2d3e4a5b",
    );
  });
});

describe("the CA read", () => {
  it("answers the public half and nothing else", async () => {
    const { controller } = subject();

    const resource = await controller.authority(TENANT);

    expect(Object.keys(resource).sort()).toEqual([
      "certificate",
      "fingerprint",
      "notAfter",
      "notBefore",
    ]);
  });

  it("creates the authority rather than 404ing before the first machine arrives", async () => {
    // A person setting up a proxy should get the certificate they are about to need.
    const { controller, registration } = subject();

    await controller.authority(TENANT);

    expect(registration.authorityOf).toHaveBeenCalled();
  });
});
