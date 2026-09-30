/**
 * The safe-first-issue picker — step 4's *"We picked a safe one"*
 * ([#387](https://github.com/NobuData/ouroboros/issues/387), BB.4, decision **O5**).
 *
 * Reads what intake already computed — each sized issue's estimate in force, its file breakdown,
 * the rate its model resolves to — and the repository's protected paths, scores every candidate
 * with `first-issue.score.ts`, and answers in one of four states:
 *
 * ```
 * no open issues               → empty      + the planning pointer
 * open, none sized yet         → sizing     + the nightly estimator's real status (AL.5, #281)
 * sized, none clears the bar   → none_safe  — never the least-bad candidate
 * otherwise                    → picked     + the safest candidate and its reasoning
 * ```
 *
 * The estimator's status travels on every answer while open issues still wait to be sized, so a
 * `none_safe` backlog with unsized issues says more may be coming.
 */

import { Injectable } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import { BacklogHealthRepository } from "../planning/health.repository";
import { reestimationStatus } from "../planning/health.service";
import { splitRepo } from "./onboarding.derivation";
import { OnboardingRepository } from "./onboarding.repository";
import { normaliseRepo } from "./onboarding.service";
import {
  FirstIssueRepository,
  type BacklogCounts,
  type CandidateRow,
} from "./first-issue.repository";
import {
  candidateResource,
  PLANNING_PATH,
  type FirstIssueAlternativesResource,
  type FirstIssueCandidateResource,
  type FirstIssueExclusionsResource,
  type FirstIssueResource,
  type FirstIssueState,
} from "./first-issue.resources";
import { bySafety, SAFETY_WEIGHTS, scoreCandidate, type SafetyWeights } from "./first-issue.score";

/** How many alternatives a request returns when it names no limit. */
export const DEFAULT_ALTERNATIVES_LIMIT = 10;

/** The backlog of a repository the workspace does not mirror: nothing in it. */
const NO_BACKLOG: BacklogCounts = { open: 0, sized: 0, sizing: 0, needsHuman: 0 };

/** One repository's candidates, scored. */
interface Ranking {
  readonly repo: string;
  readonly backlog: BacklogCounts;
  /** Qualifying candidates, safest first. */
  readonly ranked: readonly FirstIssueCandidateResource[];
  readonly excluded: FirstIssueExclusionsResource;
}

@Injectable()
export class FirstIssueService {
  /**
   * The weights in force. A property rather than a constant at the call sites so a spec can show
   * a weight change reordering the same backlog.
   */
  weights: SafetyWeights = SAFETY_WEIGHTS;

  /**
   * @param picker - The backlog, candidate and protected-path reads.
   * @param onboarding - The repository lookup the wizard already uses.
   * @param health - The nightly job's latest run.
   * @param config - The nightly job's schedule.
   */
  constructor(
    private readonly picker: FirstIssueRepository,
    private readonly onboarding: OnboardingRepository,
    private readonly health: BacklogHealthRepository,
    private readonly config: AppConfigService,
  ) {}

  /**
   * The *Your First Issue* card for one repository.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`; compared case-insensitively.
   * @param now - The instant freshness is measured from. Defaulted; a spec pins it.
   * @returns The state, the pick when there is one, and the cold-state pointers.
   */
  async pick(
    organizationId: string,
    repo: string,
    now: Date = new Date(),
  ): Promise<FirstIssueResource> {
    const ranking = await this.rank(organizationId, repo, now);
    const { backlog } = ranking;
    const best = ranking.ranked[0];
    const pick = best?.clearsBar === true ? best : null;
    const state = stateOf(backlog, pick);
    const estimator =
      backlog.sizing > 0
        ? reestimationStatus(this.config, await this.health.lastRun(organizationId))
        : null;

    return {
      repo: ranking.repo,
      weightsVersion: this.weights.version,
      safetyBar: this.weights.safetyBar,
      state,
      backlog,
      pick,
      estimator,
      planning: state === "empty" ? { path: PLANNING_PATH } : null,
      excluded: ranking.excluded,
    };
  }

  /**
   * *Or pick your own* — every candidate not disqualified, safest first, each with its own
   * reasoning and whether it clears the bar.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`.
   * @param limit - The most candidates to return.
   * @param now - The instant freshness is measured from.
   * @returns The ranked candidates and what was set aside.
   */
  async alternatives(
    organizationId: string,
    repo: string,
    limit: number = DEFAULT_ALTERNATIVES_LIMIT,
    now: Date = new Date(),
  ): Promise<FirstIssueAlternativesResource> {
    const ranking = await this.rank(organizationId, repo, now);

    return {
      repo: ranking.repo,
      weightsVersion: this.weights.version,
      safetyBar: this.weights.safetyBar,
      candidates: ranking.ranked.slice(0, limit),
      excluded: ranking.excluded,
    };
  }

  /**
   * Read and score one repository's backlog.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`.
   * @param now - The freshness clock.
   * @returns The counts, the qualifying candidates in order, and the exclusions.
   */
  private async rank(organizationId: string, repo: string, now: Date): Promise<Ranking> {
    const ref = normaliseRepo(repo);
    const [owner, name] = splitRepo(ref);
    const repository = await this.onboarding.repository(organizationId, owner, name);

    if (repository === undefined) {
      return {
        repo: ref,
        backlog: NO_BACKLOG,
        ranked: [],
        excluded: { protectedPath: 0, tooLarge: 0, belowBar: 0 },
      };
    }

    const [backlog, rows, globs] = await Promise.all([
      this.picker.backlog(organizationId, repository.id),
      this.picker.candidates(organizationId, repository.id),
      this.picker.protectedPaths(organizationId, ref),
    ]);

    return { repo: ref, backlog, ...this.score(rows, globs, now) };
  }

  /**
   * Score candidate rows and set the disqualified aside.
   *
   * @param rows - The sized candidates.
   * @param globs - The protected paths.
   * @param now - The freshness clock.
   * @returns The qualifying candidates, safest first, and the exclusion counts.
   */
  private score(
    rows: readonly CandidateRow[],
    globs: readonly string[],
    now: Date,
  ): Pick<Ranking, "ranked" | "excluded"> {
    const ranked: FirstIssueCandidateResource[] = [];
    const excluded = { protectedPath: 0, tooLarge: 0, belowBar: 0 };

    for (const row of rows) {
      const result = scoreCandidate(row, globs, now, this.weights);

      if (result.disqualified) {
        excluded[result.reason === "protected_path" ? "protectedPath" : "tooLarge"] += 1;
        continue;
      }

      if (!result.clearsBar) {
        excluded.belowBar += 1;
      }

      ranked.push(candidateResource(row, result));
    }

    return { ranked: ranked.sort(bySafety), excluded };
  }
}

/**
 * The card's state, from the counts and the pick.
 *
 * @param backlog - The repository's open issues by sizing status.
 * @param pick - The safest candidate that cleared the bar, or null.
 * @returns The state.
 */
export function stateOf(
  backlog: BacklogCounts,
  pick: FirstIssueCandidateResource | null,
): FirstIssueState {
  if (pick !== null) {
    return "picked";
  }

  if (backlog.open === 0) {
    return "empty";
  }

  return backlog.sized === 0 && backlog.sizing > 0 ? "sizing" : "none_safe";
}
