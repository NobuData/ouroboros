import { Controller, Get, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { INTERNAL_ONLY, InternalOnly, isInternalOnly } from "./internal.decorators";

/**
 * The marker, and the precedence it is read with.
 *
 * `anonymous.spec.ts` asserts the same two things about `@AllowAnonymous()`, and for the same
 * reason: a guard driven by metadata is only as good as the read, and the read is written
 * once so that the route table and the guard cannot disagree about what a decorator meant.
 *
 * The key is asserted as a literal string, because it is namespaced deliberately —
 * `Reflector` metadata is one flat space shared with every library in the process — and a
 * rename that lost the prefix would be a collision waiting for a library that picks the same
 * bare word.
 */

/** An execution context over a handler and its class, which is all the reader looks at. */
function contextOf(target: object, handler: () => unknown): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => target,
  } as unknown as ExecutionContext;
}

describe("the decorator", () => {
  it("writes a namespaced key", () => {
    expect(INTERNAL_ONLY).toBe("ouroboros:internal:only");
  });

  it("sets it to true where it is applied", () => {
    @InternalOnly()
    class Guarded {}

    expect(Reflect.getMetadata(INTERNAL_ONLY, Guarded)).toBe(true);
  });
});

describe("reading it", () => {
  const reflector = new Reflector();

  it("finds a controller-level marker from any of its handlers", () => {
    // The shape both internal controllers use: the decorator is on the class, so a route
    // added beside an existing one inherits the classification rather than having to
    // remember it.
    @InternalOnly()
    @Controller("internal/example")
    class Surface {
      @Get()
      read(): string {
        return "";
      }
    }

    expect(isInternalOnly(reflector, contextOf(Surface, Surface.prototype.read))).toBe(true);
  });

  it("finds a handler-level marker inside an unmarked controller", () => {
    class Mixed {
      @InternalOnly()
      internal(): string {
        return "";
      }

      browser(): string {
        return "";
      }
    }

    expect(isInternalOnly(reflector, contextOf(Mixed, Mixed.prototype.internal))).toBe(true);
    expect(isInternalOnly(reflector, contextOf(Mixed, Mixed.prototype.browser))).toBe(false);
  });

  it("answers false for a route nobody marked", () => {
    // The default, and the safe one: an undecorated route is a browser route, which the
    // session guard already protects. The opposite default would make every new controller
    // reachable with a shared secret instead of a session.
    class Ordinary {
      read(): string {
        return "";
      }
    }

    expect(isInternalOnly(reflector, contextOf(Ordinary, Ordinary.prototype.read))).toBe(false);
  });
});
