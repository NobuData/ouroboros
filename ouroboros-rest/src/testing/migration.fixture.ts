/**
 * What migrating a throwaway database means: which images, which project, which command.
 *
 * Separated from `postgres.fixture.ts`, which is what *starts* the containers, for one
 * reason: everything here is a restatement of `docker-compose.yml`, and a restatement has to
 * be compared with what it restates. That comparison is `migration.fixture.spec.ts` — a
 * **unit** spec, which runs on every pull request and starts nothing — and it can only stay
 * one while reading these constants does not drag Testcontainers, dockerode and ssh2 into
 * `yarn test`.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The PostgreSQL the suite runs against.
 *
 * The same tag `docker-compose.yml` pins and `ci/db` runs, for the reason that file gives:
 * what a pull request proves has to be what a developer gets.
 */
export const POSTGRES_IMAGE = "postgres:17-alpine";

/** The Flyway that applies the migrations — the same tag compose and `run.sh` pin. */
export const FLYWAY_IMAGE = "flyway/flyway:13-alpine";

/**
 * The role, database and schema the container is created with.
 *
 * The development defaults `ouroboros-db/run.sh` documents, so a connection string this
 * harness produces differs from the one in `.env.example` only in its port. The password is
 * not a secret in any sense: it belongs to a container that exists for the length of one
 * test run and is reachable only from this machine.
 */
export const DATABASE_NAME = "ouroboros";
export const DATABASE_USER = "ouroboros";
export const DATABASE_PASSWORD = "ouroboros";
export const DATABASE_SCHEMA = "ouroboros";

/**
 * The name Flyway reaches PostgreSQL by.
 *
 * The two containers share a private network and this is the alias on it, which is what lets
 * the JDBC url below be a fixed string rather than a mapped port discovered at run time —
 * and it is the same alias `docker-compose.yml` gives the `db` service, so the url is the
 * compose stack's verbatim.
 */
export const DATABASE_ALIAS = "db";

/** Where `flyway.toml` and `migrations/` are placed inside the Flyway container. */
export const FLYWAY_PROJECT = "/flyway/project";

/**
 * How long the migration container is given.
 *
 * Generous because the first run on a machine pulls the image, and a suite that fails
 * because a 200 MB pull took longer than its timeout reports a bug that is not one.
 */
export const MIGRATION_TIMEOUT_MS = 180_000;

/**
 * The arguments Flyway is run with.
 *
 * Compared against the `flyway` service in `docker-compose.yml` by this module's spec — the
 * drift that matters is not the image tag but whether the harness migrates the way the stack
 * does.
 *
 * @returns The command, in the order Flyway's own parser expects: settings first, the
 *   command last.
 */
export function flywayCommand(): string[] {
  return [
    `-workingDirectory=${FLYWAY_PROJECT}`,
    `-url=jdbc:postgresql://${DATABASE_ALIAS}:5432/${DATABASE_NAME}`,
    `-user=${DATABASE_USER}`,
    `-password=${DATABASE_PASSWORD}`,
    `-schemas=${DATABASE_SCHEMA}`,
    "migrate",
  ];
}

/**
 * Where `ouroboros-db` is, from here.
 *
 * Resolved from `__dirname` rather than from the working directory, because `yarn
 * test:integration` runs from `ouroboros-rest/` and `turbo run test` runs from the
 * repository root — and a relative path would find the migrations under exactly one of them.
 *
 * @returns The absolute path of the Flyway project directory.
 * @throws {Error} When the directory does not hold a `flyway.toml`, which means this file
 *   has been moved and the path below has not — a failure worth naming rather than a Flyway
 *   run that applies nothing and reports success.
 */
export function databaseProject(): string {
  const project = resolve(__dirname, "..", "..", "..", "ouroboros-db");

  if (!existsSync(resolve(project, "flyway.toml"))) {
    throw new Error(
      `No flyway.toml under ${project}. The integration harness resolves ouroboros-db ` +
        "relative to src/testing/ — if this module moved, that path has to move with it.",
    );
  }

  return project;
}
