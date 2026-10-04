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
 *
 * **Widened by BN.4** ([#464](https://github.com/NobuData/ouroboros/issues/464)): {@link
 * OrgPolicyGateResolver.document} answers the whole current published document — every rule as its
 * `{enabled, conditions}` envelope — so the inbox's *What Needs A Human* card reads the same
 * document the gate engine enforces, through the one reader #481 will keep widening.
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

/** One rule of the published document, as V092's envelope holds it. */
export interface OrgPolicyRule {
  readonly enabled: boolean;
  readonly conditions: Readonly<Record<string, unknown>>;
}

/** The workspace's current published policy document. */
export interface PublishedOrgPolicy {
  /** `org_policy_versions.version` — what "policy v7" names. */
  readonly version: number;
  readonly publishedAt: Date;
  /** Every rule that holds the envelope, by rule id (`human_review`, `protected_paths`, …). */
  readonly rules: Readonly<Record<string, OrgPolicyRule>>;
}

/**
 * Every rule of a stored document that holds the `{enabled: boolean, conditions: object}` envelope.
 *
 * @param document - `org_policy_versions.document`.
 * @returns The rules by id; anything malformed is left out rather than guessed at.
 */
export function rulesOf(document: unknown): Record<string, OrgPolicyRule> {
  if (typeof document !== "object" || document === null) {
    return {};
  }

  const rules: Record<string, OrgPolicyRule> = {};

  for (const [id, value] of Object.entries(document)) {
    const rule = humanReviewRuleOf(value);

    if (rule !== null) {
      rules[id] = { enabled: rule.enabled, conditions: rule.conditions as Record<string, unknown> };
    }
  }

  return rules;
}

@Injectable()
export class OrgPolicyGateResolver implements OrgGatePolicy {
  /**
   * @param database - The pool.
   */
  constructor(private readonly database: DatabaseService) {}

  /** @inheritdoc */
  async forOrganization(organizationId: string): Promise<OrgGateConfig> {
    const published = await this.document(organizationId);

    return { ...DEFAULT_ORG_GATE_CONFIG, humanReview: published?.rules.human_review ?? null };
  }

  /**
   * The workspace's current published policy document.
   *
   * @param organizationId - The workspace.
   * @returns The version, when it was published, and its rules; null when nothing is published.
   */
  async document(organizationId: string): Promise<PublishedOrgPolicy | null> {
    const result = await sql<{ version: number; published_at: Date; document: unknown }>`
      select v.version, v.published_at, v.document
        from ouroboros.org_policies p
        join ouroboros.org_policy_versions v
          on v.organization_id = p.organization_id and v.version = p.current_version
       where p.organization_id = ${organizationId}
    `.execute(this.database.db);
    const row = result.rows[0];

    return row === undefined
      ? null
      : { version: row.version, publishedAt: row.published_at, rules: rulesOf(row.document) };
  }
}
