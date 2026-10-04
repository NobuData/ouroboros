/**
 * The *What Needs A Human* card, composed from the configs that enforce each rule (BN.4,
 * [#464](https://github.com/NobuData/ouroboros/issues/464), decision **X7**). Pure.
 *
 * Every row **derives** from a live source and carries it; nothing is copied into a display list,
 * so turning a rule off removes its row and editing it changes its text:
 *
 * ```
 * row                                   source (what enforces it)                    edit
 * <label> label → human review          org policy human_review (gate engine, #461)  /settings#policies
 * effort <E>+ → human review            org policy human_review effort_gte           /settings#policies
 * other review conditions → human review  any other human_review predicate           /settings#policies
 * protected paths → allow-once          BA.1 protected_path_policies (AP.3, #380)    /knowledge#repo-profile
 * unverifiable claims → explicit waiver AX.3 criteria waiver (claim_waiver kind)     /settings#policies
 * spend > $X/run → approval             spend_guard — ABSENT while AF.4 (#237) is unbuilt
 * effort XL+ → plan sign-off            ABSENT: no workflow human gate or threshold exists (#464)
 * ```
 *
 * The caption is BA.3's (#382): *"Everything else merges itself when gates are green"* is only
 * true outside dry-run, so dry-run changes the sentence.
 */

import type { OrgPolicyRule, PublishedOrgPolicy } from "../pull-requests/gates/gate.org-policy";

/** Where the document's rules are edited — mockup 17's policies card (#494). */
export const POLICIES_HREF = "/settings#policies";

/** Where BA.1's protected paths are edited — the repo profile on the knowledge page. */
export const PROTECTED_PATHS_HREF = "/knowledge#repo-profile";

/** The caption outside dry-run — mockup 16's sentence. */
export const MERGES_ITSELF = "Everything else merges itself when gates are green.";

/** The caption while dry-run is active. */
export const DRY_RUN_CAPTION =
  "Dry-run is on: nothing merges itself — every loop's PR opens as a draft for a person to review.";

/** One row of the card. */
export interface PolicyRowResource {
  /** Stable — `human_review:label:refactor`, `protected_paths`, `claim_waiver`. */
  readonly id: string;
  /** The left side — `refactor label`. */
  readonly rule: string;
  /** The right side — `human review`. */
  readonly outcome: string;
  /** What enforces it — the ⓘ. */
  readonly source: string;
  /** Extra text the row carries — the protected globs — or null. */
  readonly detail: string | null;
  /** The surface that owns the rule. */
  readonly editHref: string;
}

/** `GET /api/v1/inbox/policies`. */
export interface PolicyCardResource {
  readonly rows: readonly PolicyRowResource[];
  readonly caption: string;
  /** Whether BA.3's dry-run is active — what chose the caption. */
  readonly dryRun: boolean;
  /** The published policy version the document rows were read from, or null. */
  readonly policyVersion: number | null;
}

/** Everything the card is composed from. */
export interface PolicySources {
  /** The current published org policy, or null. */
  readonly policy: PublishedOrgPolicy | null;
  /** BA.1's protected globs across the workspace's repositories, with how many repos hold each. */
  readonly protectedPaths: readonly { readonly glob: string; readonly repos: number }[];
  /** Whether `spend_approval` is dormant (no per-run cap is enforced). */
  readonly spendDormant: boolean;
  /** Whether BA.3's dry-run is active. */
  readonly dryRun: boolean;
}

/**
 * A rule's conditions, flattened one level: the members of a top-level `any`, or the condition
 * itself.
 *
 * @param conditions - The rule's conditions.
 * @returns The predicates.
 */
