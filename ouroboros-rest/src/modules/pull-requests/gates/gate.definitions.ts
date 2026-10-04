/**
 * Definition materialization — the pinned policy, the routing vote rules, the run's intents and
 * org config, turned into the gate set a PR is held to (decision **V2**).
 *
 * AX.2 ([#358](https://github.com/NobuData/ouroboros/issues/358)). Pure; the service writes the
 * answer to `pr_gate_definitions` on PR creation and on every sync.
 *
 * ```
 * gate              required when                                          source
 * build             the pin holds on its checks (a checks gate node)       <tag>@v<pin> pin
 * test_suite        … or block-until-green is on for the run (#327)        … + block-until-green intent
 * physical_hil      the pin holds on its checks
 * diff_vs_plan      the pin holds on its checks
 * secrets_license   the pin holds on its checks
 * model_review      an add_vote escalation rule matches the ticket (#194)
 * human_approval    always — the policy owns the question; its verdict is the policy's answer.
 *                   When the org policy's human_review rule matches the ticket (#461 — the refactor
 *                   label) it is required whatever org config says, with the source
 *                   `… + org policy: refactor → human review`. Once a person asks for a review
 *                   (AX.5, #361) it is required too, with `… + review requested` appended
 * ```
 *
 * A PR with no run, or a pin that cannot be read, gets every gate required with the source
 * `ouroboros default`: an unreadable policy is not a permissive one. Org config
 * ({@link OrgGateConfig.overrides}) applies last and marks the row `org config`.
 */

import { BUILT_IN_GATE_KEYS, type BuiltInGateKey } from "../../db/schema";
import type { PinnedPolicy } from "../../guardrails/guardrails.policy";
import type { HumanReviewMatch } from "./gate.human-review";
import type { OrgGateConfig } from "./gate.policy";
import type { GateDefinitionSpec } from "./gate.types";

/** The card's row titles — mockup 12's words. */
export const GATE_LABELS: Readonly<Record<BuiltInGateKey, string>> = Object.freeze({
  build: "Build",
  test_suite: "Test suite",
  physical_hil: "Physical HIL",
  diff_vs_plan: "Diff-vs-plan conformance",
  secrets_license: "Secrets & license scan",
  model_review: "Second-model review",
  human_approval: "Human approval",
});

/** The gates that are evidence checks — what a pin's checks gate makes required. */
const EVIDENCE_GATES: ReadonlySet<BuiltInGateKey> = new Set([
  "build",
  "test_suite",
  "physical_hil",
  "diff_vs_plan",
  "secrets_license",
]);

/** The provenance of a gate set with no readable policy behind it. */
export const DEFAULT_SOURCE = "ouroboros default";

/** The provenance of a gate org config overrode. */
export const ORG_CONFIG_SOURCE = "org config";

/** What a requested review appends to `human_approval`'s provenance. */
export const REVIEW_REQUESTED_SOURCE = "review requested";

/**
 * What the org policy's `human_review` rule appends to `human_approval`'s provenance (#461) —
 * `org policy: refactor → human review`, or `org policy → human review` for a match on effort.
 *
 * @param label - The label the rule matched, or null.
 * @returns The provenance fragment.
 */
export function policyReviewSource(label: string | null): string {
  return label === null ? "org policy → human review" : `org policy: ${label} → human review`;
}

/** What a PR's gate set is materialized from. */
export interface DefinitionInput {
  /** The run's pin — `standard-fix` and `14` — or null for a PR without a run or an unpinned run. */
  readonly pin: { readonly tag: string; readonly version: number } | null;
  /** The pinned document's policy, or undefined when it could not be read. */
  readonly policy: PinnedPolicy | undefined;
  /** How many enabled `add_vote` rules match the run's ticket. */
  readonly voteRules: number;
  /** The run's *Block PR until green* intent. */
  readonly blockUntilGreen: boolean;
  /** The workspace's gate configuration. */
  readonly org: OrgGateConfig;
  /**
   * Whether a person has asked for a human review of the PR — any approval slot exists (V065).
   * Optional; absent means no.
   */
  readonly reviewRequested?: boolean;
  /**
   * What the org policy's `human_review` rule decided for the PR's ticket (#461, the #358
   * amendment). Optional; absent means the policy requires nothing.
   */
  readonly policyReview?: HumanReviewMatch;
}

/**
 * Materialize the gate set.
 *
 * @param input - The policy sources.
 * @returns The seven built-in definitions, in the card's order (`sort_order` 1–7).
 */
export function materializeDefinitions(input: DefinitionInput): GateDefinitionSpec[] {
  const readable = input.pin !== null && input.policy !== undefined;
  const pinSource = readable
    ? `${input.pin?.tag ?? ""}@v${String(input.pin?.version)} pin`
    : DEFAULT_SOURCE;
  const holdsOnChecks = !readable || input.policy?.holdsOnChecks === true;

  return BUILT_IN_GATE_KEYS.map((gateKey, index) => {
    let required: boolean;
    let source = pinSource;

    if (EVIDENCE_GATES.has(gateKey)) {
      required = holdsOnChecks;
      if (gateKey === "test_suite" && input.blockUntilGreen && !required) {
        required = true;
        source = `${pinSource} + block-until-green intent`;
      }
    } else if (gateKey === "model_review") {
      required = input.voteRules > 0;
    } else {
      required = true;
    }

    const override = input.org.overrides[gateKey];
    let disabled = false;

    if (override?.disabled === true) {
      required = false;
      disabled = true;
      source = ORG_CONFIG_SOURCE;
    } else if (override?.required !== undefined && override.required !== required) {
      required = override.required;
      source = ORG_CONFIG_SOURCE;
    }

    // The org policy says this PR needs a human (#461): the gate is the policy's, not config's to
    // switch off — and the card names the policy.
    if (gateKey === "human_approval" && input.policyReview?.required === true) {
      required = true;
      disabled = false;
      source = `${pinSource} + ${policyReviewSource(input.policyReview.label)}`;
    }

    // A person asked for a review: the gate is theirs to answer, not config's to switch off.
    if (gateKey === "human_approval" && input.reviewRequested === true) {
      required = true;
      disabled = false;
      // Kept after the policy's provenance when both hold; otherwise it replaces org config's.
      const base = input.policyReview?.required === true ? source : pinSource;
      source = `${base} + ${REVIEW_REQUESTED_SOURCE}`;
    }

    return {
      gateKey,
      label: GATE_LABELS[gateKey],
      sortOrder: index + 1,
      required,
      source,
      disabled,
    };
  });
}
