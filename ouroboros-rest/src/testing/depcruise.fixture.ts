/**
 * The harness both dependency-cruiser boundary suites run on.
 *
 * `providers/boundary.spec.ts` (AC.1, [#216](https://github.com/NobuData/ouroboros/issues/216))
 * and `github/boundary.spec.ts` (K.3, [#101](https://github.com/NobuData/ouroboros/issues/101))
 * make the same kind of claim about two different rules: *the boundary fails the build on an
 * import that crosses it — spot-verified by adding one*. Verifying that means building a tiny
 * source tree containing exactly the violation, cruising it with the service's **real**
 * `.dependency-cruiser.cjs`, and asserting the named rule reports it and the process exits
 * non-zero.
 *
 * That machinery is here rather than copied, and the reason is the same one the rules
 * themselves exist for: two copies of a harness are two things that can drift, and the copy
 * that drifts is the one that quietly stops finding the executable and reports a clean tree.
 *
 * The trees are built in the system temp directory and removed afterwards. They carry their own
 * minimal `tsconfig.json` because dependency-cruiser resolves TypeScript through one, and the
 * rules are read from the real configuration file rather than from a copy — a copy would be a
 * second set of rules, tested instead of the ones that run.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** The module root — where `.dependency-cruiser.cjs` and `package.json` live. */
export const MODULE_ROOT = resolve(__dirname, "..", "..");

/** The configuration under test. The real one, not a copy. */
const CONFIG = join(MODULE_ROOT, ".dependency-cruiser.cjs");

/**
 * A `tsconfig.json` for a fixture tree.
 *
 * Minimal on purpose: dependency-cruiser needs one to resolve TypeScript, and the rules under
 * test are about import *paths* rather than about compiler options.
 */
const FIXTURE_TSCONFIG = JSON.stringify({
  compilerOptions: { module: "commonjs", moduleResolution: "node", target: "ES2023" },
  include: ["src/**/*.ts"],
});

/**
 * Where the `depcruise` executable is.
 *
 * Walked up from this file rather than resolved as a module specifier, because the package
 * publishes an `exports` map with no `./package.json` entry — so `require.resolve` cannot reach
 * it. Walking also survives both hoisting layouts: the binary may sit in the workspace root's
 * `node_modules/.bin` or in this module's own.
 *
 * @returns The absolute path to the executable script.
 * @throws {Error} When it cannot be found, which means the devDependency is not installed and
 *   every case below would otherwise fail with something unhelpful.
 */
function depcruiseBin(): string {
  for (
    let directory = __dirname;
    directory !== dirname(directory);
    directory = dirname(directory)
  ) {
    const candidate = join(
      directory,
      "node_modules",
      "dependency-cruiser",
      "bin",
      "dependency-cruise.mjs",
    );

    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("dependency-cruiser is not installed — `yarn install` in ouroboros-rest");
}

/** What one cruise reported. */
export interface CruiseResult {
  /** The process's exit code. Non-zero is what "fails the build" means. */
  readonly exitCode: number;
  /** Everything it printed, both streams, so a rule name can be looked for. */
  readonly output: string;
}

/**
 * Run the real rules over a directory.
 *
 * @param cwd - Where to run. Paths in the report are relative to it, which is what lets a
 *   fixture tree match rules anchored on `^src/`.
 * @returns What it reported.
 */
export function cruise(cwd: string): CruiseResult {
  try {
    const output = execFileSync(process.execPath, [depcruiseBin(), "src", "--config", CONFIG], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    return { exitCode: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };

    return {
      exitCode: failure.status ?? -1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

/**
 * Build a source tree, cruise it, and remove it.
 *
 * @param files - The tree, keyed by path relative to the root. Directories are created as
 *   needed.
 * @returns What the cruise reported.
 */
export function cruiseFixture(files: Readonly<Record<string, string>>): CruiseResult {
  const root = mkdtempSync(join(tmpdir(), "ouro-boundary-"));

  try {
    writeFileSync(join(root, "tsconfig.json"), FIXTURE_TSCONFIG);

    for (const [path, contents] of Object.entries(files)) {
      const absolute = join(root, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, contents);
    }

    return cruise(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
