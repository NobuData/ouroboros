/**
 * What each rule of the published org policy decides — pure, one evaluator per rule.
 *
 * BQ.2 ([#481](https://github.com/NobuData/ouroboros/issues/481)). Every enforcement point asks
 * its question here, through `PolicyResolutionService`, so no plane keeps its own copy of the
 * truth:
 *
 * ```
 * rule               asked by                                   answers
 * auto_merge         AX.4 merge executor (#360)                 is this PR eligible to merge unattended?
 * human_review       AX.2 gate engine (#358)                    must a person review this PR, and which label said so?
 * protected_paths    AP.3 guardrails (#305) · BN.4 inbox card   which globs does the org protect?
 * spend_guard        Z.1 resolution (#194)                      what are the org's per-run and monthly caps?
 * dry_run_new_repos  BA.3 dry-run plane (#382)                  is this repository still in its first N loops?
 * ```
 *
 * **Every verdict carries its rule id and the version that produced it** ({@link PolicyVerdict}),
 * so a blocked merge, a required review or a capped run is traceable to one line of one published
 * policy. A workspace that has published nothing gets `version: null` and the answer it had before
 * BQ.2: no rule binds it.
 *
 * **One version per decision.** {@link resolveRule} reads the one `PublishedOrgPolicy` it is
 * handed, so a caller that resolves several rules for one decision resolves them all against the
 * same version — a publish landing mid-flight cannot produce a half-old, half-new verdict.
 *
 * **When in doubt, the stricter answer.** A condition this reader cannot evaluate (the document is
 * validated at publish, so only a hand-written row could carry one) makes `auto_merge` ineligible
 * and `human_review` not required — the two answers that keep a person in the loop. (A review the
 * policy cannot justify is not required; the gate engine's own defaults still apply.)
 */

import type { CoreRuleId, OrgPolicyRule, PublishedOrgPolicy } from "./org-policy.document";
import { evaluatePredicate, type PredicateFacts } from "./org-policy.predicate";

/** What one rule decided, attributed. */
export interface PolicyVerdict<T> {
  /** The rule that decided. */
  readonly ruleId: CoreRuleId;
  /** The published version it was read from — what "policy v7" names — or null when none is. */
  readonly version: number | null;
  /** Whether a published version holds the rule switched on. */
  readonly enabled: boolean;
  /** The answer. */
  readonly value: T;
  /** One sentence saying why — what an explanation, a refusal or an audit line quotes. */
  readonly reason: string;
}

/** `auto_merge`'s answer. */
export interface AutoMergeValue {
  /** Whether the PR may merge unattended. */
  readonly eligible: boolean;
}

/** `human_review`'s answer — what the gate engine applies (`gate.human-review.ts`). */
export interface HumanReviewValue {
  /** Whether the policy requires a human review of this PR. */
  readonly required: boolean;
  /**
   * The label the policy matched, or null when it matched on effort alone (or not at all) — the
   * first positive `label` term that held, in document order. What the inbox card's *why* names.
   */
  readonly label: string | null;
}

/** `protected_paths`' answer. */
export interface ProtectedPathsValue {
  /** The org-wide globs, sorted — empty while the rule is off or nothing is published. */
  readonly globs: readonly string[];
}

/** `spend_guard`'s answer. */
export interface SpendGuardValue {
  /** The org's per-run cap, in integer cents, or null for none. */
  readonly perRunCapCents: number | null;
  /** The org's monthly cap, applied to each provider separately, in integer cents, or null. */
  readonly monthlyCapCents: number | null;
}

/** `dry_run_new_repos`' answer. */
export interface DryRunNewReposValue {
  /** Whether this repository is still inside its first N loops. */
  readonly active: boolean;
  /** N, or null while the rule is off or nothing is published. */
  readonly firstNLoops: number | null;
}

/** The answer each rule gives. */
export interface RuleValues {
  readonly auto_merge: AutoMergeValue;
  readonly human_review: HumanReviewValue;
  readonly protected_paths: ProtectedPathsValue;
  readonly spend_guard: SpendGuardValue;
  readonly dry_run_new_repos: DryRunNewReposValue;
}

