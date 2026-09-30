/**
 * What the safe-first-issue picker answers
 * ([#387](https://github.com/NobuData/ouroboros/issues/387), BB.4).
 *
 * ```
 * GET /api/v1/onboarding/first-issue               → FirstIssueResource
 * GET /api/v1/onboarding/first-issue/alternatives  → FirstIssueAlternativesResource
 * ```
 *
 * The pick's `reasoning.line` is **assembled** from `reasoning.fragments`, and each fragment
 * names the score component (or the estimate) it came from — no sentence here is written for a
 * particular issue. `cost` is absent, not zero, when the routed model is unpriced.
 */

import type { EstimateEffort } from "../db/schema";
import type { BacklogHealthResource } from "../planning/planning.resources";
import type { BacklogCounts, CandidateRow } from "./first-issue.repository";
import type { ReasoningFragment, ScoreComponent, ScoreResult } from "./first-issue.score";

/** The planning surface — where a repository with no issues is pointed. Mirrors the UI route. */
export const PLANNING_PATH = "/planning";

/**
 * Where the picker's answer stands.
 *
 * - `picked` — a candidate cleared the safety bar; `pick` is the best one.
 * - `sizing` — open issues exist, none is sized yet; `estimator` says what the job is doing.
 * - `empty` — the repository has no open issues; `planning` points at the planning surface.
 * - `none_safe` — sized issues exist and none clears the bar; nothing is picked.
 */
export type FirstIssueState = "picked" | "sizing" | "empty" | "none_safe";

/** A scored candidate, with its reasoning. */
export interface FirstIssueCandidateResource {
  /** `github_issues.id`. */
  readonly issueId: string;
  /** `488`. */
  readonly number: number;
  readonly title: string;
  /** The issue on its tracker. */
  readonly url: string;
  /** The chip — `xs`. */
  readonly effort: EstimateEffort;
  /** The tag — `docs-loop`. */
  readonly suggestedWorkflow: string;
  /** The total under the weights in force. */
  readonly score: number;
  /** Whether it reaches the safety bar. */
  readonly clearsBar: boolean;
  /** The estimate the minutes and cost came from. */
  readonly estimate: {
    readonly version: number;
    readonly routedModel: string;
    readonly cycleMin: number;
    readonly cycleMax: number;
    /** The printed minutes: the cycle range's midpoint, rounded down. */
    readonly loopMinutes: number;
    readonly estTokens: number;
  };
  /** Only when the routed model is priced — `{ cents: 3, display: "$0.03" }`. */
  readonly cost?: { readonly cents: number; readonly display: string };
  readonly reasoning: {
    /** `no code paths touched · est. 4 min` — the fragments joined. */
    readonly line: string;
    readonly fragments: readonly ReasoningFragment[];
    /** Every term of the score — the detail affordance. */
    readonly components: readonly ScoreComponent[];
  };
}

/** How many sized candidates were set aside, and why. */
export interface FirstIssueExclusionsResource {
  /** A breakdown file matched a protected path. Disqualified, whatever it scored. */
  readonly protectedPath: number;
  /** An effort of `l` or above. */
  readonly tooLarge: number;
  /** Scored below the safety bar. */
  readonly belowBar: number;
}

/** What both endpoints say about the weights. */
interface ScoringContextResource {
  /** `acme-robotics/helios-firmware`, lower-case. */
  readonly repo: string;
  /** Which weights produced the answer — `safety-v1`. */
  readonly weightsVersion: string;
  readonly safetyBar: number;
  readonly excluded: FirstIssueExclusionsResource;
}

/** `GET /api/v1/onboarding/first-issue` — the *Your First Issue* card. */
export interface FirstIssueResource extends ScoringContextResource {
  readonly state: FirstIssueState;
  /** The repository's open issues by sizing status. */
  readonly backlog: BacklogCounts;
  /** The pick when `state` is `picked`, else null — never a candidate below the bar. */
  readonly pick: FirstIssueCandidateResource | null;
  /** The nightly estimator's real status, whenever open issues still wait to be sized. */
  readonly estimator: BacklogHealthResource["reestimation"] | null;
  /** The planning pointer, when `state` is `empty`. */
  readonly planning: { readonly path: string } | null;
}

/** `GET /api/v1/onboarding/first-issue/alternatives` — *or pick your own ▾*. */
export interface FirstIssueAlternativesResource extends ScoringContextResource {
  /** Candidates not disqualified, safest first, each with its own reasoning. */
  readonly candidates: readonly FirstIssueCandidateResource[];
}

/**
 * A candidate row and its (qualifying) score, as a resource.
 *
 * @param row - The backlog row.
 * @param score - Its score — a disqualified one never reaches a resource.
 * @returns The resource.
 */
export function candidateResource(
  row: CandidateRow,
  score: Extract<ScoreResult, { disqualified: false }>,
): FirstIssueCandidateResource {
  return {
    issueId: row.issueId,
    number: row.number,
    title: row.title,
    url: row.url,
    effort: row.effort,
    suggestedWorkflow: row.suggestedWorkflow,
    score: score.score,
    clearsBar: score.clearsBar,
    estimate: {
      version: row.version,
      routedModel: row.routedModel,
      cycleMin: row.cycleMin,
      cycleMax: row.cycleMax,
      loopMinutes: score.loopMinutes,
      estTokens: row.estTokens,
    },
    ...(score.cost === undefined ? {} : { cost: score.cost }),
    reasoning: { line: score.line, fragments: score.fragments, components: score.components },
  };
}
