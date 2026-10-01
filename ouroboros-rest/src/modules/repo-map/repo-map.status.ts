/**
 * Where each repository's map stands (BG.6, [#422](https://github.com/NobuData/ouroboros/issues/422))
 * — the decision behind `GET /api/v1/knowledge/repo-map`, pure.
 *
 * ```
 * a map skill with a version in force            → generated
 * none, and no generation was ever recorded      → pending   (the first one has not run)
 * none, and the newest recorded one was skipped  → failed    (it ran and could not read the repo)
 * ```
 *
 * **Pending is not failed**, and the page must not have to guess which: a repository enabled this
 * afternoon has no map because the nightly job has not come round, and a repository whose source
 * lost its credential has no map because every night's read is refused. Both look the same in the
 * skills registry — no row — so the difference is read from the one place it is written, the audit
 * trail `RepoMapService` records every generation in, the skipped ones included.
 */

import {
  REPO_MAP_OUTCOMES,
  type RepoMapOutcome,
  type RepoMapReport,
  type RepoMapSkipReason,
  type RepoMapState,
  type RepoMapStatus,
  type RepoMapTrigger,
} from "./repo-map.resources";

/** The reasons a generation is skipped for. */
const SKIP_REASONS: readonly RepoMapSkipReason[] = ["no_source", "rate_limit", "host_error"];

/** Who may have asked for a generation. */
const TRIGGERS: readonly RepoMapTrigger[] = ["nightly", "manual"];

/** One recorded generation, as the audit trail holds it. */
export interface RecordedGeneration {
  /** `owner/name`, lower-case — the audit row's subject. */
  readonly repo: string;
  /** The row's detail — the report's fields, flat. */
  readonly detail: Readonly<Record<string, string | number | boolean | null>>;
  /** When the generation ran. */
  readonly occurredAt: Date;
}

/** A repository's map skill, as far as its status needs it. */
export interface MapSkill {
  /** `owner/name`, lower-case. */
  readonly repo: string;
  readonly slug: string;
  /** The version in force; null before a first publish. */
  readonly currentVersion: number | null;
}

/**
 * Rebuild the report a recorded generation answered with.
 *
 * @param row - The audit row.
 * @returns The report, or null for a row whose detail is not one this service wrote — an outcome
 *   or a trigger outside the vocabulary. Such a row is left out rather than guessed at.
 */
export function reportOf(row: RecordedGeneration): RepoMapReport | null {
  const { outcome, trigger, reason, skill, version, modules, truncated } = row.detail;

  if (!REPO_MAP_OUTCOMES.includes(outcome as RepoMapOutcome)) return null;
  if (!TRIGGERS.includes(trigger as RepoMapTrigger)) return null;

  return {
    repo: row.repo,
    outcome: outcome as RepoMapOutcome,
    skill: typeof skill === "string" ? skill : null,
    version: typeof version === "number" ? version : null,
    generatedAt: row.occurredAt.toISOString(),
    trigger: trigger as RepoMapTrigger,
    reason: SKIP_REASONS.includes(reason as RepoMapSkipReason)
      ? (reason as RepoMapSkipReason)
      : null,
    modules: typeof modules === "number" ? modules : 0,
    truncated: truncated === true,
  };
}

/**
 * Where a repository's map stands.
 *
 * @param skill - The repository's map skill, if one exists.
 * @param lastReport - The newest recorded generation, if any.
 * @returns The state — see this file's header.
 */
export function stateOf(
  skill: MapSkill | undefined,
  lastReport: RepoMapReport | null,
): RepoMapState {
  if (skill !== undefined && skill.currentVersion !== null) return "generated";

  return lastReport?.outcome === "skipped" ? "failed" : "pending";
}

/**
 * One status per enabled repository.
 *
 * @param repos - The workspace's enabled repositories, `owner/name`, lower-case, in order.
 * @param skills - The workspace's map skills, by slug — the first for a repository is its map, as
 *   `RepoMapRepository.skillFor` chooses.
 * @param generations - The newest recorded generation of each repository.
 * @returns The statuses, in the repositories' order.
 */
export function statusesOf(
  repos: readonly string[],
  skills: readonly MapSkill[],
  generations: readonly RecordedGeneration[],
): RepoMapStatus[] {
  return repos.map((repo) => {
    const skill = skills.find((one) => one.repo === repo);
    const recorded = generations.find((one) => one.repo === repo);
    const lastReport = recorded === undefined ? null : reportOf(recorded);
    const state = stateOf(skill, lastReport);

    return {
      repo,
      state,
      skill: state === "generated" ? (skill?.slug ?? null) : null,
      version: state === "generated" ? (skill?.currentVersion ?? null) : null,
      lastReport,
    };
  });
}
