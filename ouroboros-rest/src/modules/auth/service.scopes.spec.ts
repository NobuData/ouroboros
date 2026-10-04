import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  isServiceScope,
  requiredScope,
  SERVICE_ERRORS,
  SERVICE_SCOPE_DESCRIPTIONS,
  SERVICE_SCOPES,
  serviceAccess,
  servicePrincipalRefused,
  serviceScopeMissing,
  serviceTokenInvalid,
  type ServiceRouteFacts,
} from "./service.scopes";

/**
 * The scope rule (#485): which scope a route needs, and the refusal that names it.
 */

const V091 = readFileSync(
  join(__dirname, "../../../../ouroboros-db/migrations/V091__members_service_accounts.sql"),
  "utf8",
);

/** A route with nothing declared. */
function route(facts: Partial<ServiceRouteFacts> = {}): ServiceRouteFacts {
  return { method: "GET", humanOnly: false, tenantOptional: false, ...facts };
}

describe("the registered allow-list", () => {
  it("is what V091's CHECK allows, so a scope nobody enforces cannot be stored", () => {
    const check = /scopes <@ '(\[[^']*\])'::jsonb/.exec(V091);

    expect(check).not.toBeNull();
    expect(JSON.parse(check?.[1] ?? "[]")).toEqual([...SERVICE_SCOPES]);
  });

  it("describes every scope", () => {
    expect(Object.keys(SERVICE_SCOPE_DESCRIPTIONS)).toEqual([...SERVICE_SCOPES]);
  });

  it("recognises its own members and nothing else", () => {
    expect(isServiceScope("api.read")).toBe(true);
    expect(isServiceScope("farm.submit")).toBe(true);
    expect(isServiceScope("admin")).toBe(false);
    expect(isServiceScope(7)).toBe(false);
  });
});

describe("which scope a route needs", () => {
  it("is api.read for a read any viewer may make", () => {
    expect(requiredScope(route())).toBe("api.read");
    expect(requiredScope(route({ method: "head" }))).toBe("api.read");
    expect(requiredScope(route({ roles: ["owner", "admin", "member", "viewer"] }))).toBe(
      "api.read",
    );
  });

  it("is nothing for a read restricted above viewer — that is a person's read", () => {
    expect(requiredScope(route({ roles: ["owner", "admin"] }))).toBeNull();
    expect(requiredScope(route({ roles: ["owner", "admin", "member"] }))).toBeNull();
  });

  it("is the declared scope for a write that opted in", () => {
    expect(requiredScope(route({ method: "POST", declaredScope: "farm.submit" }))).toBe(
      "farm.submit",
    );
  });

  it("is nothing for a write that did not opt in", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(requiredScope(route({ method }))).toBeNull();
    }
  });

  it("is nothing for a human-only route or one without a workspace, whatever else it says", () => {
    expect(requiredScope(route({ humanOnly: true }))).toBeNull();
    expect(requiredScope(route({ tenantOptional: true }))).toBeNull();
    expect(requiredScope(route({ humanOnly: true, declaredScope: "farm.submit" }))).toBeNull();
  });
});

describe("deciding a service request", () => {
  it("allows a token holding the scope, and says which scope granted it", () => {
    expect(serviceAccess(route(), ["api.read"])).toEqual({ allowed: true, scope: "api.read" });
  });

  it("refuses a token outside its scopes, naming the missing one", () => {
    expect(
      serviceAccess(route({ method: "POST", declaredScope: "farm.submit" }), ["api.read"]),
    ).toEqual({
      allowed: false,
      reason: "scope_missing",
      scope: "farm.submit",
    });
  });

  it("refuses a human-only route even to a token holding every scope", () => {
    expect(serviceAccess(route({ humanOnly: true }), [...SERVICE_SCOPES])).toEqual({
      allowed: false,
      reason: "human_only",
    });
  });
});

describe("the refusals", () => {
  it("answers a dead token 401, saying nothing about why", () => {
    const error = serviceTokenInvalid();

    expect(error.getStatus()).toBe(401);
    expect(error.code).toBe(SERVICE_ERRORS.tokenInvalid);
  });

  it("answers a missing scope 403, naming it", () => {
    const error = serviceScopeMissing("farm.submit");

    expect(error.getStatus()).toBe(403);
    expect(error.envelope()).toMatchObject({
      code: "service_scope_missing",
      details: { scope: "farm.submit" },
    });
    expect(error.message).toContain("farm.submit");
  });

  it("answers a person's route 403", () => {
    expect(servicePrincipalRefused().envelope().code).toBe("service_principal_refused");
  });
});