/** The facts a rule may need — each rule reads only its own. */
export interface PolicyContext {
  /** The PR's ticket — `auto_merge` and `human_review`. */
  readonly ticket?: PredicateFacts;
  /**
   * Which of its repository's loops this is, counting from 1 — `dry_run_new_repos`. A PR is the
   * repository's Nth when N − 1 runs that opened a PR on it came before. Null when the repository is
   * not known, which the rule reads the stricter way: still in dry-run.
   */
  readonly loop?: number | null;
}

/** A ticket nobody labelled or sized. */
const NO_TICKET: PredicateFacts = Object.freeze({ labels: Object.freeze([]), effort: undefined });

/**
 * `policy v7`, as a sentence names it.
 *
 * @param version - The version.
 * @returns `policy v7`.
 */
export function policyLabel(version: number): string {
  return `policy v${String(version)}`;
}

/**
 * The rule as the published policy holds it.
 *
 * @param policy - The published policy, or null.
 * @param ruleId - The rule.
 * @returns The rule, or undefined when nothing is published or the version lacks it.
 */
function ruleIn(policy: PublishedOrgPolicy | null, ruleId: CoreRuleId): OrgPolicyRule | undefined {
  return policy?.rules[ruleId];
}

/**
 * Attribute an answer.
 *
 * @param ruleId - The rule.
 * @param policy - The published policy it was read from, or null.
 * @param value - The answer.
 * @param reason - Why.
 * @returns The verdict.
 */
function verdict<T>(
  ruleId: CoreRuleId,
  policy: PublishedOrgPolicy | null,
  value: T,
  reason: string,
): PolicyVerdict<T> {
  return {
    ruleId,
    version: policy?.version ?? null,
    enabled: ruleIn(policy, ruleId)?.enabled === true,
    value,
    reason,
  };
}

/**
 * `auto_merge` — may this PR merge unattended?
 *
 * With nothing published the pinned workflow alone decides (the behaviour before BQ.2). With a
 * published version, the rule must be on **and** its conditions must hold for the PR's ticket.
 *
 * @param policy - The published policy, or null.
 * @param ticket - The PR's ticket.
 * @returns The verdict.
 */
export function autoMergeVerdict(
  policy: PublishedOrgPolicy | null,
  ticket: PredicateFacts,
): PolicyVerdict<AutoMergeValue> {
  const rule = ruleIn(policy, "auto_merge");

  if (policy === null || rule === undefined) {
    return verdict(
      "auto_merge",
      policy,
      { eligible: true },
      "No org policy governs auto-merge: the pinned workflow decides.",
    );
  }

  const named = policyLabel(policy.version);

  if (!rule.enabled) {
    return verdict("auto_merge", policy, { eligible: false }, `Auto-merge is off in ${named}.`);
  }

  const { holds } = evaluatePredicate(rule.conditions, ticket);

  if (holds === undefined) {
    return verdict(
      "auto_merge",
      policy,
      { eligible: false },
      `The auto_merge conditions in ${named} could not be read, so nothing merges unattended.`,
    );
  }

  return holds
    ? verdict("auto_merge", policy, { eligible: true }, `The PR meets auto_merge in ${named}.`)
    : verdict(
        "auto_merge",
        policy,
        { eligible: false },
        `The PR's ticket does not meet the auto_merge conditions in ${named}.`,
      );
}

/**
 * `human_review` — must a person review this PR?
 *
 * @param policy - The published policy, or null.
 * @param ticket - The PR's ticket.
 * @returns The verdict: required or not, and the label the policy matched.
 */
