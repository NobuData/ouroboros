import { API_PREFIX, API_VERSION } from "../application";
import { PROBE_PATHS } from "../modules/health/health.paths";
import { AUTH_BASE_PATH } from "./auth.options";
import { AUTH_PREFIX_EXCLUSIONS, AUTH_ROUTES, GITHUB_CALLBACK_PATH } from "./auth.routes";
import { GITHUB_PROVIDER_ID } from "./github.provider";

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

/**
 * The three [#704](https://github.com/NobuData/ouroboros/issues/704) names, which are the
 * three mockup 01 Step 2 cannot be built without: list what somebody belongs to, make one,
 * and choose which the session acts in.
 */
const ORGANIZATION_REQUIRED = [
  "/organization/list",
  "/organization/create",
  "/organization/set-active",
];

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

describe("the organization routes (#704)", () => {
  it.each(ORGANIZATION_REQUIRED)("documents %s, which mockup 01 Step 2 is built on", (path) => {
    expect(AUTH_ROUTES.map((route) => route.path)).toContain(`${AUTH_BASE_PATH}${path}`);
  });

  it("serves them from the plugin's own prefix, not a second one of ours", () => {
    // The plugin mounts everything it serves under `/organization`, inside the auth base
    // path. A route documented anywhere else would be one this service had decided to
    // proxy — which is the shape #711 has to publish and #713 has to reason about, so it is
    // worth knowing it is not happening.
    const organizationRoutes = AUTH_ROUTES.filter((route) => route.path.includes("/organization"));

    expect(organizationRoutes).not.toHaveLength(0);
    for (const route of organizationRoutes) {
      expect(route.path.startsWith(`${AUTH_BASE_PATH}/organization/`)).toBe(true);
    }
  });

  it("reads the list and writes with a post, as the plugin does", () => {
    // Not pedantry: `ouroboros-ui` calls these through the BetterAuth client, which picks
    // the verb from its own route table. A map that said `POST /organization/list` would
    // send #711 and the UI in different directions.
    const verbOf = (path: string) =>
      AUTH_ROUTES.find((route) => route.path === `${AUTH_BASE_PATH}${path}`)?.methods;

    expect(verbOf("/organization/list")).toEqual(["GET"]);
    expect(verbOf("/organization/get-full-organization")).toEqual(["GET"]);
    expect(verbOf("/organization/create")).toEqual(["POST"]);
    expect(verbOf("/organization/set-active")).toEqual(["POST"]);
    expect(verbOf("/organization/invite-member")).toEqual(["POST"]);
    expect(verbOf("/organization/update-member-role")).toEqual(["POST"]);
  });

  it("documents the invitation route without promising an email", () => {
    // #724 is the delivery. A purpose that read "invites somebody" would have #711 publish
    // a route the product does not yet have, and mockup 17 would grow a button that
    // silently does nothing.
    const invite = AUTH_ROUTES.find(
      (route) => route.path === `${AUTH_BASE_PATH}/organization/invite-member`,
    );

    expect(invite?.purpose).toContain("724");
  });
});

describe("the GitHub callback", () => {
  it("is the URL an OAuth App is registered against", () => {
    // Three places have to carry this string and only one of them is code: github.com's
    // application settings for development and for production, the README, and here. A
    // difference of one character is a sign-in that fails at the last hop.
    expect(GITHUB_CALLBACK_PATH).toBe("/api/auth/callback/github");
  });

  it("is composed from the provider id, so the callback and account.providerId agree", () => {
    // The same string is `account.providerId` — the column #706's back-fill wrote
    // `user_identities.provider` into. Typing it twice is how a rename becomes a sign-in
    // that creates a second person instead of finding the first.
    expect(GITHUB_CALLBACK_PATH).toBe(`${AUTH_BASE_PATH}/callback/${GITHUB_PROVIDER_ID}`);
  });

  it("is an instance of the parameterised route the map documents", () => {
    const documented = AUTH_ROUTES.find((route) => route.path === `${AUTH_BASE_PATH}/callback/:id`);

    expect(documented).toBeDefined();
    expect(GITHUB_CALLBACK_PATH.startsWith(`${AUTH_BASE_PATH}/callback/`)).toBe(true);
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
