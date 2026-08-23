/**
 * Every route the application registered, and the guard's decision for each.
 *
 * [#703](https://github.com/NobuData/ouroboros/issues/703) built this enumeration and
 * `guard.surface.spec.ts` was its only reader. [#715](https://github.com/NobuData/ouroboros/issues/715)
 * gave it a second — *guard coverage: the route-table enumeration #703 introduces, run here
 * against the real app* — and two readers is what turned it into a file of its own rather
 * than a block copied across a suite boundary.
 *
 * The two suites ask different questions of the same list, and that is the point of sharing
 * it rather than the cost of it:
 *
 *   * `guard.surface.spec.ts` reads the **metadata**, with no database anywhere. It is fast,
 *     it runs on save, and it answers *which routes did somebody mark public*.
 *   * `guard.surface.integration-spec.ts` sends a **request to every one of them**, against a
 *     migrated PostgreSQL and over a socket. It answers *what does a stranger actually get*,
 *     which is the only question a caller cares about and the one metadata cannot settle: a
 *     guard that read the right metadata and then let everybody through satisfies the first
 *     suite completely.
 *
 * A route added later is in both, whether or not anybody thought to add a test.
 *
 * **Three categories, not two** since [#224](https://github.com/NobuData/ouroboros/issues/224).
 * A route is *protected* (needs a session), *public* (needs nothing), or *internal* (needs
 * the shared secret on `X-Ouro-Internal-Key`). The third one had to be named rather than
 * folded into the second: an internal route carries `@AllowAnonymous()` — it must, because
 * the caller is a worker holding no session and the session guard would refuse it before its
 * own guard ran — and calling that *public* would put it in the list both suites assert a
 * stranger can reach. It is the opposite of reachable, and `INTERNAL_SURFACE` below is where
 * that is written down.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import type { INestApplication } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";

import { API_BASE_PATH } from "../../application";
import { HEALTH_PATH, LIVE_ROUTE, READY_ROUTE } from "../health/health.paths";
import { INTERNAL_ONLY } from "../internal/internal.decorators";
import {
  INTERNAL_LEASE_PATH,
  INTERNAL_INVOKE_PATH,
  isInternalPath,
} from "../internal/internal.paths";
import { ALLOW_ANONYMOUS } from "./anonymous";

/**
 * The routes reachable without a session: #33's four, and #712's.
 *
 * Written as `METHOD path` exactly as {@link routeTable} renders one, so the comparison is
 * between two lists of the same strings rather than between a list and a rule.
 *
 * **This list is the specification**, in #703's own words: *every route that
 * `public.decorator.ts` exempted is still exempt, and no route that wasn't became public.*
 * Adding a line to it is how a route becomes public, and the line is the reviewable record of
 * that decision — which is why the argument for each one is beside it and short.
 */
export const SHIPPED_PUBLIC_SURFACE: readonly string[] = [
  // The heartbeat. It says which build is answering and nothing else, and whatever polls it
  // holds no session.
  `GET ${API_BASE_PATH}`,
  // The two probes. Their reader is a container platform, which holds no session and could
  // not be given one — and a probe behind authentication reports the service unhealthy the
  // moment authentication is what is broken.
  `GET /${HEALTH_PATH}/${LIVE_ROUTE}`,
  `GET /${HEALTH_PATH}/${READY_ROUTE}`,
  // Signing out, which is disposing of a session that may already have expired: requiring
  // one would mean an expired cookie could never be cleared.
  `POST ${API_BASE_PATH}/auth/logout`,
  // Domain discovery (#712). It is what mockup 01 Step 1's *Company domain* field calls
  // *before* anybody signs in, so a session is the one thing its caller cannot have. What
  // makes that safe is that it answers every domain identically — see
  // `discovery.service.ts`.
  `POST ${API_BASE_PATH}/auth/discover`,
].sort();

/**
 * The routes that answer to `ouroboros-engine` rather than to a browser
 * ([#224](https://github.com/NobuData/ouroboros/issues/224), decision **P3**).
 *
 * Written the same way `SHIPPED_PUBLIC_SURFACE` is, and read the same way: adding a line is
 * how a route joins the engine-facing surface, and the line is the reviewable record of that
 * decision. What the two lists mean is opposite — every route here refuses a stranger, and
 * the suites assert exactly that — so a route that appeared in both would be one whose
 * classification nobody had settled.
 */
export const INTERNAL_SURFACE: readonly string[] = [
  // The scoped lease. Local-provider connection details only, TTL'd and audited — the one
  // thing a worker is ever handed, and never a credential (`src/modules/internal/lease.ts`).
  `POST ${INTERNAL_LEASE_PATH}`,
  // The invocation proxy. Specified by #224 and implemented by AF.2 (#235); it answers
  // `501` today, behind the same key, so the contract can be built against.
  `POST ${INTERNAL_INVOKE_PATH}`,
].sort();

