/**
 * Which repository the Build Analyzer page analyses (BW.1,
 * [#516](https://github.com/NobuData/ouroboros/issues/516)) — the tenant chip's focus repository,
 * or the workspace's first enabled one while the chip says *All repos*.
 *
 * The analyzer is repo-scoped by nature: a corpus is one repository's builds. The chip's choice
 * lives in this browser (`app/shell/focus-repo.ts`), so the choice is made here, on the client,
 * from the enabled list the server read.
 */

import type { EnabledRepo } from "@/app/api/enablement";
import type { FocusRepo } from "@/app/shell/focus-repo";

/** A repository the analyzer may read. */
export interface AnalyzerRepo {
  /** `github_repos.id` — what the chip's choice holds. */
  readonly id: string;
  /** `owner/name` — what the analyzer routes take. */
  readonly ref: string;
}

/** The repository chosen, and whether the reader chose it. */
export interface ChosenRepo {
  readonly repo: AnalyzerRepo;
  /** True when the chip names it; false when the page fell back to the first enabled one. */
  readonly focused: boolean;
}

/**
 * The enabled repositories, as the analyzer names them.
 *
 * @param enabled The workspace's enabled repositories, in the service's order.
 * @returns Each with its `owner/name`.
 */
export function analyzerRepos(enabled: readonly EnabledRepo[]): AnalyzerRepo[] {
  return enabled.map((repo) => ({ id: repo.id, ref: `${repo.login}/${repo.name}` }));
}

/**
 * Choose the repository to analyse.
 *
 * @param repos The enabled repositories.
 * @param focus The tenant chip's focus repository, or `null` for *All repos*.
 * @returns The focused repository when it is enabled, else the first one; `null` when the
 *   workspace enables none.
 */
export function chooseRepo(repos: readonly AnalyzerRepo[], focus: FocusRepo | null): ChosenRepo | null {
  const focused = focus === null ? undefined : repos.find((repo) => repo.id === focus.id);
  if (focused !== undefined) return { repo: focused, focused: true };

  const first = repos[0];

  return first === undefined ? null : { repo: first, focused: false };
}