export function humanReviewVerdict(
  policy: PublishedOrgPolicy | null,
  ticket: PredicateFacts,
): PolicyVerdict<HumanReviewValue> {
  const rule = ruleIn(policy, "human_review");

  if (policy === null || rule === undefined || !rule.enabled) {
    return verdict(
      "human_review",
      policy,
      { required: false, label: null },
      policy === null
        ? "No org policy requires a human review."
        : `Human review is off in ${policyLabel(policy.version)}.`,
    );
  }

  const named = policyLabel(policy.version);
  const { holds, labels } = evaluatePredicate(rule.conditions, ticket);

  if (holds !== true) {
    return verdict(
      "human_review",
      policy,
      { required: false, label: null },
      holds === undefined
        ? `The human_review conditions in ${named} could not be read.`
        : `The PR's ticket does not meet the human_review conditions in ${named}.`,
    );
  }

  const label = labels[0] ?? null;

  return verdict(
    "human_review",
    policy,
    { required: true, label },
    label === null
      ? `${named} requires a human review of this PR.`
      : `${named} requires a human review of anything labeled ${label}.`,
  );
}

/**
 * `protected_paths` — the org-wide globs.
 *
 * AP.3 checks the **union** of these and each repository's own rows (V092's mapping), so a glob
 * here protects a path in every repository, and absorbing never un-protects one.
 *
 * @param policy - The published policy, or null.
 * @returns The verdict: the globs, sorted and deduplicated — none while the rule is off.
 */
export function protectedPathsVerdict(
  policy: PublishedOrgPolicy | null,
): PolicyVerdict<ProtectedPathsValue> {
  const rule = ruleIn(policy, "protected_paths");

  if (policy === null || rule === undefined || !rule.enabled) {
    return verdict(
      "protected_paths",
      policy,
      { globs: [] },
      "No org policy protects a path in every repository.",
    );
  }

  const listed = rule.conditions.path_globs;
  const globs = Array.isArray(listed)
    ? [
        ...new Set(
          listed.filter((glob): glob is string => typeof glob === "string" && glob !== ""),
        ),
      ].sort()
    : [];

  return verdict(
    "protected_paths",
    policy,
    { globs },
    `${policyLabel(policy.version)} protects ${String(globs.length)} ${globs.length === 1 ? "glob" : "globs"} in every repository.`,
  );
}

/**
 * A cap, if the document holds one: a positive integer of cents (V092's
 * `org_policy_versions_spend_cents`).
 *
 * @param value - The stored value.
 * @returns The cents, or null.
 */
