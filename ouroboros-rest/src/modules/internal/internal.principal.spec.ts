import { Reflector } from "@nestjs/core";

import { testConfiguration } from "../config/configuration.fixture";
import { AppConfigService } from "../config/config.service";
import { CallingPrincipal, InternalOnly } from "./internal.decorators";
import { INTERNAL_KEY_HEADER } from "../engine/engine.contract";
import { InternalKeyGuard, type InternalRequest } from "./internal.guard";
import {
  INTERNAL_PRINCIPALS,
  INTERNAL_PRINCIPAL_PROPERTY,
  isSimulatedPrincipal,
} from "./internal.principal";

/**
 * Who is on the other end, and the one acceptance criterion that is about identity:
 *
 * > `simulated` cannot be cleared by a client claim; it follows the principal.
 *
 * The mechanism is a second accepted secret, because on this channel a caller proves exactly
 * one thing — which secret it holds — so a second principal needs a second secret. What is
 * asserted here is that the guard **records** which one it admitted, that a deployment with
 * no simulator has no simulated principal at all, and that a route nothing authenticated
 * cannot be asked who called.
 *
 * `configuration.spec.ts` holds the other half: a deployment whose two secrets are equal does
 * not boot, because two principals presenting one proof are one principal.
 */

/** The configuration these tests run against, with a simulator secret set. */
const SIMULATOR_SECRET = "dev-run-simulator-secret-change-me";

/**
 * A guard over a configuration, built through `AppConfigService`'s own reader.
 *
 * Through the real class over a stand-in `ConfigService` rather than an object literal with
 * the two field names on it — `internal.guard.spec.ts` does the same, and here there is a
 * second reason: the lint rule over this directory refuses a property naming credential
 * material anywhere in it, which is exactly the rule working.
 *
 * @param simulator - What `OURO_RUN_SIMULATOR_SECRET` holds, or `undefined` for a deployment
 *   that runs no simulator. Passed explicitly at every call rather than defaulted, because a
 *   default parameter applies to an explicit `undefined` too — which would have made the
 *   deployment-with-no-simulator case silently the same as every other one.
 * @returns The guard.
 */
function guardWith(simulator: string | undefined): InternalKeyGuard {
  const values: Record<string, string | undefined> = {
    engineSharedSecret: testConfiguration().engineSharedSecret,
    runSimulatorSecret: simulator,
  };

  return new InternalKeyGuard(
    new Reflector(),
    new AppConfigService({
      getOrThrow: (name: string) => values[name],
      get: (name: string) => values[name],
    } as never),
  );
}

/** A context carrying one header value, on an `@InternalOnly()` route. */
function contextFor(request: InternalRequest) {
  @InternalOnly()
  class Guarded {
    handle(): void {}
  }

  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => Guarded.prototype.handle,
    getClass: () => Guarded,
  } as never;
}

describe("the two principals", () => {
  it("names both, and nothing else", () => {
    // Closed, and deliberately not an open string: the value reaches `runs.simulated`, and a
    // third word would be a third meaning for a boolean column that has two.
    expect([...INTERNAL_PRINCIPALS]).toEqual(["executor", "simulator"]);
  });

  it("maps exactly one of them to the watermark", () => {
    expect(isSimulatedPrincipal("simulator")).toBe(true);
    expect(isSimulatedPrincipal("executor")).toBe(false);
  });
});

describe("the guard", () => {
  it("records `executor` for the engine's own secret", () => {
    const request: InternalRequest = {
      headers: { [INTERNAL_KEY_HEADER.toLowerCase()]: testConfiguration().engineSharedSecret },
    };

    expect(guardWith(SIMULATOR_SECRET).canActivate(contextFor(request))).toBe(true);
    expect(request[INTERNAL_PRINCIPAL_PROPERTY]).toBe("executor");
  });

  it("records `simulator` for the simulator's secret", () => {
    const request: InternalRequest = {
      headers: { [INTERNAL_KEY_HEADER.toLowerCase()]: SIMULATOR_SECRET },
    };

    expect(guardWith(SIMULATOR_SECRET).canActivate(contextFor(request))).toBe(true);
    expect(request[INTERNAL_PRINCIPAL_PROPERTY]).toBe("simulator");
  });

  it("refuses the simulator's secret when the deployment configures none", () => {
    // Unset means *this deployment runs no simulator*: every run opened through the ingestion
    // contract is a real one, and the simulated principal simply does not exist.
    const guard = guardWith(undefined);
    const request: InternalRequest = {
      headers: { [INTERNAL_KEY_HEADER.toLowerCase()]: SIMULATOR_SECRET },
    };

    expect(() => guard.canActivate(contextFor(request))).toThrow();
    expect(request[INTERNAL_PRINCIPAL_PROPERTY]).toBeUndefined();
  });

  it("records nothing on a request it refuses", () => {
    const request: InternalRequest = {
      headers: { [INTERNAL_KEY_HEADER.toLowerCase()]: "a guess" },
    };

    expect(() => guardWith(SIMULATOR_SECRET).canActivate(contextFor(request))).toThrow();
    expect(request[INTERNAL_PRINCIPAL_PROPERTY]).toBeUndefined();
  });

  it("records nothing on a route that is not internal", () => {
    // A route nothing authenticated has no principal, which is what makes reading one there a
    // programming error rather than a default.
    class Open {
      handle(): void {}
    }

    const request: InternalRequest = {};
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => Open.prototype.handle,
      getClass: () => Open,
    } as never;

    expect(guardWith(SIMULATOR_SECRET).canActivate(context)).toBe(true);
    expect(request[INTERNAL_PRINCIPAL_PROPERTY]).toBeUndefined();
  });
});

describe("reading the principal in a handler", () => {
  /** `@CallingPrincipal()`'s factory, which is what the decorator installs. */
  function factory(request: InternalRequest): unknown {
    const decorator = CallingPrincipal() as unknown as {
      (target: object, key: string, index: number): void;
    };
    // `createParamDecorator` stores its factory on the returned decorator's closure, which is
    // not reachable — so the behaviour is exercised through Nest's own metadata instead: the
    // decorator is applied to a parameter and the factory read back off the class.
    class Handler {
      handle(@decorator principal: unknown): unknown {
        return principal;
      }
    }

    const metadata = Reflect.getMetadata("__routeArguments__", Handler, "handle") as Record<
      string,
      { factory: (data: unknown, context: unknown) => unknown }
    >;
    const [argument] = Object.values(metadata);

    return argument.factory(undefined, {
      switchToHttp: () => ({ getRequest: () => request }),
    });
  }

  it("returns what the guard proved", () => {
    expect(factory({ [INTERNAL_PRINCIPAL_PROPERTY]: "simulator" })).toBe("simulator");
  });

  it("refuses when nothing proved anything", () => {
    // Defaulting to `"executor"` would hand an unauthenticated caller the ability to open real
    // runs. Refusing turns the mistake into a failure at the first request instead of a
    // watermark that is quietly always false.
    expect(() => factory({})).toThrow(/InternalOnly/);
  });
});
