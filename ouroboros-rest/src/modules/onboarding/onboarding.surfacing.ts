/**
 * When `/get-started` is offered — the surfacing contract
 * ([#385](https://github.com/NobuData/ouroboros/issues/385), BB.2), written once here so the UI
 * implements one decision rather than inventing four.
 *
 *   1. **A fresh organization is routed in.** Fresh means: it has never had a run, and no
 *      repository's wizard in it has been completed, dismissed or bypassed.
 *   2. **Anyone can dismiss** (`PATCH { dismissed: true }` is open to every member, viewers
 *      included), and **dismissal sticks**: a dismissed wizard is a finished one for the rule
 *      above, so the organization stops being routed in — on every device, because the fact is
 *      server-side.
 *   3. **Established organizations are not nagged**: one run anywhere, or one finished wizard,
 *      and the offer stops.
 *   4. **The wizard stays re-enterable per repository.** The offer governs only whether the app
 *      routes an organization *in*; `GET /api/v1/onboarding?repo=<another>` always answers, with
 *      that repository's own, independent state.
 */

/** Why the wizard is, or is not, offered. */
export type SurfacingReason = "fresh_organization" | "organization_has_runs" | "wizard_finished";

/** The surfacing decision. */
export interface SurfacingDecision {
  /** Whether the app should route this organization to `/get-started`. */
  readonly offer: boolean;
  /** The rule that decided it. */
  readonly reason: SurfacingReason;
}

/**
 * Decide whether to offer the wizard to an organization.
 *
 * A finished wizard is checked first: it is the person's own statement, and the more specific
 * of the two reasons.
 *
 * @param facts - Whether any wizard in the organization is finished, and whether it has runs.
 * @returns The decision and its reason.
 */
export function surfacing(facts: {
  readonly anyWizardFinished: boolean;
  readonly hasRuns: boolean;
}): SurfacingDecision {
  if (facts.anyWizardFinished) {
    return { offer: false, reason: "wizard_finished" };
  }

  if (facts.hasRuns) {
    return { offer: false, reason: "organization_has_runs" };
  }

  return { offer: true, reason: "fresh_organization" };
}
