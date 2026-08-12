/**
 * Where configuration comes from before it is validated.
 *
 * `docs/CONVENTIONS.md` § 4 says every Ouroboros setting is `OURO_`-prefixed and
 * validated at boot; this file is the step before that — assembling the environment the
 * validation runs against, by layering the repo's `.env` files *underneath* the real
 * process environment.
 *
 * The ordering is the whole design. A variable set in the process always wins, so a
 * container is still configured by exactly what it was started with, `OURO_LOG_LEVEL`
 * can be overridden for a single run without editing a file, and the `.env` files are
 * what they look like they are: defaults for a checkout, not a second source of truth
 * competing with the platform.
 *
 * It matches `ouroboros-engine`'s `settings._ENV_FILES`, deliberately and file for file,
 * so that one `.env` configures both services and neither has a rule the other lacks.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "dotenv";

/**
 * This module's directory is `<module>/src/modules/config` in development and
 * `<module>/dist/modules/config` once compiled — three levels below the module root
 * either way, which is why this resolves the same in both.
 */
const MODULE_ROOT = resolve(__dirname, "..", "..", "..");

/**
 * The `.env` files {@link environmentWithDotenv} reads, lowest precedence first: the
 * repo-root one, then this module's own.
 *
 * The module's file wins where both declare a variable — `docs/CONVENTIONS.md` § 4's
 * "the more specific file wins" rule, expressed as an ordering. Both are optional: a
 * container ships with neither and is configured entirely from its process environment.
 *
 * Paths are resolved from this file's own location rather than from the working
 * directory, because `nest start` is run from the module and `node dist/main.js` from
 * wherever the platform likes.
 */
export const ENV_FILES: readonly string[] = [
  resolve(MODULE_ROOT, "..", ".env"),
  resolve(MODULE_ROOT, ".env"),
];

/**
 * Read one `.env` file.
 *
 * @param path - Absolute path to the file.
 * @returns Its variables, or an empty object when the file does not exist. Absence is
 *   the normal case in a container and is not a failure; anything else — a directory, a
 *   file that cannot be read — is a real misconfiguration and is thrown, because
 *   silently starting on defaults after failing to read the file that was meant to
 *   configure the service is the kind of quiet that costs an afternoon.
 */
function readEnvFile(path: string): Record<string, string> {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }

  return parse(contents);
}

/**
 * Build the environment to validate: {@link ENV_FILES} layered under the real one.
 *
 * @param env - The process environment, or a stand-in in a test.
 * @param files - Which files to read, lowest precedence first. Defaults to
 *   {@link ENV_FILES}; a test passes its own.
 * @returns A new object — `env` is never mutated, so nothing here can leak into
 *   `process.env` and change what an unrelated part of the process sees.
 */
export function environmentWithDotenv(
  env: NodeJS.ProcessEnv,
  files: readonly string[] = ENV_FILES,
): NodeJS.ProcessEnv {
  const layered: NodeJS.ProcessEnv = {};
  for (const path of files) {
    Object.assign(layered, readEnvFile(path));
  }

  // The real environment goes on last and therefore wins.
  return Object.assign(layered, env);
}
