import { userRow } from "../auth/principal";
import { FIXTURE_USER, principalFor } from "../auth/principal.fixture";
import type { User } from "../db/schema";
import { TenantsController } from "./tenants.controller";
import type { TenantsService } from "./tenants.service";

/**
 * The controller, which should have almost nothing to say for itself.
 *
 * That is the assertion, really: a tenancy controller names a route, declares the shapes a
 * request may take, and hands the validated result to a service. If one of these tests ever
 * needs to set up a repository or assert on a rule, the layering has slipped — so they check
 * delegation and the pieces of HTTP that are decided by a decorator rather than by code.
 *
 * The route paths themselves are checked where it counts, against a running application:
 * `src/openapi/openapi.spec.ts` fails when the routes the code serves and the ones
 * `openapi.yaml` describes disagree in either direction.
 */

const TENANT = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

/** The signed-in person, in the shape the service takes them. */
const USER: User = userRow(FIXTURE_USER);

describe("the tenants controller", () => {
  let service: jest.Mocked<TenantsService>;
  let controller: TenantsController;

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 }),
      create: jest.fn().mockResolvedValue({ id: TENANT }),
      read: jest.fn().mockResolvedValue({ id: TENANT }),
      update: jest.fn().mockResolvedValue({ id: TENANT }),
    } as unknown as jest.Mocked<TenantsService>;

    controller = new TenantsController(service);
  });

  it("passes the window straight through", async () => {
    await controller.list({ limit: 10, offset: 20 });

    expect(service.list).toHaveBeenCalledWith({ limit: 10, offset: 20 });
  });

  it("passes a creation straight through, with the person who is making it", async () => {
    const body = { slug: "acme", displayName: "Acme, Inc." };

    await controller.create(principalFor(), body);

    expect(service.create).toHaveBeenCalledWith(USER, body);
  });

  it("refuses a creation with no session rather than making a workspace for nobody", () => {
    // Reachable only by somebody adding @AllowAnonymous() to this handler; the owner it
    // would then write is `undefined`, and a workspace with no owner is one nobody can
    // administer. It fails here by name instead.
    expect(() => controller.create(null, { slug: "acme", displayName: "Acme, Inc." })).toThrow(
      /@AllowAnonymous/,
    );
  });

  it("takes the tenant's id off the validated parameters", async () => {
    await controller.read({ tenantId: TENANT });

    expect(service.read).toHaveBeenCalledWith(TENANT);
  });

  it("passes a change straight through", async () => {
    await controller.update({ tenantId: TENANT }, { status: "suspended" });

    expect(service.update).toHaveBeenCalledWith(TENANT, { status: "suspended" });
  });

  it("has no way to delete a tenant", () => {
    // Deliberate: every foreign key in the schema cascades, so a hard delete takes the
    // tenant's domains, members, organisations and repositories with it. `status: "deleted"`
    // is the soft delete, and it is recoverable.
    expect(controller).not.toHaveProperty("remove");
    expect(controller).not.toHaveProperty("delete");
  });
});
