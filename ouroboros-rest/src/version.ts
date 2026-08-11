/**
 * Which build is answering — read from the module's own manifest, not written twice.
 *
 * `docs/CONVENTIONS.md` § 8 versions each module independently in its own manifest, and
 * says there is one place per module where a version is written down. A constant here
 * would be a second place, and the two would disagree the first time someone bumped one
 * of them. So the manifest is the source and this module reads it, the way
 * `ouroboros-engine` reports the version its package metadata carries.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** This service's name, as it appears in the manifest and in every response. */
export const SERVICE_NAME = "ouroboros-rest";

/**
 * The manifest, resolved from this file rather than from the working directory.
 *
 * `version.ts` sits directly under `src/`, and `tsconfig.json` pins `rootDir` to `src`
 * and `outDir` to `dist`, so this one relative path is correct from both — `src/..` and
 * `dist/..` are the module directory. That pinning is why the path can be a constant:
 * moving this file, or letting the compiler infer a root, would move the manifest out
 * from under it, which is what {@link readServiceVersion}'s error message is for.
 */
const MANIFEST_PATH = join(__dirname, "..", "package.json");

/** Memoised {@link readServiceVersion}, so the manifest is read once per process. */
let cachedVersion: string | undefined;

/**
 * Read the version out of a package manifest.
 *
 * @param manifestPath - Manifest to read. Defaults to this module's own; the parameter
 *   exists so the failure branches can be exercised against a fixture.
 * @returns The manifest's `version` field.
 * @throws {Error} If the file cannot be read, is not JSON, or carries no string
 *   `version`. Naming the path is the whole value of the message: every one of those
 *   failures means a build that packaged the code without its manifest, and the fix is
 *   always in the build rather than in this file.
 */
export function readServiceVersion(manifestPath: string = MANIFEST_PATH): string {
  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch (error) {
    throw new Error(`Cannot read the service manifest at ${manifestPath}`, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`The service manifest at ${manifestPath} is not valid JSON`, { cause: error });
  }

  // Narrowed rather than cast: the manifest is a file on disk, and a cast would turn a
  // packaging mistake into `undefined` in an HTTP response instead of an error at boot.
  if (typeof parsed !== "object" || parsed === null || !("version" in parsed)) {
    throw new Error(`The service manifest at ${manifestPath} declares no version`);
  }

  const { version } = parsed;
  if (typeof version !== "string" || version === "") {
    throw new Error(`The service manifest at ${manifestPath} declares no version`);
  }

  return version;
}

/**
 * This service's version.
 *
 * @returns The `version` field of this module's `package.json`, read on first call and
 *   remembered afterwards — the file cannot change under a running process, and the
 *   heartbeat is on a path that anything monitoring the service polls.
 * @throws {Error} On the first call only, if the manifest is missing or malformed. See
 *   {@link readServiceVersion}.
 */
export function serviceVersion(): string {
  cachedVersion ??= readServiceVersion();
  return cachedVersion;
}
