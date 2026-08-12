/**
 * The two lines of prose the enablement step writes under each row, and the counting behind
 * them.
 *
 * The mockup's organisation row carries "4 repos enabled · incl. helios-firmware" — a count
 * and an example, which together tell somebody at a glance whether the organisation is doing
 * anything and what. Both are derived from the data rather than being told to the component,
 * so the string and the switches on the same row cannot disagree.
 *
 * Framework-free and type-only in its imports, so the sentences can be tested as sentences.
 */

import type { OrgEnablement } from "@/app/api/enablement";
import type { Repo } from "@/app/api/repos";

/**
 * The repositories of an organisation that are switched on.
 *
 * @param repos The organisation's repositories.
 * @returns Those whose own flag is true, in the order given.
 */
export function enabledRepos(repos: readonly Repo[]): readonly Repo[] {
  return repos.filter((repo) => repo.enabled);
}

/**
 * The mockup's repository line for one organisation.
 *
 * Four facts, in the order the mockup puts them and only when each is true: how many are
 * enabled, one of them by name, that some are not shown, and that the organisation's own
 * switch is off so none of them are in scope. The last is the one the mockup does not have
 * and the contract demands — a repository is in scope only when its flag **and** its
 * organisation's are both true, so a row of enabled repositories under a disabled
 * organisation would otherwise read as work that is about to happen.
 *
 * @param entry One organisation and its repositories.
 * @returns The line, ready to render. Never empty.
 */
export function repoSummary(entry: OrgEnablement): string {
  const on = enabledRepos(entry.repos);
  const shown = entry.repos.length;

  const parts: string[] = [
    on.length === 0
      ? "0 repos enabled"
      : `${on.length} ${on.length === 1 ? "repo" : "repos"} enabled`,
  ];

  if (on.length > 0) {
    parts.push(`incl. ${on[0].name}`);
  }

  if (entry.repoTotal > shown) {
    parts.push(`showing ${shown} of ${entry.repoTotal}`);
  }

  if (!entry.org.enabled && on.length > 0) {
    parts.push("org off — none in scope");
  }

  return parts.join(" · ");
}
