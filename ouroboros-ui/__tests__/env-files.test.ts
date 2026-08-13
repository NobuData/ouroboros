import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { type MutableEnvironment, applyEnvFiles, envFiles } from "@/env-files";

/**
 * The repo-root `.env`, layered under the process environment.
 *
 * `docs/CONVENTIONS.md` § 4's rule, and the two properties that make it safe are the ones
 * worth holding: **the process always wins**, so a container is configured by exactly what
 * it was started with and `OURO_LOG_LEVEL=debug yarn dev` still works; and **a missing file
 * is not a failure**, because that is the normal case in an image that ships none.
 *
 * `ouroboros-rest`'s `dotenv.spec.ts` and `ouroboros-engine`'s `test_settings.py` assert the
 * same contract against the same file layout. If one of the three changes, these are what
 * say so.
 */

/** Temporary directories to remove when the case is done. */
const scratch: string[] = [];

afterEach(() => {
  for (const path of scratch.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

/**
 * A throwaway repo: a root holding one `.env`, and a module directory beside it.
 *
 * @param contents What to write into the root `.env`. Omitted writes no file at all.
 * @returns The module root, as `process.cwd()` would report it for a running module.
 */
function repoWithRootEnv(contents?: string): string {
  const root = mkdtempSync(join(tmpdir(), "ouro-env-"));
  scratch.push(root);

  const moduleRoot = join(root, "ouroboros-ui");
  mkdirSync(moduleRoot);

  if (contents !== undefined) {
    writeFileSync(join(root, ".env"), contents, "utf8");
  }

  return moduleRoot;
}

describe("envFiles", () => {
  it("names the repo-root file, one level above the module", () => {
    const moduleRoot = repoWithRootEnv("OURO_REST_URL=http://localhost:4000\n");

    expect(envFiles(moduleRoot)).toEqual([resolve(moduleRoot, "..", ".env")]);
  });

  it("does not name this module's own file, which Next.js has already read", () => {
    // `.env`, `.env.local` and the NODE_ENV variants are loaded from the project directory
    // before any of this runs. Reading one again here would be a second reading of the same
    // file, with the precedence right by luck rather than by design.
    const moduleRoot = repoWithRootEnv("OURO_REST_URL=http://localhost:4000\n");

    expect(envFiles(moduleRoot)).not.toContain(resolve(moduleRoot, ".env"));
  });

  it("resolves against the working directory when given nothing", () => {
    // `next dev` and `next start` are both run from the module root — that is what
    // `turbo run dev` does per workspace.
    expect(envFiles()).toEqual([resolve(process.cwd(), "..", ".env")]);
  });
});

describe("applyEnvFiles", () => {
  it("fills a variable the process was not given", () => {
    const moduleRoot = repoWithRootEnv("OURO_REST_URL=http://localhost:4000\n");
    const env: MutableEnvironment = {};

    applyEnvFiles(env, envFiles(moduleRoot));

    expect(env.OURO_REST_URL).toBe("http://localhost:4000");
  });

  it("never overwrites what the process was started with", () => {
    // The whole reason this is safe to do to a global at all. A container is configured by
    // exactly what it was started with, and one run can be overridden without editing a
    // file that the rest of the stack reads.
    const moduleRoot = repoWithRootEnv("OURO_REST_URL=http://localhost:4000\n");
    const env: MutableEnvironment = { OURO_REST_URL: "http://localhost:4100" };

    applyEnvFiles(env, envFiles(moduleRoot));

    expect(env.OURO_REST_URL).toBe("http://localhost:4100");
  });

  it("reports the names it filled, and not the ones already present", () => {
    const moduleRoot = repoWithRootEnv("OURO_REST_URL=http://localhost:4000\nOURO_LOG_LEVEL=debug\n");
    const env: MutableEnvironment = { OURO_REST_URL: "http://localhost:4100" };

    expect(applyEnvFiles(env, envFiles(moduleRoot))).toEqual(["OURO_LOG_LEVEL"]);
  });

  it("lets a later file beat an earlier one, as ouroboros-rest's ordering does", () => {
    // The list is lowest precedence first. Filling straight from each file in turn would
    // silently invert that, because the first writer of a name would win.
    const root = mkdtempSync(join(tmpdir(), "ouro-env-"));
    scratch.push(root);
    writeFileSync(join(root, "lower.env"), "OURO_LOG_LEVEL=info\n", "utf8");
    writeFileSync(join(root, "higher.env"), "OURO_LOG_LEVEL=debug\n", "utf8");
    const env: MutableEnvironment = {};

    applyEnvFiles(env, [join(root, "lower.env"), join(root, "higher.env")]);

    expect(env.OURO_LOG_LEVEL).toBe("debug");
  });

  it("treats a missing file as nothing to add rather than as a failure", () => {
    // The normal case in a container: no image ships a `.env`.
    const moduleRoot = repoWithRootEnv();
    const env: MutableEnvironment = {};

    expect(applyEnvFiles(env, envFiles(moduleRoot))).toEqual([]);
    expect(env).toEqual({});
  });

  it("raises anything that is not the file being absent", () => {
    // Starting on defaults after failing to read the file that was meant to configure the
    // service is the kind of quiet that costs an afternoon. A directory where a file was
    // expected is a misconfiguration, not an absence.
    const root = mkdtempSync(join(tmpdir(), "ouro-env-"));
    scratch.push(root);
    mkdirSync(join(root, "not-a-file.env"));

    expect(() => applyEnvFiles({}, [join(root, "not-a-file.env")])).toThrow();
  });

  it("parses with dotenv, so one file reads the same here as in ouroboros-rest", () => {
    // The quoting is the point: a second parser would mean one `.env` with two readings.
    const moduleRoot = repoWithRootEnv(
      '# a comment\nOURO_REST_URL="http://localhost:4000"\nOURO_ENGINE_SHARED_SECRET=a b c\n',
    );
    const env: MutableEnvironment = {};

    applyEnvFiles(env, envFiles(moduleRoot));

    expect(env.OURO_REST_URL).toBe("http://localhost:4000");
    expect(env.OURO_ENGINE_SHARED_SECRET).toBe("a b c");
  });
});
