/**
 * What an engine answer *means* — the floor, the status it implies, and the row it becomes.
 *
 * L.3 ([#107](https://github.com/NobuData/ouroboros/issues/107)). Everything in this file is a
 * pure function over values: no database, no clock of its own, no injector. The split is the
 * same one `routing/resolve.ts` makes against `routing/resolution.service.ts`, and for the same
 * reason — the decision that is worth arguing about should be testable without arranging for
 * anything to happen.
 *
 * Two decisions live here.
 *
 * ---------------------------------------------------------------------------
 * **The `needs_human` transition is this service's, and it is one comparison.**
 *
 * `ouroboros-engine`'s L.1 contract has no `needs_human` field on purpose: an estimator says
 * how sure it is, and what that means is an installation's policy. So the engine publishes
 * `NEEDS_HUMAN_CONFIDENCE_FLOOR` as the number `heuristic-v0`'s tables were *calibrated*
 * against, and `OURO_ESTIMATION_CONFIDENCE_FLOOR` defaults to it — which is what keeps the two
 * from drifting apart in silence while still letting a workspace disagree without a release.
 *
 * **An estimate below the floor is still persisted in full.** It is a real answer with a real
 * trace, and mockup 03's own `#490` is exactly that row: `XL`, 61%, `deps-refresh`,
 * `claude-fable-5`, and a `needs human` pill beside all of it. Refusing to store it would
 * throw away the thing a person is being asked to look at.
 *
 * ---------------------------------------------------------------------------
 * **The naming convention changes twice, and this is the second place.**
 *
 * `engine/engine.contract.ts` turns the engine's `snake_case` into this service's `camelCase`
 * at the wire. This file turns it back for the two `jsonb` columns — `est_tokens`,
 * `cycle_min`, `sized_at` — because those keys are *stored bytes* that V026's CHECK functions
 * look up by name. Both translations are one function each, in the file that owns the boundary
 * they cross, so no reader has to remember which side they are on.
 *
 * `sized_at` is the one field neither the engine nor the column supplies: the engine does not
 * own the clock (a timestamp in a response body is one two services can disagree about), and
 * `created_at` is the row's rather than the estimate's. For this ticket's synchronous call the
 * two instants are the same, and they are deliberately different for O.2's
 * ([#123](https://github.com/NobuData/ouroboros/issues/123)) escalate-and-poll — which is why
 * it is a parameter here rather than a `now()` inside the insert.
 */

import type { Estimate } from "../engine/engine.contract";
import type { NewIssueEstimate, SizingStatus } from "../db/schema";

/**
 * What an estimate says the issue's `sizing_status` should become.
 *
 * The two terminal states of decision **K4**'s lifecycle, and the only two this function can
 * answer: `unsized` is where an issue starts and `estimating` is where it is while this runs,
 * so neither is something an *answer* can imply.
 */
export type EstimatedStatus = Extract<SizingStatus, "sized" | "needs_human">;

/**
 * Does this estimate clear the floor?
 *
 * @param estimate - What the engine answered.
 * @param floor - `OURO_ESTIMATION_CONFIDENCE_FLOOR` — the confidence below which an issue
 *   wants a person.
 * @returns `sized` when the estimator is at least that sure, `needs_human` when it is not.
 *   The comparison is `<` rather than `<=`, so a floor of 70 accepts an estimate *of* 70 —
 *   which is how the engine's own `needs_human()` reads it, and how the mockup's `#487` at 71
 *   and `#490` at 61 fall on the sides the design shows.
 */
export function statusFor(estimate: Estimate, floor: number): EstimatedStatus {
  return estimate.confidence < floor ? "needs_human" : "sized";
}

/**
 * One engine answer, as the row `issue_estimates` stores.
 *
 * A translation and nothing else — every value here comes from the estimate, the issue or the
 * clock, and none of it is computed. What the database then refuses is V026's business: the
 * five efforts, the three risks, the confidence bounds, the two document grammars and decision
 * **K10**'s provenance are all constraints, and this service is deliberately not a second copy
 * of them. A row that fails one of those is a bug in an estimator, and it fails at the column
 * where the message names the rule.
 *
 * @param githubIssueId - `github_issues.id` — the issue this sizes.
 * @param version - Which estimate of this issue this is. Computed by the caller as
 *   `max(version) + 1` and *checked* by V026's trigger and unique key; see
 *   `estimation.repository.ts` on why a wrong guess is a retry rather than a corruption.
 * @param estimate - What the engine answered, in this service's names.
 * @param sizedAt - When the estimate was produced. Written into `trace.sized_at` as an
 *   ISO-8601 instant with an offset, which is the shape V026's regex accepts and
 *   `Date.toISOString()` produces.
 * @returns The row, ready to insert. The two `jsonb` columns are stringified here rather than
 *   at the call site, because the value Kysely wants written is the string a driver will send
 *   — see {@link IssueEstimatesTable.breakdown}.
 */
export function estimateRow(
  githubIssueId: string,
  version: number,
  estimate: Estimate,
  sizedAt: Date,
): NewIssueEstimate {
  return {
    github_issue_id: githubIssueId,
    version,
    effort: estimate.effort,
    confidence: estimate.confidence,
    suggested_workflow: estimate.suggestedWorkflow,
    routed_model: estimate.routedModel,
    breakdown: JSON.stringify({
      files: estimate.breakdown.files,
      est_tokens: estimate.breakdown.estTokens,
      cycle_min: estimate.breakdown.cycleMin,
      cycle_max: estimate.breakdown.cycleMax,
      est_minutes: estimate.breakdown.estMinutes,
    }),
    risk: estimate.risk,
    risk_note: estimate.riskNote,
    trace: JSON.stringify({
      estimator: estimate.trace.estimator,
      // The writer's, not the engine's — see this file's header.
      sized_at: sizedAt.toISOString(),
      tokens_used: estimate.trace.tokensUsed,
      signals: estimate.trace.signals,
    }),
  };
}
