import { Controller, Get, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

import { ALLOW_ANONYMOUS, isAnonymous } from "./anonymous";

/**
 * The library's metadata key, held to the library.
 *
 * `ALLOW_ANONYMOUS` is a string this service writes down because the library does not
 * export it, and that is a real risk: the day an upgrade renames the key, every
 * `@AllowAnonymous()` in the service still compiles, the authentication guard still honours
 * it — and `TenantContextGuard` stops honouring it, which would put the health probes
 * behind tenant resolution. So the constant is not asserted against a literal here. It is
 * asserted against the decorator, by applying it and reading the metadata back.
 */

@Controller("exempt")
@AllowAnonymous()
class AnonymousController {
  @Get()
  handler(): void {}
}

@Controller("protected")
class ProtectedController {
  @Get()
  handler(): void {}

  @AllowAnonymous()
  @Get("open")
  open(): void {}
}

/**
 * An execution context over a class and one of its methods.
 *
 * @param target - The controller and the handler to report.
 * @returns Enough of a context for `Reflector.getAllAndOverride`.
 */
function contextFor(target: { controller: unknown; handler: unknown }): ExecutionContext {
  return {
    getClass: () => target.controller,
    getHandler: () => target.handler,
  } as ExecutionContext;
}

describe("the key @AllowAnonymous() writes under", () => {
  it("is the one this service reads", () => {
    // Applied to a real class by the real decorator, then read back with the constant. A
    // library upgrade that renames the key fails here rather than in production.
    expect(new Reflector().get(ALLOW_ANONYMOUS, AnonymousController)).toBe(true);
  });

  it("is absent from a controller that did not ask for it", () => {
    expect(new Reflector().get(ALLOW_ANONYMOUS, ProtectedController)).toBeUndefined();
  });
});

describe("deciding whether a route is anonymous", () => {
  const reflector = new Reflector();

  it("says yes for a handler inside an exempt controller", () => {
    const context = contextFor({
      controller: AnonymousController,
      handler: AnonymousController.prototype.handler,
    });

    expect(isAnonymous(reflector, context)).toBe(true);
  });

  it("says yes for an exempt handler inside a protected controller", () => {
    // The handler is read first, which is what makes one open route inside an otherwise
    // authenticated controller expressible.
    const context = contextFor({
      controller: ProtectedController,
      handler: ProtectedController.prototype.open,
    });

    expect(isAnonymous(reflector, context)).toBe(true);
  });

  it("says no for a handler nobody exempted", () => {
    const context = contextFor({
      controller: ProtectedController,
      handler: ProtectedController.prototype.handler,
    });

    expect(isAnonymous(reflector, context)).toBe(false);
  });
});