/** One route, as the enumeration sees it. */
export interface Route {
  /** `METHOD path`, from the origin root. */
  readonly signature: string;
  /** The verb, ready to be sent. */
  readonly method: string;
  /** The path, from the origin root, still carrying its `:name` parameters. */
  readonly path: string;
  /** Whether the session guard would let a request with no session through. */
  readonly anonymous: boolean;
  /**
   * Whether the route is part of the engine-facing surface.
   *
   * Always accompanied by {@link Route.anonymous}, and never a substitute for it: an internal
   * route is *exempt from the session* and *guarded by the shared secret*, which is two
   * decisions rather than one. Reading the two flags together is what lets a suite say the
   * true thing about all three categories.
   */
  readonly internal: boolean;
}

/** Nest's numeric `RequestMethod`, as a verb. Indexed by the enum's own values. */
const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "ALL", "OPTIONS", "HEAD", "SEARCH"];

/**
 * Every route the application registered, with the guard's decision for each.
 *
 * `DiscoveryService` is asked for the controllers rather than a list being imported,
 * because an imported list is a list somebody has to remember to add to — which is the
 * failure this whole enumeration exists to catch. `MetadataScanner` then walks each
 * controller's prototype for handlers, and the two path halves are read from the same
 * metadata keys Nest's own router reads.
 *
 * **BetterAuth's own routes are not in it**, and that is not an omission: the library mounts
 * one handler on the HTTP adapter ahead of Nest's router, so `/api/auth/*` never reaches the
 * routing table this walks. `auth.routes.ts` is their map, and the suites that exercise them
 * are `credentials.integration-spec.ts`, `github.integration-spec.ts` and
 * `organizations.integration-spec.ts`. Swagger UI and the two specification routes are
 * absent for the same reason — registered on the adapter, seen by no guard.
 *
 * @param app - The initialised application.
 * @returns One entry per handler, sorted by signature.
 */
export function routeTable(app: INestApplication): Route[] {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);
  const routes: Route[] = [];

  for (const wrapper of discovery.getControllers()) {
    const controller = wrapper.metatype;

    if (controller === undefined || controller === null) {
      continue;
    }

    const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? "");

    for (const name of scanner.getAllMethodNames(controller.prototype as object)) {
      const handler = (controller.prototype as Record<string, () => unknown>)[name];
      const path = String(Reflect.getMetadata(PATH_METADATA, handler) ?? "");
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;

      if (method === undefined) {
        continue;
      }

      const full = fullPath(base, path);

      routes.push({
        signature: `${METHODS[method]} ${full}`,
        method: METHODS[method],
        path: full,
        // The same read the guard makes, through the same helper: handler first, then the
        // controller, so a class-level exemption covers its handlers.
        anonymous:
          reflector.getAllAndOverride<boolean | undefined>(ALLOW_ANONYMOUS, [
            handler,
            controller,
          ]) === true,
        // The same read `InternalKeyGuard` makes, through the same key — see
        // `src/modules/internal/internal.decorators.ts` for why the guard is driven by
        // metadata rather than by `@UseGuards()` on a controller somebody might forget.
        internal:
          reflector.getAllAndOverride<boolean | undefined>(INTERNAL_ONLY, [handler, controller]) ===
          true,
      });
    }
  }

  return routes.sort((left, right) => left.signature.localeCompare(right.signature));
}

/**
 * Where a route answers, from the origin root.
 *
 * The health controller is `VERSION_NEUTRAL` and its path is excluded from the global
 * prefix, so it answers at the root; the two internal controllers are the same
 * ([#224](https://github.com/NobuData/ouroboros/issues/224)); everything else sits under
 * `/api/v1`. Those are enumerated cases rather than a general rule, because each one is a
 * decision somebody made and argued —  `src/modules/health/health.paths.ts` and
 * `src/modules/internal/internal.paths.ts` are where. A fourth would be another such
 * decision, not a pattern to be inferred.
 *
 * @param base - The controller's own path segment.
 * @param path - The handler's.
 * @returns The path a client writes.
 */
export function fullPath(base: string, path: string): string {
  const segments = [base, path].filter((segment) => segment !== "" && segment !== "/");
  const prefix = base === HEALTH_PATH || isInternalPath(base) ? "" : API_BASE_PATH;
  const joined = segments.join("/");

  return joined === "" ? prefix : `${prefix}/${joined}`;
}
