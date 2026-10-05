/**
 * Plant an allow-once grant the way BN.2's executor would leave one (#459, #465) — for integration
 * suites that judge or consume grants without going through the inbox.
 *
 * A `guardrail_exceptions` row must cite the decision item that authorised it, and that item must be
 * about the grant's run (V096's `guardrail_exceptions_granted_for_run`), so the helper files a
 * `protected_path_allow_once` card for the run first, through the application's own registry.
 */

import type { ApiHarness } from "../../testing/harness.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { DecisionKindRegistry } from "../decisions/decision-kind.registry";
import { SEEDED_PAYLOADS } from "../decisions/decision.kinds.fixture";

/** A planted grant and the card that authorised it. */
export interface PlantedGrant {
  /** `guardrail_exceptions.id`. */
  readonly grantId: string;
  /** `decision_items.id` — the grant's `granted_via`. */
  readonly itemId: string;
}

/**
 * File the run's allow-once card (once per run and path) and write a live grant through it.
 *
 * @param api - The started harness.
 * @param grant - What to grant.
 * @param grant.organizationId - The run's workspace.
 * @param grant.runId - The run.
 * @param grant.pathGlob - The narrow path the grant opens.
 * @param grant.grantedBy - `"user".id` of the person saying yes; defaults to the workspace's first member.
 * @param grant.ttlMinutes - How long it lives; defaults to 60.
 * @returns The grant's id and its card's id.
 */
export async function plantGrant(
  api: ApiHarness,
  grant: {
    readonly organizationId: string;
    readonly runId: string;
    readonly pathGlob: string;
    readonly grantedBy?: string;
    readonly ttlMinutes?: number;
  },
): Promise<PlantedGrant> {
  const registry = api.nest.get(DecisionKindRegistry, { strict: false });
  const { itemId } = await registry.emit({
    organizationId: grant.organizationId,
    kindId: "protected_path_allow_once",
    payload: { ...SEEDED_PAYLOADS.protected_path_allow_once, path: grant.pathGlob },
    refs: [
      { type: "run", id: grant.runId, label: "loop #1" },
      { type: "path", id: grant.pathGlob, label: grant.pathGlob },
    ],
    key: { plane: "guardrails", sourceRef: `run:${grant.runId}:path:${grant.pathGlob}` },
  });

  if (itemId === null) {
    throw new Error("the allow-once card was not filed");
  }

  const granter =
    grant.grantedBy ??
    (
      await api.sql.query<{ userId: string }>(
        `select "userId" from ${SCHEMA_NAME}.member where "organizationId" = $1
          order by "createdAt", "id" limit 1`,
        [grant.organizationId],
      )
    ).rows[0]?.userId;
  const { rows } = await api.sql.query<{ id: string }>(
    `insert into ${SCHEMA_NAME}.guardrail_exceptions
            (organization_id, run_id, path_glob, granted_by, granted_via, expires_at)
     values ($1, $2, $3, $4, $5, now() + make_interval(mins => $6::integer))
     returning id`,
    [grant.organizationId, grant.runId, grant.pathGlob, granter, itemId, grant.ttlMinutes ?? 60],
  );

  return { grantId: rows[0]?.id ?? "", itemId };
}
