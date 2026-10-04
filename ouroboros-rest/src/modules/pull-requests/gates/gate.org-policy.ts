/**
 * `OrgPolicyGateResolver` — the gate engine's org configuration, with the published policy's
 * `human_review` rule.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)), the **#358 amendment**: the
 * refactor-label rule moves from mockup prose to the workspace's published org policy document
 * (V092, `org_policy_versions` at `org_policies.current_version`). Everything else stays at
 * {@link DEFAULT_ORG_GATE_CONFIG} — overrides and the license allow-list are BQ.2's (#481) to
 * absorb, and #481 widens this resolver rather than replacing the port.
 *
 * A workspace that has published no policy has no rule, so nothing new is required of it.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type { HumanReviewRule } from "./gate.human-review";
import { DEFAULT_ORG_GATE_CONFIG, type OrgGateConfig, type OrgGatePolicy } from "./gate.policy";

/**
 * The stored rule, if it has the envelope V092 holds (`{enabled: boolean, conditions: object}`).
 *
 * @param value - `document -> 'human_review'`.
 * @returns The rule, or null for anything else.
 */
export function humanReviewRuleOf(value: unknown): HumanReviewRule | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const rule = value as { enabled?: unknown; conditions?: unknown };

  return typeof rule.enabled === "boolean" && typeof rule.conditions === "object"
    ? { enabled: rule.enabled, conditions: rule.conditions }
    : null;
}

@Injectable()
export class OrgPolicyGateResolver implements OrgGatePolicy {
  /**
   * @param database - The pool.
   */
  constructor(private readonly database: DatabaseService) {}

  /** @inheritdoc */
  async forOrganization(organizationId: string): Promise<OrgGateConfig> {
    const result = await sql<{ rule: unknown }>`
      select v.document -> 'human_review' as rule
        from ouroboros.org_policies p
        join ouroboros.org_policy_versions v
          on v.organization_id = p.organization_id and v.version = p.current_version
       where p.organization_id = ${organizationId}
    `.execute(this.database.db);

    return { ...DEFAULT_ORG_GATE_CONFIG, humanReview: humanReviewRuleOf(result.rows[0]?.rule) };
  }
}
