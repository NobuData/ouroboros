/**
 * The repo's `.env` files, layered *underneath* what this process was started with.
 *
 * `docs/CONVENTIONS.md` § 4 gives every module the same rule — the repo-root `.env` is the
 * defaults for a checkout, a module's own file overrides it, and the real process
 * environment beats both — and this is that rule for `ouroboros-ui`. It is the third
 * implementation of one contract, and deliberately so:
 *
 * | Module | Where |
 * |---|---|
 * | `ouroboros-engine` | `settings.py`'s `_ENV_FILES` |
 * | `ouroboros-rest` | `src/modules/config/dotenv.ts` |
 * | `ouroboros-ui` | here |
 *
 * They are parallel rather than shared because the first of them is Python, so there is no
 * one implementation the three could import; what is shared is the ordering, and each file
 * names the others so a change to the rule has somewhere to start. The `dotenv` dependency
 * is the same one `ouroboros-rest` parses with, which matters more than it looks: a second
 * parser would mean one `.env` file with two readings of the same quoting.
 *
 * ### Two things differ from `ouroboros-rest`, and both are Next.js
 *
 * **This module's own `.env` is not in the list.** Next.js has already loaded it — along
 * with `.env.local` and the `NODE_ENV`-specific variants — from the project directory,
 * before any of this runs (`environment-variables.md` § Environment Variable Load Order).
 * Adding it here would be a second reading of a file already read, and the precedence would
 * be right by luck rather than by design.
 *
 * **This mutates the environment rather than returning a new one.** `ouroboros-rest`
 * composes an environment and hands it to its own validation, so it never has to touch the
 * global; here the consumer is `app/env.ts` reading `process.env` directly, as every
 * Next.js application does. Filling *only* the names that are still absent is what keeps
 * that safe — nothing this does can overwrite a value the process was started with, so the
 * mutation cannot change what anything else in the process already saw.
 *
 * @see instrumentation.ts — where this is called, and why that hook rather than
 *   `next.config.ts`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "dotenv";

/**
 * What this module needs of an environment: names to values, and writable.
 *
 * Deliberately not `NodeJS.ProcessEnv`, for the reason `app/env.ts`'s `Environment` is not
 * either — Next.js augments that type with required keys of its own, so a caller supplying
 * an environment would have to supply `NODE_ENV` to have a variable that is not it filled
 * in. `process.env` satisfies this, which is the only thing that has to be true of it.
 */
export type MutableEnvironment = Record<string, string | undefined>;

/**
 * The `.env` files to layer, lowest precedence first.
 *
 * A function rather than a constant because it resolves against the working directory,
 * which is a runtime fact: `next dev` and `next start` are both run from the module root —
 * that is what `turbo run dev` does per workspace — so the repo root is one level up.
 *
 * **A container resolves this too, and finds nothing.** No image ships a `.env`; the
 * runtime stage of `Dockerfile` copies the standalone output and nothing else, and the
 * service is configured entirely from its process environment. So the path being wrong for
 * a server started from somewhere unusual costs nothing that a missing file does not
 * already cost — which is why this is not worth more machinery than one `resolve`.
 *
 * @param moduleRoot Where this module lives. Defaults to the working directory; a test
 *   passes a temporary directory.
 * @returns The paths, lowest precedence first.
 */
export function envFiles(moduleRoot: string = process.cwd()): readonly string[] {
  return [resolve(moduleRoot, "..", ".env")];
}

/**
 * Read one `.env` file.
 *
 * @param path Absolute path to the file.
 * @returns Its variables, or an empty object when the file does not exist. Absence is the
 *   normal case in a container and is not a failure; anything else — a directory, a file
 *   that cannot be read — is a real misconfiguration and is thrown, because silently
 *   starting on defaults after failing to read the file that was meant to configure the
 *   service is the kind of quiet that costs an afternoon.
 * @throws {Error} Whatever `readFileSync` raised, unless it was `ENOENT`.
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
 * Fill in the variables the process was not given, from the `.env` files.
 *
 * @param env The environment to fill. Defaults to `process.env`; a test passes its own.
 * @param files Which files to read, lowest precedence first. Defaults to {@link envFiles};
 *   a test passes its own.
 * @returns The names that were filled, in the order they were applied — what a caller
 *   logs, and what a test asserts on. A name already present is not among them.
 * @throws {Error} From {@link readEnvFile}, for a file that exists and cannot be read.
 */
export function applyEnvFiles(
  env: MutableEnvironment = process.env,
  files: readonly string[] = envFiles(),
): readonly string[] {
  // Layered first, in the files' own order, so a later file beats an earlier one — the
  // same ordering `ouroboros-rest` gets from `Object.assign`. Filling straight from each
  // file in turn would silently invert it, because the first writer of a name would win.
  const layered: Record<string, string> = {};
  for (const path of files) {
    Object.assign(layered, readEnvFile(path));
  }

  const filled: string[] = [];
  for (const [name, value] of Object.entries(layered)) {
    if (env[name] === undefined) {
      env[name] = value;
      filled.push(name);
    }
  }

  return filled;
}
