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
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import type { INestApplication } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";

import { API_BASE_PATH } from "../../application";
import { HEALTH_PATH, LIVE_ROUTE, READY_ROUTE } from "../health/health.paths";
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

/** One route, as the enumeration sees it. */
export interface Route {
  /** `METHOD path`, from the origin root. */
  readonly signature: string;
  /** The verb, ready to be sent. */
  readonly method: string;
  /** The path, from the origin root, still carrying its `:name` parameters. */
  readonly path: string;
  /** Whether the guard would let a request with no session through. */
  readonly anonymous: boolean;
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
      });
    }
  }

  return routes.sort((left, right) => left.signature.localeCompare(right.signature));
}

/**
 * Where a route answers, from the origin root.
 *
 * The health controller is `VERSION_NEUTRAL` and its path is excluded from the global
 * prefix, so it answers at the root; everything else sits under `/api/v1`. That is two
 * cases rather than a general rule because there are two cases —
 * `src/modules/health/health.paths.ts` is the list, and a third would be a decision
 * somebody made rather than a pattern to be inferred.
 *
 * @param base - The controller's own path segment.
 * @param path - The handler's.
 * @returns The path a client writes.
 */
export function fullPath(base: string, path: string): string {
  const segments = [base, path].filter((segment) => segment !== "" && segment !== "/");
  const prefix = base === HEALTH_PATH ? "" : API_BASE_PATH;
  const joined = segments.join("/");

  return joined === "" ? prefix : `${prefix}/${joined}`;
}
