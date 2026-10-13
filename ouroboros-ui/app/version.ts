/**
 * Which build of the application this is — read from the module's own manifest, not written
 * twice.
 *
 * `docs/CONVENTIONS.md` § 8 versions each module independently in its own manifest and gives
 * a version one home per module. A constant here would be a second home, and the two would
 * disagree the first time somebody bumped one of them — so the manifest is imported and this
 * is the one name the rest of the application reads, the way `ouroboros-rest`'s `version.ts`
 * reads its own for the heartbeat. The import is resolved by the bundler, so the string is in
 * the build: there is no file to find at run time, and the standalone image needs nothing
 * extra copied into it.
 *
 * This is the version of `ouroboros-ui` and of nothing else. There is no repository-wide
 * version to show; the service behind the application reports its own on `GET /api/v1`.
 */

import manifest from "@/package.json";

/** The application's version, exactly as `ouroboros-ui/package.json` states it. */
export const APP_VERSION: string = manifest.version;

/**
 * The version as the application prints it.
 *
 * @param version The semver to label. Defaults to this build's.
 * @returns The version behind a `v`, as release notes and the documentation site write it.
 */
export function versionLabel(version: string = APP_VERSION): string {
  return `v${version}`;
}