function predicates(conditions: Readonly<Record<string, unknown>>): Record<string, unknown>[] {
  const any = conditions.any;

  if (Array.isArray(any)) {
    return any.filter(
      (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
    );
  }

  return [conditions];
}

/**
 * The human-review rows — one per atomic predicate (`label`, `effort_gte`), one for anything else.
 *
 * @param rule - `human_review`.
 * @param version - The policy version, for the source.
 * @returns The rows; none when the rule is off.
 */
export function humanReviewRows(
  rule: OrgPolicyRule | undefined,
  version: number,
): PolicyRowResource[] {
  if (rule === undefined || !rule.enabled) {
    return [];
  }

  const source = `Org policy v${String(version)} · human_review — the gate engine requires a person`;
  const rows: PolicyRowResource[] = [];
  let other = false;

  for (const predicate of predicates(rule.conditions)) {
    const keys = Object.keys(predicate);

    if (keys.length === 1 && typeof predicate.label === "string") {
      rows.push({
        id: `human_review:label:${predicate.label}`,
        rule: `${predicate.label} label`,
        outcome: "human review",
        source,
        detail: null,
        editHref: POLICIES_HREF,
      });
    } else if (keys.length === 1 && typeof predicate.effort_gte === "string") {
      rows.push({
        id: "human_review:effort",
        rule: `effort ${predicate.effort_gte.toUpperCase()}+`,
        outcome: "human review",
        source,
        detail: null,
        editHref: POLICIES_HREF,
      });
    } else {
      other = true;
    }
  }

  if (other) {
    rows.push({
      id: "human_review:other",
      rule: "other review conditions",
      outcome: "human review",
      source,
      detail: null,
      editHref: POLICIES_HREF,
    });
  }

  return rows;
}

/**
 * The protected-paths row, from BA.1's globs — absent when no repository protects a path.
 *
 * @param paths - The globs and how many repositories hold each.
 * @returns The row, or null.
 */
export function protectedPathsRow(
  paths: readonly { readonly glob: string; readonly repos: number }[],
): PolicyRowResource | null {
  if (paths.length === 0) {
    return null;
  }

  const repos = Math.max(...paths.map((path) => path.repos));

  return {
    id: "protected_paths",
    rule: "protected paths",
    outcome: "allow-once",
    source: `Protected paths (BA.1) — AP.3 stops an edit, a person may allow it once · up to ${String(repos)} ${repos === 1 ? "repository" : "repositories"}`,
    detail: [...paths]
      .map((path) => path.glob)
      .sort()
      .join(" · "),
    editHref: PROTECTED_PATHS_HREF,
  };
}

/**
 * The spend row — present only once a per-run cap is enforced (AF.4, #237) and the document's
 * `spend_guard` names one.
 *
 * @param rule - `spend_guard`.
 * @param dormant - Whether `spend_approval` is dormant.
 * @param version - The policy version.
 * @returns The row, or null.
 */
export function spendRow(
  rule: OrgPolicyRule | undefined,
  dormant: boolean,
  version: number,
): PolicyRowResource | null {
  const cents = rule?.conditions.per_run_cap_cents;

  if (dormant || rule === undefined || !rule.enabled || typeof cents !== "number") {
    return null;
  }

  return {
    id: "spend_guard",
    rule: `spend > $${(cents / 100).toFixed(2)}/run`,
    outcome: "approval",
    source: `Org policy v${String(version)} · spend_guard`,
    detail: null,
    editHref: POLICIES_HREF,
  };
}

/** The claim row: a claim the bench cannot verify is settled by verification or a waiver only. */
export const CLAIM_WAIVER_ROW: PolicyRowResource = {
  id: "claim_waiver",
  rule: "unverifiable claims",
  outcome: "explicit waiver",
  source: "PR verification (AX.3) — a criterion is verified or waived by a person, never silently",
  detail: null,
  editHref: POLICIES_HREF,
};

/**
 * The card.
 *
 * @param sources - The live configs.
 * @returns The rows, in mockup order, and the caption.
 */
export function policyCard(sources: PolicySources): PolicyCardResource {
  const version = sources.policy?.version ?? 0;
  const rules = sources.policy?.rules ?? {};
  const rows: PolicyRowResource[] = [
    ...humanReviewRows(rules.human_review, version),
    ...[protectedPathsRow(sources.protectedPaths)].filter(
      (row): row is PolicyRowResource => row !== null,
    ),
    CLAIM_WAIVER_ROW,
    ...[spendRow(rules.spend_guard, sources.spendDormant, version)].filter(
      (row): row is PolicyRowResource => row !== null,
    ),
  ];

  return {
    rows,
    caption: sources.dryRun ? DRY_RUN_CAPTION : MERGES_ITSELF,
    dryRun: sources.dryRun,
    policyVersion: sources.policy?.version ?? null,
  };
}
