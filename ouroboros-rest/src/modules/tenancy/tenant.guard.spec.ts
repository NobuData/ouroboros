import { Controller, Get, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

import { SESSION_PROPERTY, userRow } from "../auth/principal";
import { FIXTURE_USER, principalFor } from "../auth/principal.fixture";
import type { Tenant, User } from "../db/schema";
import { currentMembership, currentUser, runWithTenantContext } from "./tenant.context";
import { TenantOptional } from "./tenant.decorators";
import { TenantContextGuard, type TenantRequest } from "./tenant.guard";
import type { TenantResolver } from "./tenant.resolver";

/**
 * The plumbing between the request and the rules.
 *
 * The guard itself decides almost nothing — `tenant.resolver.ts` does — so what is checked
 * here is the wiring: that the answer lands in the `AsyncLocalStorage` store where a service
 * will look for it, that the two opt-outs are honoured, and that a route with neither pays
 * for a resolution.
 */

const TENANT: Tenant = {
  id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
  slug: "acme",
  display_name: "Acme, Inc.",
  status: "active",
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
};

/** The person the session names, in the shape the tenancy code reads them. */
const USER: User = userRow(FIXTURE_USER);

/** Controllers whose decorators are the thing under test. */
@Controller()
class ScopedController {
  @Get()
  handler(): void {}
}

@Controller()
class OptionalController {
  @TenantOptional()
  @Get()
  handler(): void {}
}

@Controller()
class AnonymousController {
  @AllowAnonymous()
  @Get()
  handler(): void {}
}

/**
 * An execution context over a real controller class and a real request object.
 *
 * @param target - The controller.
 * @param handler - The method on it.
 * @param request - The request the guard reads.
 * @returns The context.
 */
function contextFor(
  target: new () => object,
  handler: (...args: never[]) => unknown,
  request: TenantRequest,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => target,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/** A request from a signed-in person, with whatever headers and parameters a test wants. */
function signedInRequest(extra: Partial<TenantRequest> = {}): TenantRequest {
  return { headers: {}, params: {}, [SESSION_PROPERTY]: principalFor(), ...extra };
}

/** A resolver that answers with a membership in {@link TENANT}. */
function resolverDouble(): jest.Mocked<TenantResolver> {
  return {
    resolve: jest.fn().mockResolvedValue({ tenant: TENANT, role: "member" }),
  } as unknown as jest.Mocked<TenantResolver>;
}

describe("a route with neither opt-out", () => {
  it("resolves a tenant and puts it where a service will look", async () => {
    // The acceptance criterion this guard exists for: after it runs, `currentTenant()`
    // answers from anywhere, with nothing threaded through a call chain.
    const resolver = resolverDouble();
    const guard = new TenantContextGuard(new Reflector(), resolver);

    await runWithTenantContext(async () => {
      await guard.canActivate(
        contextFor(ScopedController, ScopedController.prototype.handler, signedInRequest()),
      );

      expect(currentMembership()).toEqual({ tenant: TENANT, role: "member" });
    });
  });

  it("hands the resolver the person, the headers and the parameters", async () => {
    const resolver = resolverDouble();
    const guard = new TenantContextGuard(new Reflector(), resolver);
    const request = signedInRequest({
      headers: { "x-ouro-tenant": "acme" },
      params: { tenantId: TENANT.id },
    });

    await runWithTenantContext(() =>
      guard.canActivate(contextFor(ScopedController, ScopedController.prototype.handler, request)),
    );

    expect(resolver.resolve).toHaveBeenCalledWith(USER, request.headers, request.params);
  });

  it("lets the resolver's refusal through unchanged", async () => {
    // Every refusal is a thrown `DomainError` rather than a `false`, because a guard's
    // `false` is a bare 403 with no envelope and nothing for a client to act on.
    const resolver = resolverDouble();
    resolver.resolve.mockRejectedValue(new Error("no such tenant"));
    const guard = new TenantContextGuard(new Reflector(), resolver);

    await expect(
      runWithTenantContext(() =>
        guard.canActivate(
          contextFor(ScopedController, ScopedController.prototype.handler, signedInRequest()),
        ),
      ),
    ).rejects.toThrow("no such tenant");
  });

  it("records the person as well as the tenant", async () => {
    const guard = new TenantContextGuard(new Reflector(), resolverDouble());

    await runWithTenantContext(async () => {
      await guard.canActivate(
        contextFor(ScopedController, ScopedController.prototype.handler, signedInRequest()),
      );

      expect(currentUser()).toEqual(USER);
    });
  });

  it("skips resolution when the path's tenant id is not a uuid", async () => {
    // Malformed, not invisible: the validation pipe answers, and it is what produces the
    // `details.tenantId` a form renders. Resolving first would make the answer depend on how
    // many workspaces the caller belongs to.
    const resolver = resolverDouble();
    const guard = new TenantContextGuard(new Reflector(), resolver);

    const allowed = await runWithTenantContext(() =>
      guard.canActivate(
        contextFor(
          ScopedController,
          ScopedController.prototype.handler,
          signedInRequest({ params: { tenantId: "not-a-uuid" } }),
        ),
      ),
    );

    expect(allowed).toBe(true);
    expect(resolver.resolve).not.toHaveBeenCalled();
  });
});

describe("a route marked @TenantOptional()", () => {
  it("is allowed with no tenant at all", async () => {
    const resolver = resolverDouble();
    const guard = new TenantContextGuard(new Reflector(), resolver);

    const allowed = await runWithTenantContext(() =>
      guard.canActivate(
        contextFor(OptionalController, OptionalController.prototype.handler, signedInRequest()),
      ),
    );

    expect(allowed).toBe(true);
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it("still records the person, because that is what scopes the tenant listing", async () => {
    const guard = new TenantContextGuard(new Reflector(), resolverDouble());

    await runWithTenantContext(async () => {
      await guard.canActivate(
        contextFor(OptionalController, OptionalController.prototype.handler, signedInRequest()),
      );

      expect(currentUser()).toEqual(USER);
      expect(currentMembership()).toBeUndefined();
    });
  });
});

describe("a route marked @AllowAnonymous()", () => {
  it("is allowed, and nothing is recorded", async () => {
    const resolver = resolverDouble();
    const guard = new TenantContextGuard(new Reflector(), resolver);

    await runWithTenantContext(async () => {
      expect(
        await guard.canActivate(
          contextFor(AnonymousController, AnonymousController.prototype.handler, {}),
        ),
      ).toBe(true);

      expect(currentUser()).toBeUndefined();
      expect(resolver.resolve).not.toHaveBeenCalled();
    });
  });
});

describe("a request with no principal on a scoped route", () => {
  it("is allowed through, because refusing it is the authentication guard's job", async () => {
    // Unreachable through the pipeline. Checked because "the guard before me ran" is an
    // assumption about registration order, and if it were ever wrong the failure mode would
    // be a tenant resolved for nobody.
    const resolver = resolverDouble();
    const guard = new TenantContextGuard(new Reflector(), resolver);

    const allowed = await runWithTenantContext(() =>
      guard.canActivate(contextFor(ScopedController, ScopedController.prototype.handler, {})),
    );

    expect(allowed).toBe(true);
    expect(resolver.resolve).not.toHaveBeenCalled();
  });
});
