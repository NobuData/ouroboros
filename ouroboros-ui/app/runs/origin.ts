/**
 * Where a run console was opened from ([#309](https://github.com/NobuData/ouroboros/issues/309)).
 *
 * The console is a **contextual surface** (`docs/DESIGN_SYSTEM_APP_SHELL.md`): it has no
 * sidebar entry of its own, keeps the originating module's entry lit, and orients the reader
 * with a breadcrumb back to it instead. Both need to know the origin, and the URL is the one
 * place that survives a refresh or a shared link — so a link here carries it in
 * `?from=` (`runPath` in `app/paths.ts`) and this module reads it back.
 *
 * **Only the modules that link here are accepted.** The value arrives in a URL, so it is
 * whatever anyone cared to type; an allow-list means a hand-edited `?from=` can light no entry
 * but these and can put no link in the breadcrumb but theirs.
 *
 * Framework-free and value-only, so the page (a Server Component) and the screen (a client one)
 * read the same table.
 */

import { BUILD_FARM_PATH, DASHBOARD_PATH, ISSUES_PATH, WORKFLOWS_PATH } from "@/app/paths";

/** A module a run console may be opened from. */
export interface RunOrigin {
  /** The sidebar entry's id (`app/shell/nav-modules.ts`) — what stays lit. */
  readonly id: string;
  /** The module's name, as the breadcrumb prints it. */
  readonly label: string;
  /** Where the breadcrumb leads back to. */
  readonly route: string;
}

/** The dashboard — its active-loops rows are the console's first way in, and the default. */
export const DASHBOARD_ORIGIN: RunOrigin = Object.freeze({
  id: "dashboard",
  label: "Dashboard",
  route: DASHBOARD_PATH,
});

/** The build farm — its current-job cells open the run a build belongs to. */
export const BUILD_FARM_ORIGIN: RunOrigin = Object.freeze({
  id: "build-farm",
  label: "Build Farm",
  route: BUILD_FARM_PATH,
});

/** Issues — the intake screen. */
export const ISSUES_ORIGIN: RunOrigin = Object.freeze({
  id: "issues",
  label: "Issues",
  route: ISSUES_PATH,
});

/** Workflows — the studio. */
export const WORKFLOWS_ORIGIN: RunOrigin = Object.freeze({
  id: "workflows",
  label: "Workflows",
  route: WORKFLOWS_PATH,
});

/** Every accepted origin, by the id `?from=` carries. */
const ORIGINS: ReadonlyMap<string, RunOrigin> = new Map(
  [DASHBOARD_ORIGIN, BUILD_FARM_ORIGIN, ISSUES_ORIGIN, WORKFLOWS_ORIGIN].map((origin) => [
    origin.id,
    origin,
  ]),
);

/**
 * Read the `?from=` parameter as an origin.
 *
 * @param value The raw parameter as Next.js hands it over — a string, several of them when the
 *   parameter was repeated, or `undefined` when absent.
 * @returns The named origin when it is one of the accepted modules, otherwise
 *   {@link DASHBOARD_ORIGIN}: a console opened from a pasted link belongs to the dashboard,
 *   which is where the loops it shows are listed.
 */
export function runOrigin(value: string | readonly string[] | undefined): RunOrigin {
  const first = typeof value === "string" ? value : value?.[0];

  return (first === undefined ? undefined : ORIGINS.get(first)) ?? DASHBOARD_ORIGIN;
}
