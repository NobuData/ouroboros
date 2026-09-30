/**
 * What one repo-map generation reports (BF.6, [#415](https://github.com/NobuData/ouroboros/issues/415))
 * — the manual regenerate's answer, and the nightly job's per-repository record.
 */

/** What a generation did. */
export type RepoMapOutcome = "published" | "unchanged" | "skipped";

/** The outcomes, in the order a reader meets them. */
export const REPO_MAP_OUTCOMES: readonly RepoMapOutcome[] = ["published", "unchanged", "skipped"];

/** Who asked. */
export type RepoMapTrigger = "nightly" | "manual";

/** Why a generation was skipped: no connected source covers the repository, or the host refused. */
export type RepoMapSkipReason = "no_source" | "rate_limit" | "host_error";

/** One generation's report. */
export interface RepoMapReport {
  /** `owner/name`, lower-case. */
  readonly repo: string;
  /**
   * `published` — the map changed and a new `generated` version is in force; `unchanged` — the map
   * is identical to the version in force and nothing was written; `skipped` — the repository could
   * not be read.
   */
  readonly outcome: RepoMapOutcome;
  /** The skill's slug; null when skipped before one existed. */
  readonly skill: string | null;
  /** The version in force after the generation; null when there is none. */
  readonly version: number | null;
  /** When the generation ran — the new version's `published_at` when one was published. */
  readonly generatedAt: string;
  readonly trigger: RepoMapTrigger;
  /** Set exactly when `outcome` is `skipped`. */
  readonly reason: RepoMapSkipReason | null;
  /** Module rows in the rendered map; 0 when skipped. */
  readonly modules: number;
  /** Whether a bound cut the tree listing. */
  readonly truncated: boolean;
}
