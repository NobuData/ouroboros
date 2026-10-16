import { Controller, Get, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { ALLOW_HELD_ACCOUNT, AllowHeldAccount, allowsHeldAccount } from "./held.account";

/** `@AllowHeldAccount()` — the one exemption from account approval's refusal. */

@Controller()
class Routes {
  @AllowHeldAccount()
  @Get()
  open(): void {}

  @Get()
  closed(): void {}
}

@AllowHeldAccount()
@Controller()
class OpenClass {
  @Get()
  any(): void {}
}

/** A context for one handler of one class. */
function contextFor(handler: () => void, type: object): ExecutionContext {
  return { getHandler: () => handler, getClass: () => type } as unknown as ExecutionContext;
}

describe("@AllowHeldAccount()", () => {
  const reflector = new Reflector();

  it("marks a handler under a namespaced key", () => {
    expect(ALLOW_HELD_ACCOUNT).toBe("ouroboros:auth:allow-held-account");
    expect(allowsHeldAccount(reflector, contextFor(Routes.prototype.open, Routes))).toBe(true);
  });

  it("leaves every other route closed to a held account", () => {
    expect(allowsHeldAccount(reflector, contextFor(Routes.prototype.closed, Routes))).toBe(false);
  });

  it("covers every route of a class it is applied to", () => {
    expect(allowsHeldAccount(reflector, contextFor(OpenClass.prototype.any, OpenClass))).toBe(true);
  });
});
