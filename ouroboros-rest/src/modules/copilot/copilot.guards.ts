/**
 * The guard vocabulary — what the copilot may propose with `set_guard`, and what each means.
 *
 * The names are the org policy's core rules (BQ.2, `schemas/org-policy/v1.json`), because those
 * are the guards the enforcement planes actually honour: a `spend_guard` the copilot proposes is
 * the same `spend_guard` routing folds into a resolution's cap and the executor checks. Proposing
 * anything else would be a word in a prompt. DSL v1 has no guard construct, so a proposal is
 * recorded on the reply as `proposed`, never applied to the document, and the person is told.
 */

import type { EngineGuardEntry } from "../engine/engine.copilot";
import { CORE_RULE_IDS, type CoreRuleId } from "../policies/org-policy.document";

/** What each rule does, for the model. */
const DESCRIPTIONS: Readonly<Record<CoreRuleId, string>> = {
  auto_merge: "Whether a run may merge its own pull request; off means a person merges.",
  human_review: "Requires a human review before merge, by effort or label.",
  protected_paths: "Paths a run may not change without an explicit allow.",
  spend_guard:
    "A spend cap the executor checks pre-flight and while running — per run (per_run_cap_cents) and per month (monthly_cap_cents).",
  dry_run_new_repos: "Dry-run the first N loops on a repository before real runs.",
};

/** Every guard, in the policy's order. */
export const GUARD_VOCABULARY: readonly EngineGuardEntry[] = CORE_RULE_IDS.map((name) => ({
  name,
  description: DESCRIPTIONS[name],
}));

/**
 * Whether a name is one the enforcement planes honour.
 *
 * @param name - What the copilot proposed.
 * @returns `true` for a core rule id.
 */
export function isKnownGuard(name: string): boolean {
  return (CORE_RULE_IDS as readonly string[]).includes(name);
}
