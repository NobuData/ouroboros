/**
 * The docs coverage gate's reading and comparing (DE.4): which product routes exist, which
 * page documents each, and what has drifted.
 *
 * A rule nobody checks erodes. `docs-coverage.json` maps every route of `ouroboros-ui` — each
 * `page.tsx` under its `(app)`, `(auth)` and `(wizard)` route groups — to the doc page that
 * documents it, or records why none does. {@link checkRoutes} reports every route with no
 * mapping, every mapping to a page that does not exist, and every mapping to a route that no
 * longer does. `scripts/check-coverage.ts` is the command; it adds the configuration
 * reference's and the CLI flag check's own comparisons, so one command answers whether a route,
 * a variable or a flag shipped undocumented.
 *
 * Pure functions only — no file system — so every rule is testable from strings.
 */

/** The Next.js route groups whose pages a person can open. */
export const ROUTE_GROUPS = ["(app)", "(auth)", "(wizard)"] as const;

/** Routes under this prefix are internal workshop pages, which never get a doc page. */
export const WORKSHOP_PREFIX = "/workshop/";

/** What a route maps to: the id of the page that documents it, or why no page does. */
export type Mapping = { readonly page: string } | { readonly undocumented: string };

/** One disagreement between the routes, the mapping and the pages. */
export interface CoverageProblem {
  /** The route, e.g. `/runs/[id]`. */
  route: string;
  /** What is wrong, as one line naming the fix. */
  message: string;
}

/**
 * Turns a `page.tsx` path under the UI's `app/` directory into the route it serves.
 *
 * Route groups — a segment in parentheses — name nothing in the URL, and are dropped. Dynamic
 * segments keep their brackets, so `(app)/runs/[id]/page.tsx` is `/runs/[id]`.
 *
 * @param file the path relative to `ouroboros-ui/app/`, with `/` separators.
 * @returns the route, or `undefined` when the file is not a `page.tsx` under one of
 *   {@link ROUTE_GROUPS}.
 */
export function routeOf(file: string): string | undefined {
  const segments = file.split("/");
  if (segments.at(-1) !== "page.tsx") return undefined;
  if (!(ROUTE_GROUPS as readonly string[]).includes(segments[0])) return undefined;
  const named = segments.slice(0, -1).filter((segment) => !/^\(.*\)$/.test(segment));
  return `/${named.join("/")}`;
}

/**
 * Lists the routes a set of files serves.
 *
 * @param files paths relative to `ouroboros-ui/app/`.
 * @returns the routes, sorted and without duplicates.
 */
export function routesOf(files: readonly string[]): string[] {
  const routes = new Set<string>();
  for (const file of files) {
    const route = routeOf(file);
    if (route !== undefined) routes.add(route);
  }
  return [...routes].sort();
}

/**
 * Reads `docs-coverage.json`.
 *
 * The file is an object whose `routes` member maps each route to a page id (a string, the
 * page's path under `docs/` without its extension) or to `{ "undocumented": "<reason>" }`.
 *
 * @param text the file's text.
 * @returns each route's mapping.
 * @throws {Error} when the text is not that shape, naming the route or member at fault — a
 *   malformed file must not read as "nothing to check".
 */
export function parseCoverage(text: string): Map<string, Mapping> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`docs-coverage.json is not JSON: ${(error as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("docs-coverage.json must be an object with a routes member");
  }
  const routes = (parsed as { routes?: unknown }).routes;
  if (typeof routes !== "object" || routes === null || Array.isArray(routes)) {
    throw new Error("docs-coverage.json needs a routes object");
  }

  const mappings = new Map<string, Mapping>();
  for (const [route, value] of Object.entries(routes as Record<string, unknown>)) {
    if (!route.startsWith("/")) throw new Error(`route "${route}" must start with /`);
    if (typeof value === "string") {
      if (value === "") throw new Error(`route ${route} maps to an empty page id`);
      mappings.set(route, { page: value });
      continue;
    }
    const reason =
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as { undocumented?: unknown }).undocumented
        : undefined;
    if (typeof reason !== "string" || reason.trim() === "") {
      throw new Error(`route ${route} must map to a page id or to {"undocumented": "<reason>"}`);
    }
    mappings.set(route, { undocumented: reason });
  }
  return mappings;
}

/**
 * Compares the routes that exist with the mapping and the pages.
 *
 * @param routes every route the UI serves, from {@link routesOf}.
 * @param coverage the mapping, from {@link parseCoverage}.
 * @param pageExists whether a page id names a page under `docs/`.
 * @returns every problem, routes in order; empty when every route is accounted for.
 */
export function checkRoutes(
  routes: readonly string[],
  coverage: ReadonlyMap<string, Mapping>,
  pageExists: (id: string) => boolean,
): CoverageProblem[] {
  const problems: CoverageProblem[] = [];
  for (const route of routes) {
    const mapping = coverage.get(route);
    if (mapping === undefined) {
      problems.push({
        route,
        message:
          'no entry in docs-coverage.json — map it to a page id, or to {"undocumented": "<reason>"}',
      });
      continue;
    }
    if ("undocumented" in mapping) continue;
    if (route.startsWith(WORKSHOP_PREFIX)) {
      problems.push({
        route,
        message: 'a workshop route must be {"undocumented": "<reason>"}, not a page',
      });
      continue;
    }
    if (!pageExists(mapping.page)) {
      problems.push({
        route,
        message: `maps to ${mapping.page}, and docs/${mapping.page}.mdx does not exist`,
      });
    }
  }
  const existing = new Set(routes);
  for (const route of coverage.keys()) {
    if (!existing.has(route)) {
      problems.push({ route, message: "is in docs-coverage.json but no page.tsx serves it" });
    }
  }
  return problems;
}
