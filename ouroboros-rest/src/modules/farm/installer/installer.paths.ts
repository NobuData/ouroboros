/**
 * Where the runner installer answers — written once, because five things agree about it.
 *
 * AG.6 ([#248](https://github.com/NobuData/ouroboros/issues/248)). The two controllers declare
 * these routes, `src/application.ts` excludes them from the global `/api` prefix,
 * `openapi.yaml` describes them, `route.table.fixture.ts` recognises them, and the command the
 * build farm's enroll card renders ([#258](https://github.com/NobuData/ouroboros/issues/258))
 * calls the first of them. A path that moved in one of those places and not the others is a
 * one-liner that downloads nothing, so there is one definition and everything reads it — as
 * `health.paths.ts` does for the probes and `internal.paths.ts` for the engine's surface.
 *
 * **They sit at the origin root, outside `/api/v1`, and that is the load-bearing decision
 * here.** Their reader is `curl` on a build machine, piping a script into `sh`: it holds no
 * session, speaks no API version, and is written into a command somebody copies once and
 * pastes onto a machine that may not be upgraded for years. `https://<deployment>/install.sh`
 * is the shape that command has everywhere else in the industry, and a version in its path
 * would be a version of this API the installer has to outlive. The release files beside it are
 * addressed by the *agent's* version instead, which is the one that matters to them.
 *
 * They are the deployment's own paths on purpose. Mockup 08 shows `get.ouroboros.dev`, which
 * is design shorthand: a self-hosted deployment behind a firewall installs its runners from
 * itself, and trusts no public host for a binary that runs on its build machines.
 */

/** The installer script's route, from the origin root — also its controller's path. */
export const INSTALL_SCRIPT_ROUTE = "install.sh";

/** The path segment the release files sit under — their controller's path. */
export const RELEASES_ROUTE = "runner";

/** Route of one release file, relative to {@link RELEASES_ROUTE}. */
export const RELEASE_FILE_ROUTE = ":version/:file";

/** The installer, as a build machine calls it: `/install.sh`. */
export const INSTALL_SCRIPT_PATH = `/${INSTALL_SCRIPT_ROUTE}`;

/**
 * One release file, as the installer calls it: `/runner/<version>/<file>` — the pattern
 * `setGlobalPrefix` is told to leave alone.
 */
export const RELEASE_FILE_PATH = `/${RELEASES_ROUTE}/${RELEASE_FILE_ROUTE}`;

/**
 * Both installer paths.
 *
 * The list `src/application.ts` adds to `setGlobalPrefix`'s exclusions, and the list the
 * specification suite allows outside the versioned base path — so the routes that escape
 * `/api/v1` stay enumerated rather than being whatever a controller happened to opt out of.
 */
export const INSTALLER_PATHS = [INSTALL_SCRIPT_PATH, RELEASE_FILE_PATH] as const;

/**
 * Is this controller path one of the installer's?
 *
 * @param base - A controller's own path segment, as Nest records it.
 * @returns `true` for the two controllers above, which answer at the origin root.
 */
export function isInstallerBase(base: string): boolean {
  return base === INSTALL_SCRIPT_ROUTE || base === RELEASES_ROUTE;
}

/**
 * Is this path one of the installer's, as a client or the specification writes it?
 *
 * @param path - `/install.sh`, `/runner/0.5.0/SHA256SUMS`, `/runner/{version}/{file}` — or
 *   anything else, which is not.
 * @returns `true` for the installer and every release file under it.
 */
export function isInstallerPath(path: string): boolean {
  return path === INSTALL_SCRIPT_PATH || path.startsWith(`/${RELEASES_ROUTE}/`);
}
