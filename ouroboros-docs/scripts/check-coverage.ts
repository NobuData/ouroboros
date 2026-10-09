#!/usr/bin/env node
/**
 * The docs coverage gate (DE.4): fails when a product route, an `OURO_*` variable or a CLI
 * flag has shipped without its documentation. The reading and comparing of routes is
 * `scripts/coverage.ts`; the variables' is `scripts/config-reference.ts` (DB.3) and the flags'
 * `scripts/cli-flags.ts` (DC.3), reused here so one command answers all three.
 *
 * Usage:
 *   node scripts/check-coverage.ts
 *
 * `yarn check:coverage` runs it, and `ci/docs` runs that on every change to a UI route, to
 * `.env.example` or to the runner's usage texts — so adding a `page.tsx` without an entry in
 * `docs-coverage.json` fails the build, naming the route.
 *
 * Exit codes: 0 everything is documented, 1 something is not (each problem is printed),
 * 2 a source could not be read, or `docs-coverage.json` is malformed.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkFlags, expectations } from "./cli-flags.ts";
import { parseEnvExample, variablesOf } from "./config-reference.ts";
import { checkRoutes, parseCoverage, routesOf } from "./coverage.ts";

/** The module directory (`ouroboros-docs/`). */
const MODULE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The repository root. */
const REPO_ROOT = resolve(MODULE_DIR, "..");

/** The mapping from routes to pages. */
export const COVERAGE_FILE = join(MODULE_DIR, "docs-coverage.json");

/** The UI's `app/` directory, whose `page.tsx` files are the routes. */
export const UI_APP_DIR = join(REPO_ROOT, "ouroboros-ui", "app");

/** The pages directory page ids are relative to. */
export const DOCS_DIR = join(MODULE_DIR, "docs");

/** The generated configuration reference, which every variable must have an entry in. */
const GENERATED_REFERENCE = join(DOCS_DIR, "administration", "configuration", "_generated.mdx");

/**
 * Lists every file under a directory, recursively.
 *
 * @param dir the directory to walk.
 * @returns paths relative to `dir`, with `/` separators.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path).map((child) => `${name}/${child}`) : [name];
  });
}

/**
 * Whether a page id names a page.
 *
 * @param id the page's path under `docs/`, without its extension.
 * @returns `true` when `docs/<id>.mdx` or `docs/<id>.md` exists.
 */
function pageExists(id: string): boolean {
  return existsSync(join(DOCS_DIR, `${id}.mdx`)) || existsSync(join(DOCS_DIR, `${id}.md`));
}

/**
 * Runs the command.
 *
 * @param args the command-line arguments after the script's name; none are accepted.
 * @returns the process's exit code.
 */
function main(args: readonly string[]): number {
  if (args.length > 0) {
    console.error(`check:coverage: unknown argument ${args.join(" ")}; it takes none`);
    return 2;
  }

  const problems: string[] = [];
  try {
    // Routes (DE.4).
    const routes = routesOf(walk(UI_APP_DIR));
    const coverage = parseCoverage(readFileSync(COVERAGE_FILE, "utf8"));
    for (const { route, message } of checkRoutes(routes, coverage, pageExists)) {
      problems.push(`route ${route}: ${message}`);
    }

    // Variables (DB.3): every variable of .env.example has its entry in the generated reference.
    const reference = readFileSync(GENERATED_REFERENCE, "utf8");
    const template = readFileSync(join(REPO_ROOT, ".env.example"), "utf8");
    for (const { name } of variablesOf(parseEnvExample(template))) {
      if (!reference.includes(`### \`${name}\``)) {
        problems.push(
          `variable ${name}: not in the configuration reference — run yarn gen:config-reference`,
        );
      }
    }

    // Flags (DC.3): every flag the runner and the installer accept is on its page.
    const wanted = expectations(
      readFileSync(
        join(REPO_ROOT, "ouroboros-runner", "cmd", "ouroboros-runner", "main.go"),
        "utf8",
      ),
      readFileSync(join(REPO_ROOT, "ouroboros-runner", "install.sh"), "utf8"),
    );
    const pages = new Map<string, string>();
    for (const { page } of wanted) {
      const path = join(DOCS_DIR, page);
      if (existsSync(path)) pages.set(page, readFileSync(path, "utf8"));
    }
    for (const { page, message } of checkFlags(wanted, pages)) {
      problems.push(`flag page docs/${page}: ${message}`);
    }
  } catch (error) {
    console.error(`check:coverage: ${(error as Error).message}`);
    return 2;
  }

  if (problems.length === 0) {
    const routes = routesOf(walk(UI_APP_DIR)).length;
    console.log(
      `check:coverage: ${routes} routes, every variable and every flag are documented` +
        ` (${relative(process.cwd(), COVERAGE_FILE)})`,
    );
    return 0;
  }
  for (const problem of problems) console.error(problem);
  console.error(
    `check:coverage: ${problems.length} problem(s). A route needs an entry in docs-coverage.json; ` +
      "a variable needs the reference regenerated; a flag needs its page's flags: front matter.",
  );
  return 1;
}

process.exitCode = main(process.argv.slice(2));
