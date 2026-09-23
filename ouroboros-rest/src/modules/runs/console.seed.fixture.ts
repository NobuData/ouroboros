/**
 * Mockup 10's `#482`, applied from the committed development seeds.
 *
 * Shared by `console.integration-spec.ts` (AP.2, #304) and `console.mockup.integration-spec.ts`
 * (AP.6, [#308](https://github.com/NobuData/ouroboros/issues/308)): both assert the page against
 * the rows design review looks at, rather than against a copy of them, so both apply the same
 * seeds the same way — the way `registry.seed.fixture.ts` applies them.
 *
 * Nothing here ships: `tsconfig.build.json` excludes `*.fixture.ts`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ApiHarness, Person, Workspace } from "../../testing/harness.fixture";
import { memberOf } from "../../testing/registry.seed.fixture";
import { SCHEMA_NAME } from "../db/schema";

/** Where the committed migrations and the database's own test fixtures are. */
export const DB_ROOT = join(__dirname, "..", "..", "..", "..", "ouroboros-db");

/**
 * The seeds mockup 10's `#482` is built from, in the order Flyway applies them (by description):
 * the workspace, the dashboard's runs and stage history, the farm's `forge-02` and job `#483`,
 * the providers and routing matrix (`implement-primary`'s `$2.50` cap), the console's own rows,
 * and the workflows (`standard-fix` v14, whose `implement` inherits the `implement` route).
 */
export const CONSOLE_SEEDS = [
  "R__dev_seed.sql",
  "R__dev_seed_dashboard.sql",
  "R__dev_seed_farm.sql",
  "R__dev_seed_providers.sql",
  "R__dev_seed_routing.sql",
  "R__dev_seed_run_console.sql",
  "R__dev_seed_workflows.sql",
  "R__model_price_catalog.sql",
] as const;

/** What {@link seedConsole} leaves behind. */
export interface SeededConsole {
  /** `acme-robotics`, the mockup's tenant. */
  readonly workspace: Workspace;
  /** A person holding `owner` in it. */
  readonly owner: Person;
  /** The id of run `#482` — Loop #1847. */
  readonly runId: string;
}

/**
 * Apply {@link CONSOLE_SEEDS} to the harness's database and find the mockup's run.
 *
 * @param api - The harness; its database must be empty (a suite truncates between tests).
 * @returns The workspace, an owner of it, and the run's id.
 * @throws {Error} When the seeds no longer produce `acme-robotics` or its run `#482` — a seed
 *   change this fixture should fail on loudly rather than hand a suite `undefined`.
 */
export async function seedConsole(api: ApiHarness): Promise<SeededConsole> {
  for (const seed of CONSOLE_SEEDS) {
    const text = readFileSync(join(DB_ROOT, "migrations", seed), "utf8").replaceAll(
      "${ouro_dev_seed}",
      "true",
    );
    await api.sql.query(text);
  }

  const { rows } = await api.sql.query<{ id: string; slug: string; name: string }>(
    `select "id", "slug", "name" from ${SCHEMA_NAME}.organization where "slug" = 'acme-robotics'`,
  );
  const workspace = rows[0];

  if (workspace === undefined) {
    throw new Error("The development seeds no longer create the acme-robotics workspace.");
  }

  const owner = await memberOf(api, workspace, "owner");
  const runs = await api.sql.query<{ id: string }>(
    `select id from ${SCHEMA_NAME}.runs where organization_id = $1 and issue_number = 482`,
    [workspace.id],
  );

  if (runs.rows[0] === undefined) {
    throw new Error("The development seeds no longer create run #482 in acme-robotics.");
  }

  return { workspace, owner, runId: runs.rows[0].id };
}
