import { API_PREFIX, API_VERSION } from "../application";
import { PROBE_PATHS } from "../modules/health/health.paths";
import { AUTH_BASE_PATH } from "./auth.options";
import { AUTH_PREFIX_EXCLUSIONS, AUTH_ROUTES } from "./auth.routes";

/**
 * The route map, held to the shape the rest of the service assumes of it.
 *
 * It is a document more than it is code — [#711](https://github.com/NobuData/ouroboros/issues/711)
 * publishes these paths and `ouroboros-ui` calls them — so what is worth asserting is the
 * things a document drifts on: a path that stopped agreeing with the base path it is built
 * from, a route the issue named that quietly left, an exclusion that no longer covers the
 * subtree it is supposed to.
 *
 * That the paths are the library's own is established outside this file, by reading them
 * off a real instance (`auth.routes.ts` says so); that they answer is
 * `application.spec.ts`.
 */

/** The four routes the issue names, which are the four a sign-in needs end to end. */
const REQUIRED = ["/sign-in/social", "/callback/:id", "/get-session", "/sign-out"];

describe("the route map", () => {
  it("is not empty", () => {
    expect(AUTH_ROUTES).not.toHaveLength(0);
  });

  it.each(REQUIRED)("documents %s, which the login flow cannot be completed without", (path) => {
    expect(AUTH_ROUTES.map((route) => route.path)).toContain(`${AUTH_BASE_PATH}${path}`);
  });

  it("names every path from the one base path, so a move moves all of them", () => {
    for (const route of AUTH_ROUTES) {
      expect(route.path.startsWith(`${AUTH_BASE_PATH}/`)).toBe(true);
    }
  });

  it("sits beside the versioned API rather than inside it", () => {
    // The library versions its own routes. A second version number in the path would be a
    // promise this service is not the one keeping — see `auth.options.ts`.
    expect(AUTH_BASE_PATH.startsWith(`/${API_PREFIX}/`)).toBe(true);
    expect(AUTH_BASE_PATH).not.toContain(`/v${API_VERSION}`);
  });

  it("says what each route is for", () => {
    // The map exists to be read. A row with no purpose is a row #711 would publish as a
    // bare path.
    for (const route of AUTH_ROUTES) {
      expect(route.purpose.length).toBeGreaterThan(0);
      expect(route.methods).not.toHaveLength(0);
    }
  });

  it("lists no path twice", () => {
    const paths = AUTH_ROUTES.map((route) => `${route.methods.join(",")} ${route.path}`);

    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("the global-prefix exclusions", () => {
  it("cover the base path and everything under it", () => {
    // Two entries because Nest matches an exclusion as a pattern rather than as a prefix.
    // One of them alone would leave either `/api/auth` or every route below it inside the
    // `/api/v1` prefix.
    expect(AUTH_PREFIX_EXCLUSIONS).toEqual([AUTH_BASE_PATH, `${AUTH_BASE_PATH}/*path`]);
  });

  it("cover every route the map documents", () => {
    const subtree = AUTH_PREFIX_EXCLUSIONS.find((pattern) => pattern.endsWith("/*path"));

    expect(subtree).toBeDefined();
    for (const route of AUTH_ROUTES) {
      expect(route.path.startsWith(subtree!.replace("/*path", "/"))).toBe(true);
    }
  });

  it("does not overlap the health probes, which are excluded for a different reason", () => {
    // Both lists end up in the same `exclude` argument. Overlapping them would not break
    // anything, but it would mean one of the two was no longer the whole story about the
    // paths it names.
    for (const probe of PROBE_PATHS) {
      expect(AUTH_PREFIX_EXCLUSIONS).not.toContain(probe);
      expect(probe.startsWith(AUTH_BASE_PATH)).toBe(false);
    }
  });
});
