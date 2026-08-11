/**
 * The harness migrates the way the stack does — checked, not asserted in a comment.
 *
 * `migration.fixture.ts` restates four things `docker-compose.yml` already says: which
 * PostgreSQL, which Flyway, where the project is mounted, and what Flyway is asked to do.
 * Restating them is unavoidable — Testcontainers is not compose — and a restatement that
 * nothing compares is a copy that drifts. The integration suite would not notice: it would
 * go on passing against whatever database that file described, which is the whole failure
 * mode. So the comparison happens here, in the *unit* suite, where it costs nothing, needs
 * no Docker, and runs on every pull request that touches either file.
 *
 * It is the same shape as `container.spec.ts`: read what the repository decided, and fail
 * when this module's copy of it stops matching.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";

import {
  databaseProject,
  DATABASE_ALIAS,
  DATABASE_NAME,
  DATABASE_PASSWORD,
  DATABASE_SCHEMA,
  DATABASE_USER,
  FLYWAY_IMAGE,
  FLYWAY_PROJECT,
  flywayCommand,
  POSTGRES_IMAGE,
} from "./migration.fixture";

/** The repository root, from this file. */
const ROOT = resolve(__dirname, "..", "..", "..");

/** One service in `docker-compose.yml`, as much of it as this spec reads. */
interface ComposeService {
  image?: string;
  command?: string[];
}

/** The development stack, parsed. */
const compose = parse(readFileSync(resolve(ROOT, "docker-compose.yml"), "utf8")) as {
  services: Record<string, ComposeService | undefined>;
};

/** `ouroboros-db/run.sh`, which pins the same Flyway for the hand-run path. */
const runScript = readFileSync(resolve(ROOT, "ouroboros-db", "run.sh"), "utf8");

/**
 * A compose value with its variable substitutions resolved to their defaults.
 *
 * The stack writes `${OURO_DB_NAME:-ouroboros}` so a developer can point it elsewhere; the
 * harness has no such setting, because the database it migrates is one it created a second
 * earlier. Comparing the two therefore means comparing against compose's *defaults*, which
 * is what this does.
 *
 * @param value - The raw compose value.
 * @returns It, with every `${NAME:-default}` replaced by `default`.
 */
function withDefaults(value: string): string {
  return value.replace(/\$\{[A-Z_]+:-([^}]*)\}/g, "$1");
}

/**
 * One service out of the stack.
 *
 * @param name - Its key under `services`.
 * @returns The service.
 * @throws {Error} When the stack has no such service, which is a rename this spec has to
 *   notice rather than skip.
 */
function service(name: string): ComposeService {
  const found = compose.services[name];

  if (found === undefined) {
    throw new Error(`docker-compose.yml has no ${name} service — this spec is out of date.`);
  }

  return found;
}

describe("the images the harness starts", () => {
  it("runs the PostgreSQL the development stack runs", () => {
    expect(POSTGRES_IMAGE).toBe(service("db").image);
  });

  it("runs the Flyway the development stack runs", () => {
    expect(FLYWAY_IMAGE).toBe(service("flyway").image);
  });

  it("runs the Flyway ouroboros-db/run.sh runs", () => {
    // The third path to a migration, and the one a developer takes by hand. All three have
    // to be the same Flyway or "it migrated on my machine" stops meaning anything.
    expect(runScript).toContain(`FLYWAY_IMAGE=${FLYWAY_IMAGE}`);
  });

  it("pins both by tag rather than floating on latest", () => {
    // A floating tag makes a green run unreproducible: the same commit migrates against
    // whatever was published this morning.
    for (const image of [POSTGRES_IMAGE, FLYWAY_IMAGE]) {
      expect(image).toMatch(/^[^:]+:[^:]+$/);
      expect(image).not.toMatch(/:latest$/);
    }
  });
});

describe("the command the harness gives Flyway", () => {
  /** The stack's own, with its defaults resolved. */
  const stack = (service("flyway").command ?? []).map(withDefaults);

  it("names the same working directory the stack mounts the project into", () => {
    expect(stack).toContain(`-workingDirectory=${FLYWAY_PROJECT}`);
  });

  it("reaches PostgreSQL by the same JDBC url", () => {
    // Which is also the assertion that the network alias matches: the url is the alias.
    expect(stack).toContain(`-url=jdbc:postgresql://${DATABASE_ALIAS}:5432/${DATABASE_NAME}`);
  });

  it("connects as the same role, with the same schema", () => {
    expect(stack).toContain(`-user=${DATABASE_USER}`);
    expect(stack).toContain(`-password=${DATABASE_PASSWORD}`);
    expect(stack).toContain(`-schemas=${DATABASE_SCHEMA}`);
  });

  it("asks for migrate, last, as Flyway's parser expects", () => {
    expect(flywayCommand().at(-1)).toBe("migrate");
    expect(stack.at(-1)).toBe("migrate");
  });

  it("differs from the stack in exactly one argument: the dev seed", () => {
    // The stack layers flyway.seed.toml, which turns R__dev_seed.sql from a no-op into the
    // demo tenant. A suite that began with rows it did not create is a suite whose counts
    // mean nothing, so the harness does not — and this is where that stays a decision
    // rather than becoming an omission somebody re-adds.
    const missing = stack.filter((argument) => !flywayCommand().includes(argument));

    expect(missing).toEqual([
      `-configFiles=${FLYWAY_PROJECT}/flyway.toml,${FLYWAY_PROJECT}/flyway.seed.toml`,
    ]);
    expect(flywayCommand().join(" ")).not.toContain("seed");
  });
});

describe("the Flyway project the harness copies in", () => {
  it("is ouroboros-db, found from this module rather than from the working directory", () => {
    expect(databaseProject()).toBe(resolve(ROOT, "ouroboros-db"));
  });

  it("holds the configuration and the migrations Flyway will be pointed at", () => {
    expect(existsSync(resolve(databaseProject(), "flyway.toml"))).toBe(true);
    expect(readdirSync(resolve(databaseProject(), "migrations"))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^V000__/)]),
    );
  });

  it("copies the same two paths the stack mounts", () => {
    // Copied rather than bind-mounted — see the fixture's header — but into the same places,
    // because flyway.toml's `filesystem:migrations` is relative to the working directory.
    const volumes = (
      parse(readFileSync(resolve(ROOT, "docker-compose.yml"), "utf8")) as {
        services: Record<string, { volumes?: string[] } | undefined>;
      }
    ).services.flyway?.volumes;

    expect(volumes).toEqual(
      expect.arrayContaining([
        `./ouroboros-db/flyway.toml:${FLYWAY_PROJECT}/flyway.toml:ro`,
        `./ouroboros-db/migrations:${FLYWAY_PROJECT}/migrations:ro`,
      ]),
    );
  });
});
