import { HttpStatus } from "@nestjs/common";

import { routeNotFound, ROUTING_ERRORS } from "./routing.errors";

/**
 * One code, and the restraint that keeps it one.
 *
 * The same shape `pricing.errors.spec.ts` checks — stable, machine-readable, lower-case — with
 * one deliberate omission: it is **not** asserted against `openapi.yaml`, because Z.1 publishes
 * no endpoint. The resolution engine is an injectable, and the first route to answer with this
 * code is Z.4's `/routing/simulate`
 * ([#197](https://github.com/NobuData/ouroboros/issues/197)), which is the ticket that will
 * document it. Asserting it now would mean writing the code into a specification that has
 * nowhere to attach it.
 *
 * The restraint test is the interesting one. Almost everything that can go wrong with a
 * resolution is an *answer* — `fail_run` with an explanation — and turning any of it into an
 * error would throw away the explanations this ticket is mostly about.
 */

describe("the code", () => {
  it.each(Object.entries(ROUTING_ERRORS))(
    "names %s as a stable, machine-readable %s",
    (_key, code) => {
      expect(code).toMatch(/^[a-z][a-z_]*[a-z]$/);
    },
  );

  it("defines exactly one, because every other failure is an answer", () => {
    // A code added here should have to justify itself against `fail_run`. Every provider down,
    // the floor breached, a chain filtered to nothing — those are resolutions carrying a
    // reason, not errors, and a client that received a 500 for one of them would have lost the
    // sentence that told an operator what to change.
    expect(Object.keys(ROUTING_ERRORS)).toEqual(["routeNotFound"]);
  });
});

describe("no route for a task kind", () => {
  it("is a 404 rather than a 422, because nothing about the request is malformed", () => {
    const error = routeNotFound("implement");

    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(error.getResponse()).toEqual({
      code: "route_not_found",
      message: "This workspace has no route for that task kind.",
      details: { taskKind: "implement" },
    });
  });

  it("echoes the kind, so a client resolving several knows which one failed", () => {
    expect(routeNotFound("commit-msg").getResponse()).toMatchObject({
      details: { taskKind: "commit-msg" },
    });
  });
});