function centsOf(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * `spend_guard` — the org's caps.
 *
 * @param policy - The published policy, or null.
 * @returns The verdict: each cap in cents, null for one the rule does not set or while it is off.
 */
export function spendGuardVerdict(
  policy: PublishedOrgPolicy | null,
): PolicyVerdict<SpendGuardValue> {
  const rule = ruleIn(policy, "spend_guard");

  if (policy === null || rule === undefined || !rule.enabled) {
    return verdict(
      "spend_guard",
      policy,
      { perRunCapCents: null, monthlyCapCents: null },
      "No org policy caps spend.",
    );
  }

  return verdict(
    "spend_guard",
    policy,
    {
      perRunCapCents: centsOf(rule.conditions.per_run_cap_cents),
      monthlyCapCents: centsOf(rule.conditions.monthly_cap_cents),
    },
    `${policyLabel(policy.version)} caps spend.`,
  );
}

/**
 * `dry_run_new_repos` — is this repository still in its first N loops?
 *
 * @param policy - The published policy, or null.
 * @param loop - Which of its repository's loops this is (1-based), or null when unknown.
 * @returns The verdict.
 */
export function dryRunNewReposVerdict(
  policy: PublishedOrgPolicy | null,
  loop: number | null,
): PolicyVerdict<DryRunNewReposValue> {
  const rule = ruleIn(policy, "dry_run_new_repos");
  const limit = rule?.conditions.first_n_loops;

  if (policy === null || rule === undefined || !rule.enabled || typeof limit !== "number") {
    return verdict(
      "dry_run_new_repos",
      policy,
      { active: false, firstNLoops: null },
      "No org policy puts a new repository in dry-run.",
    );
  }

  const named = policyLabel(policy.version);
  const n = Math.max(0, Math.floor(limit));

  if (loop === null) {
    return verdict(
      "dry_run_new_repos",
      policy,
      { active: n > 0, firstNLoops: n },
      n > 0
        ? `${named} keeps a repository's first ${String(n)} loops in dry-run, and this loop's repository is not known.`
        : `${named} puts no loop in dry-run.`,
    );
  }

  const active = loop <= n;

  return verdict(
    "dry_run_new_repos",
    policy,
    { active, firstNLoops: n },
    active
      ? `Loop ${String(loop)} of this repository is inside the first ${String(n)} that ${named} keeps in dry-run.`
      : `This repository is past the first ${String(n)} loops that ${named} keeps in dry-run.`,
  );
}

/**
 * Resolve one rule for one decision.
 *
 * @param policy - The one published version this decision reads, or null.
 * @param ruleId - The rule.
 * @param context - The facts the rule needs.
 * @returns The rule's verdict.
 */
export function resolveRule<R extends CoreRuleId>(
  policy: PublishedOrgPolicy | null,
  ruleId: R,
  context: PolicyContext = {},
): PolicyVerdict<RuleValues[R]> {
  const ticket = context.ticket ?? NO_TICKET;
  const resolved: { readonly [K in CoreRuleId]: () => PolicyVerdict<RuleValues[K]> } = {
    auto_merge: () => autoMergeVerdict(policy, ticket),
    human_review: () => humanReviewVerdict(policy, ticket),
    protected_paths: () => protectedPathsVerdict(policy),
    spend_guard: () => spendGuardVerdict(policy),
    dry_run_new_repos: () => dryRunNewReposVerdict(policy, context.loop ?? null),
  };

  return resolved[ruleId]();
}

/** Which limit set a run's per-run cap. */
export type CapLimit = "route" | "spend_guard";

/** A run's effective per-run cap, and which limit set it. */
export interface EffectiveCap {
  /** The cap, in integer cents, or null when neither limit sets one. */
  readonly capCents: number | null;
  /**
   * Which limit it is — what a `cost_cap_exceeded` names. On a tie the route's own cap is named:
   * it is the more specific of the two, and the one its owner set for this kind of work.
   */
  readonly limit: CapLimit | null;
  /** The org policy version that set it, when the spend guard did. */
  readonly version: number | null;
}

/**
 * The per-run cap a run travels with — **the stricter of the two wins** (V092's precedence).
 *
 * A route with no cap takes the guard's; a guard that is off (or sets no per-run cap) leaves the
 * route's alone. Neither layer can loosen the other.
 *
 * @param routeCapCents - `routes.max_cost_cents_per_run`, or null.
 * @param guard - `spend_guard`'s verdict.
 * @returns The cap, and which limit set it.
 */
export function effectivePerRunCap(
  routeCapCents: number | null,
  guard: PolicyVerdict<SpendGuardValue>,
): EffectiveCap {
  const guardCap = guard.value.perRunCapCents;

  if (guardCap !== null && (routeCapCents === null || guardCap < routeCapCents)) {
    return { capCents: guardCap, limit: "spend_guard", version: guard.version };
  }

  return routeCapCents === null
    ? { capCents: null, limit: null, version: null }
    : { capCents: routeCapCents, limit: "route", version: null };
}

/** Where a dry-run came from. */
export type DryRunSource = "org_override" | "dry_run_new_repos";

/** Whether a PR is in dry-run, and why. */
export interface EffectiveDryRun {
  readonly active: boolean;
  /** Which said so — the org-wide switch wins, being the stricter override. Null when off. */
  readonly source: DryRunSource | null;
  /** The policy version, when the per-repository rule is the source. */
  readonly version: number | null;
}

/**
 * A PR's dry-run: V075's org-wide boolean is the **stricter override** — while it is true every
 * repository is in dry-run whatever the counter says — and otherwise `dry_run_new_repos` decides
 * per repository.
 *
 * @param orgOverride - `org_policies.dry_run` as the effective view reads it.
 * @param rule - `dry_run_new_repos`' verdict for the PR's repository.
 * @returns The dry-run, and which said so.
 */
export function effectiveDryRun(
  orgOverride: boolean,
  rule: PolicyVerdict<DryRunNewReposValue>,
): EffectiveDryRun {
  if (orgOverride) {
    return { active: true, source: "org_override", version: null };
  }

  return rule.value.active
    ? { active: true, source: "dry_run_new_repos", version: rule.version }
    : { active: false, source: null, version: null };
}
