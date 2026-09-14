/**
 * Mockup 21's registry, applied from the committed development seeds and read back by name.
 *
 * CH.7 ([#590](https://github.com/NobuData/ouroboros/issues/590)) certifies the registry "over
 * the #582 seeds", and asks that **no test depend on a hard-coded row id**. Both halves are
 * here:
 *
 *   * **The seeds are the repeatable migrations themselves** — `R__dev_seed*.sql` and the price
 *     catalog, with `${ouro_dev_seed}` switched on — applied the way
 *     `resolutions.integration-spec.ts` applies them. A copy of the seeded rows written into a
 *     spec would be a second registry, free to drift from the one design review and the e2e leg
 *     look at.
 *   * **Every id is read back from the database**, keyed by the alias name mockup 21 prints.
 *     A suite asks for `coder-max`, or for "a bound alias something references", and is handed
 *     whatever id the seed produced this run.
 *
 * It is a `.fixture.ts`: type-checked with the code it exercises and left out of the image by
 * `tsconfig.build.json`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SCHEMA_NAME, type OrganizationRole } from "../modules/db/schema";
import type { ApiHarness, Person, Workspace } from "./harness.fixture";

/** Where the committed migrations are. */
const MIGRATIONS = join(__dirname, "..", "..", "..", "ouroboros-db", "migrations");

/**
 * The repeatable migrations mockup 21's workspace is built from, in the order Flyway applies
 * them: the tenant and its people, the dashboard's runs (run #482 hangs off one), the provider
 * connections, the routing matrix with all eight aliases and the snapshot, the workflows whose
 * published versions pin aliases, and the shipped price catalog.
 */
export const REGISTRY_SEEDS = [
  "R__dev_seed.sql",
  "R__dev_seed_dashboard.sql",
  "R__dev_seed_providers.sql",
  "R__dev_seed_routing.sql",
  "R__dev_seed_workflows.sql",
  "R__model_price_catalog.sql",
] as const;

/** The placeholder every seed statement is gated on. */
const SEED_PLACEHOLDER = "${ouro_dev_seed}";

/** The seeded tenant's slug — a handle a human reads, not a row id. */
export const SEEDED_WORKSPACE_SLUG = "acme-robotics";

/** One seeded alias, as the database holds it this run. */
export interface SeededAlias {
  /** `model_aliases.id`. */
  readonly id: string;
  /** The name mockup 21 prints. */
  readonly alias: string;
  /** The bound connection, or null for the unbound row. */
  readonly connectionId: string | null;
  /** The bound connection's kind, or null for the unbound row. */
  readonly kind: string | null;
  /** The model the alias names. */
  readonly modelId: string;
  /** Whether it is switched on. */
  readonly enabled: boolean;
  /** How many rows `alias_references` holds for it — the `Used by` count. */
  readonly references: number;
}

/** The seeded workspace, an owner signed into it, and its aliases by name. */
export interface SeededRegistry {
  /** The `acme-robotics` workspace. */
  readonly workspace: Workspace;
  /** A harness person holding `owner` there. */
  readonly owner: Person;
  /** Every alias in the workspace, keyed by name. */
  readonly aliases: ReadonlyMap<string, SeededAlias>;
}

/**
 * Apply the registry seeds to an empty database and describe what they wrote.
 *
 * Meant for a `beforeEach` after the harness's truncation: the seeds insert fixed rows, so a
 * second application without a truncation between would collide with the first.
 *
 * @param api - The harness, whose own connection runs the seeds.
 * @returns The seeded registry.
 * @throws {Error} When the seeds did not produce the `acme-robotics` workspace — which means a
 *   seed file was renamed or its placeholder changed, and every assertion after it would be
 *   about an empty registry.
 */
export async function seedRegistry(api: ApiHarness): Promise<SeededRegistry> {
  for (const seed of REGISTRY_SEEDS) {
    const text = readFileSync(join(MIGRATIONS, seed), "utf8").replaceAll(SEED_PLACEHOLDER, "true");

    await api.sql.query(text);
  }

  const { rows } = await api.sql.query<{ id: string; slug: string; name: string }>(
    `select "id", "slug", "name" from ${SCHEMA_NAME}.organization where "slug" = $1`,
    [SEEDED_WORKSPACE_SLUG],
  );

  if (rows.length === 0) {
    throw new Error(
      `The registry seeds did not create the ${SEEDED_WORKSPACE_SLUG} workspace. Check that ` +
        `${REGISTRY_SEEDS.join(", ")} still exist and still gate on ${SEED_PLACEHOLDER}.`,
    );
  }

  const workspace: Workspace = rows[0];
  const owner = await memberOf(api, workspace, "owner");

  return { workspace, owner, aliases: await seededAliases(api, workspace.id) };
}

/**
 * A new harness person holding a role in a workspace.
 *
 * @param api - The harness.
 * @param workspace - Where they join.
 * @param role - What they hold there.
 * @returns The signed-in person.
 */
export async function memberOf(
  api: ApiHarness,
  workspace: Workspace,
  role: OrganizationRole,
): Promise<Person> {
  const person = await api.signIn();

  await api.join(workspace.id, person, role);

  return person;
}

/**
 * Every alias in a workspace as it stands now, with its reference count.
 *
 * Re-read rather than cached, so a test that changed the registry can ask again.
 *
 * @param api - The harness.
 * @param organizationId - The workspace.
 * @returns The aliases, keyed by name.
 */
export async function seededAliases(
  api: ApiHarness,
  organizationId: string,
): Promise<ReadonlyMap<string, SeededAlias>> {
  const { rows } = await api.sql.query<SeededAlias & { references: string }>(
    `select a.id, a.alias, a.provider_connection_id as "connectionId", c.kind,
            a.model_id as "modelId", a.enabled,
            (select count(*) from ${SCHEMA_NAME}.alias_references r
              where r.organization_id = a.organization_id and r.alias_id = a.id) as "references"
       from ${SCHEMA_NAME}.model_aliases a
       left join ${SCHEMA_NAME}.provider_connections c on c.id = a.provider_connection_id
      where a.organization_id = $1
      order by a.alias`,
    [organizationId],
  );

  // `count(*)` is a bigint, which `pg` answers as a string rather than lose precision.
  return new Map(rows.map((row) => [row.alias, { ...row, references: Number(row.references) }]));
}

/**
 * The first seeded alias, by name, that satisfies a condition.
 *
 * @param registry - The seeded registry.
 * @param description - What the condition means, for the failure message.
 * @param predicate - The condition.
 * @returns The alias.
 * @throws {Error} When no seeded alias satisfies it — the seeds changed shape, and the test
 *   asking would otherwise pass vacuously.
 */
export function seededAliasWhere(
  registry: SeededRegistry,
  description: string,
  predicate: (alias: SeededAlias) => boolean,
): SeededAlias {
  const found = [...registry.aliases.values()].find(predicate);

  if (found === undefined) {
    throw new Error(`The registry seeds hold no ${description}.`);
  }

  return found;
}
