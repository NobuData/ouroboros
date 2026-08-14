/**
 * A migrated PostgreSQL the integration suite starts for itself.
 *
 * The half of [#37](https://github.com/NobuData/ouroboros/issues/37) that answers *without
 * external setup*. Before it, `yarn test:integration` was handed a database by whoever ran
 * it — `docker compose up -d` on a laptop, a service container in `ci/rest` — and both of
 * those are setup a developer can get wrong and a workflow file can drift from. This starts
 * `postgres:17-alpine`, applies `ouroboros-db`'s Flyway migrations to it, and hands back a
 * connection string; the container is thrown away when the run ends.
 *
 * **The migrations are applied by Flyway, not by this file.** A test harness that read
 * `migrations/*.sql` and executed them in order would be a second implementation of the one
 * thing `ouroboros-db` exists to own — it would apply a repeatable migration in the wrong
 * place, ignore `validateMigrationNaming`, and leave no `flyway_schema_history` to compare a
 * deployment against. So the same `flyway/flyway:13-alpine` the compose stack runs is
 * started against the same `flyway.toml`, with the same arguments, over a private network.
 * `migration.fixture.ts` holds those arguments and `migration.fixture.spec.ts` compares them
 * with `docker-compose.yml` on every unit run, so the two cannot drift apart quietly.
 *
 * The project files are *copied* into the Flyway container rather than bind-mounted, which
 * is the one departure from `ouroboros-db/run.sh`. A bind mount is a path on the machine
 * running the daemon, so it silently mounts nothing when `DOCKER_HOST` points somewhere
 * else; a copy travels over the same API the container was created with and works against a
 * remote or rootless daemon unchanged.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import { resolve } from "node:path";
import type { Readable } from "node:stream";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, Network, Wait, type StartedNetwork } from "testcontainers";

import {
  databaseProject,
  DATABASE_ALIAS,
  DATABASE_NAME,
  DATABASE_PASSWORD,
  DATABASE_USER,
  FLYWAY_IMAGE,
  FLYWAY_PROJECT,
  flywayCommand,
  MIGRATION_TIMEOUT_MS,
  POSTGRES_IMAGE,
} from "./migration.fixture";

/** A database that has been started and migrated, and the way to take it down again. */
export interface IntegrationDatabase {
  /** The libpq connection string, with the port Docker mapped. */
  readonly url: string;
  /** Stop the container and remove the network. Called once, by `globalTeardown`. */
  stop(): Promise<void>;
}

/**
 * Start a PostgreSQL and migrate it.
 *
 * Called once per `yarn test:integration` run, from `global.setup.fixture.ts`. Every suite
 * in the run shares the database it returns; the harness's `truncate()` in
 * `harness.fixture.ts` is what keeps them from seeing each other's rows.
 *
 * @returns The migrated database, and the way to stop it.
 * @throws {Error} When Docker is unreachable, or when Flyway fails — in which case the
 *   message carries Flyway's own output, because "the migration failed" without the
 *   migration's reason is a failure a developer cannot act on.
 */
export async function startMigratedPostgres(): Promise<IntegrationDatabase> {
  const network = await new Network().start();

  const postgres = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase(DATABASE_NAME)
    .withUsername(DATABASE_USER)
    .withPassword(DATABASE_PASSWORD)
    .withNetwork(network)
    .withNetworkAliases(DATABASE_ALIAS)
    .start();

  const takeDown = async (): Promise<void> => {
    await postgres.stop();
    await network.stop();
  };

  try {
    await migrate(network);
  } catch (cause) {
    // A half-started stack is worse than none: without this the container survives the
    // failure and the developer is left to find it by hand.
    await takeDown();
    throw cause;
  }

  return { url: postgres.getConnectionUri(), stop: takeDown };
}

/**
 * Run `flyway migrate` against the database on `network`.
 *
 * The container is a task rather than a service — `restart: "no"` in compose, and
 * `Wait.forOneShotStartup()` here, which waits for it to exit and treats a non-zero status
 * as a failed start.
 *
 * @param network - The private network PostgreSQL is reachable on under
 *   {@link DATABASE_ALIAS}.
 * @throws {Error} When Flyway exits non-zero, with its output appended.
 */
async function migrate(network: StartedNetwork): Promise<void> {
  const project = databaseProject();
  const output: string[] = [];

  const flyway = new GenericContainer(FLYWAY_IMAGE)
    .withNetwork(network)
    .withCopyFilesToContainer([
      { source: resolve(project, "flyway.toml"), target: `${FLYWAY_PROJECT}/flyway.toml` },
    ])
    .withCopyDirectoriesToContainer([
      { source: resolve(project, "migrations"), target: `${FLYWAY_PROJECT}/migrations` },
    ])
    .withCommand(flywayCommand())
    .withWaitStrategy(Wait.forOneShotStartup())
    .withStartupTimeout(MIGRATION_TIMEOUT_MS)
    .withLogConsumer((stream: Readable) => {
      stream.on("data", (line: Buffer | string) => output.push(String(line).trimEnd()));
    });

  const started = await flyway.start().catch((cause: unknown) => {
    throw new Error(`flyway migrate failed.\n${output.join("\n")}`, { cause });
  });

  // It has already exited; this removes it rather than leaving the run's containers to the
  // reaper, so `docker ps -a` after a green run is empty.
  await started.stop();
}
