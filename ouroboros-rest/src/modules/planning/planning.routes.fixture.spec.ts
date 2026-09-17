import { Controller, Get, Post } from "@nestjs/common";

import { Roles } from "../tenancy/roles.guard";
import { fillRoute, joinRoute, planningRoutes } from "./planning.routes.fixture";

/**
 * The route inventory AL.6's role-matrix and isolation suites are driven by (#282). If it came up
 * short, "every route" would quietly become "some routes" — so its reading is pinned here, where
 * nothing needs a database.
 */

@Controller("sample")
class SampleController {
  @Get()
  list(): string {
    return "";
  }

  @Post(":thing/act")
  @Roles("owner", "admin")
  act(): string {
    return "";
  }

  helper(): string {
    return "";
  }
}

describe("the planning route inventory", () => {
  it("reads every route of the planning controllers, with its roles", () => {
    const routes = planningRoutes();
    const keys = routes.map((route) => route.key);

    expect(new Set(keys).size).toBe(keys.length);
    expect(routes).toHaveLength(20);
    expect(routes).toContainEqual({
      method: "post",
      path: "/api/v1/planning/batches",
      key: "POST /api/v1/planning/batches",
      roles: ["owner", "admin", "member"],
      mutating: true,
    });
    expect(routes).toContainEqual({
      method: "post",
      path: "/api/v1/planning/batches/:batch/push/resume",
      key: "POST /api/v1/planning/batches/:batch/push/resume",
      roles: ["owner", "admin"],
      mutating: true,
    });
    expect(routes).toContainEqual({
      method: "get",
      path: "/api/v1/planning/health",
      key: "GET /api/v1/planning/health",
      roles: null,
      mutating: false,
    });
  });

  it("names a role on every mutating route and on no read", () => {
    for (const route of planningRoutes()) {
      expect([route.key, route.roles !== null]).toEqual([route.key, route.mutating]);
    }
  });

  it("skips plain methods and reads a root handler as the controller's own path", () => {
    expect(planningRoutes([SampleController])).toEqual([
      {
        method: "get",
        path: "/api/v1/sample",
        key: "GET /api/v1/sample",
        roles: null,
        mutating: false,
      },
      {
        method: "post",
        path: "/api/v1/sample/:thing/act",
        key: "POST /api/v1/sample/:thing/act",
        roles: ["owner", "admin"],
        mutating: true,
      },
    ]);
  });

  it("refuses a class that is not a controller", () => {
    class Plain {}

    expect(() => planningRoutes([Plain])).toThrow("Plain is not a routed controller");
  });

  it("joins paths the way the router does", () => {
    expect(joinRoute("planning/batches", "/")).toBe("/api/v1/planning/batches");
    expect(joinRoute("/planning/", "/epics/:epic/")).toBe("/api/v1/planning/epics/:epic");
  });

  it("fills parameters, encoded, and refuses a missing one", () => {
    expect(fillRoute("/a/:batch/drafts/:key", { batch: "b 1", key: "OTA-1" })).toBe(
      "/a/b%201/drafts/OTA-1",
    );
    expect(() => fillRoute("/a/:epic", {})).toThrow("no value for :epic in /a/:epic");
  });
});
