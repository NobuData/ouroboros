/**
 * The published org policy document, as every enforcement point reads it — pure.
 *
 * BQ.1 ([#480](https://github.com/NobuData/ouroboros/issues/480), V092) stores one JSON document per
 * published version in `org_policy_versions.document`: a map of `rule_id` → `{enabled, conditions}`.
 * The five core rules are always present (V092's `org_policy_versions_core_rules`), so an absent
 * rule is never ambiguous; `enabled: false` is how a rule is switched off.
 *
 * This module only puts a stored document into a typed shape. It decides nothing — that is
 * `policy-resolution.ts`, one evaluator per rule.
 */

/** The five rules every published version holds, in the settings card's order. */
export const CORE_RULE_IDS = [
  "auto_merge",
  "human_review",
  "protected_paths",
  "spend_guard",
  "dry_run_new_repos",
] as const;

/** One of {@link CORE_RULE_IDS}. */
export type CoreRuleId = (typeof CORE_RULE_IDS)[number];

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
 * One stored rule, if it has the envelope V092 holds (`{enabled: boolean, conditions: object}`).
 *
 * @param value - `document -> '<rule_id>'`.
 * @returns The rule, or null for anything else.
 */
export function ruleOf(value: unknown): OrgPolicyRule | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const rule = value as { enabled?: unknown; conditions?: unknown };

  return typeof rule.enabled === "boolean" &&
    typeof rule.conditions === "object" &&
    rule.conditions !== null &&
    !Array.isArray(rule.conditions)
    ? { enabled: rule.enabled, conditions: rule.conditions as Record<string, unknown> }
    : null;
}

/**
 * Every rule of a stored document that holds the `{enabled: boolean, conditions: object}` envelope.
 *
 * @param document - `org_policy_versions.document`.
 * @returns The rules by id; anything malformed is left out rather than guessed at.
 */
export function rulesOf(document: unknown): Record<string, OrgPolicyRule> {
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    return {};
  }

  const rules: Record<string, OrgPolicyRule> = {};

  for (const [id, value] of Object.entries(document)) {
    const rule = ruleOf(value);

    if (rule !== null) {
      rules[id] = rule;
    }
  }

  return rules;
}
