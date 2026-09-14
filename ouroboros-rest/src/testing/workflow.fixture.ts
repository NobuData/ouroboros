/**
 * A workflow written straight into the tables, carrying the trigger a suite is about — R.4
 * ([#146](https://github.com/NobuData/ouroboros/issues/146)).
 *
 * `backlog/queue.integration-spec.ts` wrote this first, for R.1's end-to-end cases; the studio
 * suite's trigger matrix needs the same rows twenty times over, so it lives here now and both
 * read it. Straight into the tables rather than through `POST /api/v1/workflows`, for the reason
 * that suite gave: what these cases are about is the trigger the version in force carries, and
 * P.3's create goes through a publish gate that asks the engine for a second opinion nothing here
 * needs.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import { SCHEMA_NAME, type WorkflowStatus } from "../modules/db/schema";
import type { ApiHarness } from "./harness.fixture";

/** How a seeded workflow differs from an active one with a single version in force. */
export interface TriggerWorkflowOptions {
  /** Its status. Defaults to `active`. */
  readonly status?: WorkflowStatus;
  /**
   * How many versions to publish, each carrying the same trigger. Defaults to `1`.
   *
   * `0` writes the trigger into a **draft** and publishes nothing — the state **+ New workflow**
   * leaves once somebody has typed a trigger and not yet pressed **Publish**, which is exactly
   * the trigger that must not claim a ticket.
   */
  readonly versions?: number;
  /** Which published version is in force. Defaults to the newest; meaningless for a draft. */
  readonly inForce?: number;
}

/**
 * The smallest document that carries a trigger — what the trigger evaluation reads, and nothing
 * more.
 *
 * @param conditions - The trigger's conditions, as decision P8 spells them.
 * @returns The definition.
 */
export function triggerDefinition(conditions: Record<string, unknown>): Record<string, unknown> {
  return {
    dsl_version: "1.0",
    trigger: { event: "ticket_queued", conditions },
    nodes: [],
    edges: [],
  };
}

/**
 * Store a workflow whose every version carries one trigger.
 *
 * @param api - The started harness, whose own connection writes the rows.
 * @param organizationId - The workspace.
 * @param slug - The workflow's slug, which is also its name.
 * @param conditions - Its trigger's conditions.
 * @param options - Its status, how many versions, and which one is in force.
 * @returns `workflows.id`.
 * @throws {Error} When `versions` is not a whole number of zero or more, or `inForce` names a
 *   version that was not published — an arrangement the database would refuse anyway, named here
 *   rather than as a foreign-key violation.
 */
export async function seedTriggerWorkflow(
  api: ApiHarness,
  organizationId: string,
  slug: string,
  conditions: Record<string, unknown>,
  options: TriggerWorkflowOptions = {},
): Promise<string> {
  const versions = options.versions ?? 1;
  const inForce = options.inForce ?? versions;

  if (!Number.isInteger(versions) || versions < 0) {
    throw new Error(`A workflow cannot have ${String(versions)} published versions.`);
  }

  if (versions > 0 && (!Number.isInteger(inForce) || inForce < 1 || inForce > versions)) {
    throw new Error(`Version ${String(inForce)} is not one of the ${String(versions)} published.`);
  }

  const { rows } = await api.sql.query<{ id: string }>(
    `insert into ${SCHEMA_NAME}.workflows (organization_id, slug, name, status)
     values ($1, $2, $2, $3) returning id`,
    [organizationId, slug, options.status ?? "active"],
  );
  const id = rows[0].id;
  const definition = JSON.stringify(triggerDefinition(conditions));

  if (versions === 0) {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.workflow_versions (workflow_id, definition) values ($1, $2::jsonb)`,
      [id, definition],
    );

    return id;
  }

  for (let version = 1; version <= versions; version += 1) {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.workflow_versions (workflow_id, version, definition, published_at)
       values ($1, $2, $3::jsonb, now())`,
      [id, version, definition],
    );
  }

  await api.sql.query(`update ${SCHEMA_NAME}.workflows set current_version = $2 where id = $1`, [
    id,
    inForce,
  ]);

  return id;
}
